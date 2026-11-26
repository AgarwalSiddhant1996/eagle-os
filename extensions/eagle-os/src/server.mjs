import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WorkspaceStore, InputError, todayState } from "./store.mjs";
import { listAdapters } from "./adapters.mjs";
import { skillCatalog, discoverSkills, installSkills, skillPacks, rolePresets, resolveSkillSelection } from "./skills.mjs";
import { detectPatterns, emptyImprovements, readWorkspaceSkill, exactDiff } from "./improvements.mjs";
import { join } from "node:path";
import { hostState, submitHostRequest } from "./host.mjs";
import { coreState, submitCoreRequest, assertHub, drainOwnerInbox, publicBoard } from "./orchestration.mjs";
import { domainViewsState } from "./domain-views.mjs";

const assets = { "": ["index.html", "text/html"], "app.mjs": ["app.mjs", "text/javascript"], "ui-state.mjs": ["ui-state.mjs", "text/javascript"], "domain-state.mjs": ["domain-state.mjs", "text/javascript"], "style.css": ["style.css", "text/css"] };
function skillCapabilities(board) {
    const remote = board.host?.remote, receipt = remote?.receipt;
    return remote?.status === "verified" && typeof remote.identity === "string" && remote.identity &&
        receipt?.identity === remote.identity && remote.verifiedAt === receipt.readAt && Number.isFinite(Date.parse(remote.verifiedAt)) &&
        ["readback", "method"].every((key) => typeof receipt[key] === "string" && receipt[key].trim())
        ? ["remote-worker"] : [];
}
export async function startServer({ store = new WorkspaceStore(), hostMode = "standalone", skillWorkspace = "", hostBridge } = {}) {
    const token = randomBytes(24).toString("hex");
    let origin, host;
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'");
        const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
        try {
            if (req.headers.host !== host || req.headers.origin && req.headers.origin !== origin) throw new InputError("Request origin rejected.", 403);
            const url = new URL(req.url, origin);
            const prefix = `/${token}/`;
            if (!url.pathname.startsWith(prefix)) throw new InputError("Not found.", 404);
            const path = url.pathname.slice(prefix.length);
            if (req.method === "GET" && Object.hasOwn(assets, path)) {
                const [file, type] = assets[path];
                res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
                res.end(await readFile(new URL(`../ui/${file}`, import.meta.url)));
                return;
            }
            const supplied = Buffer.from(req.headers["x-workspace-token"] ?? "");
            if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) throw new InputError("Workspace token required.", 403);
            if (req.method === "GET" && path === "state") {
                let board = await store.read();
                if (board.core?.hubSessionId === hostBridge?.sessionId && board.core.hubInstanceId === (hostBridge?.instanceId ?? "")) {
                    await drainOwnerInbox(store, hostBridge);
                    board = await store.read();
                }
                const improvements = board.improvements ?? emptyImprovements();
                json(200, { board: publicBoard(board), core: coreState(board, hostBridge), views: domainViewsState(board), today: todayState(board), host: hostState(board, hostBridge), connections: { host: hostMode, remoteWorker: !board.host?.remote || board.host.remote.status === "unverified" ? "not_configured" : board.host.remote.status },
                    improvements: { patterns: detectPatterns(improvements),
                        previews: Object.fromEntries(improvements.candidates.map((c) => [c.id, exactDiff(c.patch)])) },
                    skills: { available: await skillCatalog(), installed: await discoverSkills(join(store.directory, "skills")),
                        packs: skillPacks, presets: rolePresets, capabilities: skillCapabilities(board),
                        hostActivation: hostMode === "native-canvas"
                            ? `Host directory selection: ${skillWorkspace || "not supplied"}. Workspace copies need host rediscovery/reload before use; loaded status is not inferred.`
                            : "Standalone does not load AI skills. Register this workspace skill directory with your approved host before use." },
                    adapters: (await listAdapters(store.root)).map(({ module, ...a }) => ({ ...a, status: "unverified" })) });
                return;
            }
            if (req.method === "GET" && path === "skill-text") {
                json(200, { content: await readWorkspaceSkill(store.directory, url.searchParams.get("id")) });
                return;
            }
            if (req.method !== "POST" || !["command", "skills", "host-request", "core-request"].includes(path)) throw new InputError("Not found.", 404);
            if (req.headers.origin !== origin || req.headers["content-type"]?.split(";")[0] !== "application/json") throw new InputError("Same-origin JSON required.", 403);
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 64000) throw new InputError("Request too large.", 413);
                chunks.push(chunk);
            }
            let body;
            try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new InputError("Invalid JSON."); }
            assertHub(await store.read(), hostBridge, { allowUnbound: true });
            if (path === "core-request") {
                const outcome = await submitCoreRequest(store, hostBridge, body);
                json(outcome.request.status === "blocked" ? 503 : 200, { ...outcome, core: coreState(await store.read(), hostBridge) });
                return;
            }
            if (path === "host-request") {
                const outcome = await submitHostRequest(store, hostBridge, body);
                json(outcome.request.status === "blocked" && !outcome.duplicate ? 503 : 200,
                    { ...outcome, host: hostState(outcome.board, hostBridge), ...(outcome.request.status === "blocked" ? { error: outcome.request.detail } : {}) });
                return;
            }
            if (path === "skills") {
                if (body.consent !== true) throw new InputError("Select skills and explicitly confirm workspace-local installation.");
                const capabilities = skillCapabilities(await store.read());
                let ids;
                try { ids = resolveSkillSelection({ ids: body.ids, packs: body.packs, all: body.all, capabilities }); }
                catch (error) { throw new InputError(error.message); }
                json(200, await installSkills({ directory: join(store.directory, "skills"), ids }));
                return;
            }
            if (typeof body?.command !== "string" || body.command.startsWith("host_") || body.command.startsWith("core_") ||
                ["view_propose", "view_rows"].includes(body.command)) throw new InputError("Host results require the owning native canvas callback.", 403);
            json(200, { board: publicBoard(await store.mutate(body.command, body.payload, body.expectedRevision)) });
        } catch (error) {
            console.error(`Workspace request failed: ${error.message}`);
            json(error.status ?? 500, { error: error.message });
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    host = `127.0.0.1:${server.address().port}`; origin = ["http:", "", host].join("/");
    return { url: `${origin}/${token}/`, close: () => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())) };
}
