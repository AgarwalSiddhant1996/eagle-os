import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WorkspaceStore, applyCommand, blankBoard, todayState, safeLink, normalizeSavedBoard } from "../src/store.mjs";
import { startServer } from "../src/server.mjs";
import { readAdapter } from "../src/adapters.mjs";
import { install } from "../scripts/install.mjs";
import { inspectText, scanTree } from "../scripts/sanitize.mjs";

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), "eagle-test-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    return { root, store: new WorkspaceStore({ root: join(root, "user-state"), id: "sample" }) };
}
const intake = { title: "Launch workspace", preset: "feature-pm", jobs: ["Review changes"], decisions: ["Pick a next step"], sources: [] };
async function seed(store) {
    let b = await store.mutate("intake", intake, 0);
    b = await store.mutate("work", { title: "A sample launch" }, b.revision);
    b = await store.mutate("evidence", { workId: b.work[0].id, sourceId: "manual", summary: "A primary read confirms the sample.", status: "verified", url: "https://example.test/evidence" }, b.revision);
    return b;
}
const card = (b) => ({ key: "sample-decision", evidenceId: b.evidence[0].id, title: "Choose the review path",
    why: "The next step requires your choice.", options: ["Review now", "Wait for more evidence"], recommendedIndex: 0,
    afterDecision: "Record the choice; no external action." });

test("purpose first, verified evidence, ready card and resolution are separate persistent stages", async (t) => {
    const { store } = await fixture(t);
    assert.equal(todayState(await store.read()).code, "setup");
    let b = await seed(store);
    assert.equal(todayState(b).code, "pending");
    b = await store.mutate("card", card(b), b.revision);
    assert.equal(todayState(b).code, "ready");
    const next = new WorkspaceStore({ root: store.root, id: "sample" });
    assert.equal((await next.read()).cards[0].title, "Choose the review path");
    b = await next.mutate("resolve", { id: b.cards[0].id, choice: 1 }, b.revision);
    assert.equal(todayState(b).code, "empty"); assert.equal(b.cards[0].choice, 1);
    await assert.rejects(() => next.mutate("card", card(b), b.revision), /already exists/);
    assert.equal(b.events.length, 5);
});
test("blocked and unverified evidence cannot masquerade as a ready Today card", async (t) => {
    const { store } = await fixture(t); let b = await seed(store);
    b.evidence[0].status = "blocked";
    assert.equal(todayState(b).code, "blocked");
    assert.throws(() => applyCommand(b, "card", card(b)), /verified/);
    b.evidence[0].status = "unverified";
    assert.throws(() => applyCommand(b, "card", card(b)), /verified/);
    assert.throws(() => applyCommand(b, "card", { ...card(b), options: ["Only one"] }), /verified/);
});
test("revisions and exclusive locks reject stale/concurrent writes instead of losing state", async (t) => {
    const { store } = await fixture(t); await seed(store);
    await assert.rejects(() => store.mutate("work", { title: "stale" }, 0), /changed/);
    const state = await store.read();
    const results = await Promise.allSettled([store.mutate("work", { title: "one" }, state.revision), store.mutate("work", { title: "two" }, state.revision)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await store.read()).work.length, 2);
});
test("workspace ids, data location and parse failures never fall back to an empty success", async (t) => {
    const { root, store } = await fixture(t);
    assert.throws(() => new WorkspaceStore({ id: "../escape" }), /workspace id/);
    assert.throws(() => new WorkspaceStore({ root: join(root, "code", "data"), installationRoot: join(root, "code") }), /outside/);
    await mkdir(store.directory, { recursive: true }); await writeFile(store.path, "{broken");
    await assert.rejects(() => store.read(), SyntaxError);
});
test("each workspace stays independent and safe links cannot smuggle credentials or script schemes", async (t) => {
    const { root, store } = await fixture(t); await seed(store);
    const other = new WorkspaceStore({ root: join(root, "user-state"), id: "other" });
    assert.equal((await other.read()).work.length, 0);
    assert.equal(safeLink("https://example.test/path"), "https://example.test/path");
    assert.throws(() => safeLink("javascript:alert(1)"), /credentials|schemes/);
    assert.throws(() => safeLink(["https:", "", ["name:pass", "example.test"].join("@")].join("/")), /credentials/);
    assert.throws(() => safeLink("https://example.test/?token=sample"), /credentials/);
});
test("source descriptors are optional, capability-neutral, and never approve their own execution", async (t) => {
    const { store } = await fixture(t);
    const sources = [{ id: "one", label: "Design source", capabilities: ["read"], settings: { endpoint: "https://example.test/source" } }];
    const b = await store.mutate("intake", { ...intake, sources }, 0);
    assert.equal(b.profile.sources[0].readApproved, false);
    assert.equal(todayState(b).code, "sources");
    assert.throws(() => applyCommand(b, "intake", { ...intake, sources: [{ ...sources[0], settings: { password: "unsafe" } }] }), /credentials/);
    assert.throws(() => applyCommand(b, "intake", { ...intake, sources: [{ ...sources[0], capabilities: ["send"] }] }), /read\/file/);
});
test("adapter execution is explicit, local and honest about pagination", async (t) => {
    const { root } = await fixture(t), dir = join(root, "connectors");
    await mkdir(dir); const module = join(dir, "source.mjs");
    await writeFile(module, 'export const apiVersion=1; export async function read(){return {records:[],status:"complete",terminal:false,nextCursor:"later"}}');
    const adapter = { module, capabilities: ["read"] };
    await assert.rejects(() => readAdapter({ adapter, dataRoot: root }), /approval/);
    await assert.rejects(() => readAdapter({ adapter, dataRoot: root, approved: true }), /nonterminal/);
    const outside = join(root, "outside.mjs"); await writeFile(outside, "");
    await assert.rejects(() => readAdapter({ adapter: { ...adapter, module: outside }, dataRoot: root, approved: true }), /connectors/);
});
test("HTTP API requires its capability and same-origin JSON; untrusted titles stay data", async (t) => {
    const { store } = await fixture(t), panel = await startServer({ store });
    t.after(() => panel.close());
    const base = new URL(panel.url), token = base.pathname.split("/")[1];
    assert.equal((await fetch(new URL("state", base))).status, 403);
    const headers = { "X-Workspace-Token": token, "Content-Type": "application/json", Origin: base.origin };
    const denied = await fetch(new URL("command", base), { method: "POST", headers: { ...headers, Origin: "https://example.test" },
        body: JSON.stringify({ command: "work", payload: { title: "wrong origin" }, expectedRevision: 0 }) });
    assert.equal(denied.status, 403);
    const created = await fetch(new URL("command", base), { method: "POST", headers,
        body: JSON.stringify({ command: "work", payload: { title: "<script>sample</script>" }, expectedRevision: 0 }) });
    assert.equal(created.status, 200);
    const response = await fetch(new URL("state", base), { headers });
    assert.equal((await response.json()).board.work[0].title, "<script>sample</script>");
    assert.equal((await fetch(new URL("../src/store.mjs", base))).status, 404);
});
test("safe installs and updates retain external data and keep a code backup without force deletion", async (t) => {
    const { root, store } = await fixture(t); const b = await seed(store);
    const target = join(root, "installed");
    const first = await install({ target, dataRoot: store.root });
    assert.equal(first.backup, "");
    const before = await readFile(store.path, "utf8");
    const second = await install({ target, dataRoot: store.root });
    assert.ok(second.backup);
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.equal((await store.read()).revision, b.revision);
    await writeFile(join(target, "personal-note.txt"), "Keep this.");
    await assert.rejects(() => install({ target, dataRoot: store.root }), /unknown files/);
    assert.equal(await readFile(join(target, "personal-note.txt"), "utf8"), "Keep this.");
    await assert.rejects(() => install({ target: store.root, dataRoot: store.root }), /overlap/);
});
test("sanitization rejects synthetic company/person rules, emails, opaque ids and unreviewed URLs without echoing values", () => {
    const rules = { forbiddenTerms: ["sample-corp", "example-person"] };
    assert.equal(inspectText("readme.md", "A purpose-first work system.", rules).length, 0);
    for (const data of ["sample-corp", "example-person", ["name", "example.test"].join("@"), randomUUID(), ["https:", "", "unreviewed.test/path"].join("/")]) {
        const findings = inspectText("sample.txt", data, rules);
        assert.ok(findings.length); assert.ok(findings.every((f) => !Object.hasOwn(f, "value")));
    }
});
test("release scanner rejects unknown binary assets and PNG metadata chunks while allowing clean docs/assets PNGs", async (t) => {
    const { root } = await fixture(t);
    await writeFile(join(root, "unreviewed.bin"), new Uint8Array([0, 255]));
    assert.ok((await scanTree(root)).findings.some((f) => f.category === "unreviewed-file-type"));
    const chunk = (type, payload) => {
        const out = new Uint8Array(12 + payload.length), view = new DataView(out.buffer);
        view.setUint32(0, payload.length);
        for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
        out.set(payload, 8);
        return out;
    };
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = chunk("IHDR", new Uint8Array(13)), idat = chunk("IDAT", new Uint8Array([1, 2])), iend = chunk("IEND", new Uint8Array(0));
    const cleanPng = Buffer.concat([sig, ihdr, idat, iend]);
    await rm(join(root, "unreviewed.bin"));
    await writeFile(join(root, "outside.png"), cleanPng);
    assert.ok((await scanTree(root)).findings.some((f) => f.category === "unreviewed-file-type"));
    await rm(join(root, "outside.png"));
    await mkdir(join(root, "docs", "assets"), { recursive: true });
    await writeFile(join(root, "docs", "assets", "clean.png"), cleanPng);
    assert.equal((await scanTree(root)).findings.length, 0);
    assert.equal((await scanTree(root, { forbiddenTerms: ["clean"] })).findings[0]?.category, "private-identifier");
    const textChunk = chunk("tEXt", new TextEncoder().encode("Comment\0hidden"));
    await writeFile(join(root, "docs", "assets", "meta.png"), Buffer.concat([sig, ihdr, textChunk, idat, iend]));
    assert.ok((await scanTree(root)).findings.some((f) => f.category === "unreviewed-image-metadata"));
});
test("sanitization scans LICENSE cleanly, embeds no reversible brand hashes, and checks file paths against private rules", async (t) => {
    const { root } = await fixture(t);
    await writeFile(join(root, "LICENSE"), "MIT License\n\nCopyright (c) 2026 Eagle OS contributors\n");
    assert.equal((await scanTree(root)).findings.length, 0);
    const sanitizerSource = await readFile(fileURLToPath(new URL("../scripts/sanitize.mjs", import.meta.url)), "utf8");
    assert.doesNotMatch(sanitizerSource, /\b[a-f0-9]{64}\b/i);
    assert.equal(inspectText("sample-corp/notes.md", "Clean body.", { forbiddenTerms: ["sample-corp"] })[0]?.category, "private-identifier");
});

test("the optional host bridge scopes its panel and executes the same evidence-to-card contract", async (t) => {
    const { root, store } = await fixture(t); await seed(store);
    const sdk = join(root, "host.mjs"), proof = join(root, "proof.json");
    const program = `
import {writeFile} from "node:fs/promises";
export const createCanvas=(definition)=>definition;
export async function joinSession({canvases}) {
 const c=canvases[0], context={instanceId:"test-panel",input:{workspace:"sample"}};
 await c.open(context);
 const read=c.actions.find(a=>a.name==="get_state");
 const b=await read.handler({instanceId:"test-panel"});
 const payload={key:"host-card",evidenceId:b.evidence[0].id,title:"A host decision",why:"A choice is needed.",
  options:["Continue","Wait"],recommendedIndex:0,afterDecision:"Record locally."};
 const result=await c.actions.find(a=>a.name==="record_card").handler({instanceId:"test-panel",input:{expectedRevision:b.revision,payload}});
 await c.onClose({instanceId:"test-panel"});
 await writeFile(process.env.EAGLE_TEST_PROOF,JSON.stringify({revision:result.revision,status:result.card.status,canvas:c.id}));
}`;
    await writeFile(sdk, program);
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../extension.mjs", import.meta.url))], {
        timeout: 15000, env: { ...process.env, EAGLE_HOST_SDK: pathToFileURL(sdk).href, EAGLE_DATA_ROOT: store.root, EAGLE_TEST_PROOF: proof },
    });
    const saved = JSON.parse(await readFile(proof, "utf8"));
    assert.equal(saved.canvas, "eagle-os"); assert.equal(saved.status, "open");
    assert.equal(todayState(await store.read()).code, "ready");
});
test("legacy onboarding/profile projection migrates once to PM four-step flow and persists through guarded writes without deleting user data", async (t) => {
        await mkdir(resolve(".test-output"), { recursive: true });
        const root = await mkdtemp(join(resolve(".test-output"), "flow-migration-"));
        t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
        for (const [oldStep, expected] of [0, 0, 1, 2, 3].entries()) {
            const options = { root: join(root, "user-state"), installationRoot: join(root, "installation"), id: `sample-${oldStep}` };
            const store = new WorkspaceStore(options), legacy = blankBoard(store.id);
            legacy.profile = { ...intake, role: "legacy-role", preset: "retired-preset", models: { mid: "user-selected-model" }, userNotes: "Keep my own notes." };
            legacy.work.push({ id: "user-work", title: "Keep user work", status: "planned", owner: "User", notes: "Keep work notes." });
            legacy.onboarding = { step: oldStep, draft: { role: "legacy-role", title: "Saved PM purpose", jobs: ["Review updates"],
                decisions: "Choose a next step", preset: "retired-preset", skills: ["retired-local-skill"] } };
            const skillPath = join(store.directory, "skills", "retired-local-skill", "SKILL.md");
            await mkdir(join(store.directory, "skills", "retired-local-skill"), { recursive: true });
            await writeFile(skillPath, "User-edited local guidance.\n");
            await writeFile(store.path, JSON.stringify(legacy));
            const normalized = await store.read();
            assert.equal(normalized.onboarding.step, expected); assert.equal(normalized.onboarding.flowVersion, 2);
            assert.equal(normalized.profile.role, "pm"); assert.equal(normalized.profile.preset, "feature-pm");
            assert.equal(normalized.profile.models.mid, "user-selected-model");
            assert.equal(normalized.profile.userNotes, "Keep my own notes.");
            assert.equal(normalized.work[0].notes, "Keep work notes.");
            assert.deepEqual(normalized.onboarding.draft.skills, ["retired-local-skill"]);
            await store.mutate("setup_progress", { step: expected, draft: normalized.onboarding.draft }, normalized.revision);
            const reopened = await new WorkspaceStore(options).read();
            assert.equal(reopened.onboarding.step, expected, "already-v2 indices must not be mapped again");
            assert.equal(reopened.onboarding.flowVersion, 2);
            const persisted = JSON.parse(await readFile(store.path, "utf8"));
            assert.equal(persisted.profile.profileVersion, 2); assert.equal(persisted.onboarding.flowVersion, 2);
            assert.equal(await readFile(skillPath, "utf8"), "User-edited local guidance.\n");
        }
        const currentPreset = blankBoard("sample");
        currentPreset.profile = { ...intake, role: "pm", preset: "experiment-metrics" };
        assert.equal(normalizeSavedBoard(currentPreset).profile.preset, "experiment-metrics");
});
test("new PM-only onboarding rejects invalid roles/presets, stale fifth step and client-forged flow metadata", () => {
        const b = blankBoard("sample");
        assert.throws(() => applyCommand(b, "intake", { ...intake, role: "unsupported-role" }), /Only PM/);
        assert.throws(() => applyCommand(b, "intake", { ...intake, preset: "retired-preset" }), /supported PM preset/);
        assert.throws(() => applyCommand(b, "setup_progress", { step: 0, draft: { role: "unsupported-role" } }), /Only PM/);
        assert.throws(() => applyCommand(b, "setup_progress", { step: 0, draft: { preset: "retired-preset" } }), /supported PM preset/);
        assert.throws(() => applyCommand(b, "setup_progress", { step: 4, draft: { role: "pm" } }), /0\.\.3/);
        assert.throws(() => applyCommand(b, "setup_progress", { step: 3, flowVersion: 2, draft: { role: "pm" } }), /internal metadata/);
        const progress = applyCommand(b, "setup_progress", { step: 3, draft: { role: "pm" } });
        assert.equal(progress.onboarding.flowVersion, 2); assert.equal(progress.onboarding.step, 3);
});
