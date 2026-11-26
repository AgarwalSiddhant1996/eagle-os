import { WorkspaceStore, workspaceId, defaultDataRoot } from "./src/store.mjs";
import { startServer } from "./src/server.mjs";
import { join } from "node:path";
import { createNativeBridge, hostCanvasActions } from "./src/host-native.mjs";
import { hostState } from "./src/host.mjs";
import { assertHub, coreState, publicBoard, drainOwnerInbox } from "./src/orchestration.mjs";
import { domainViewsState } from "./src/domain-views.mjs";

// Supported extension hosts provide the SDK resolver; standalone remains optional.
const sdk = process.env.EAGLE_HOST_SDK || "@github/copilot-sdk/extension";
const startupAt = performance.now();
const startupDiagnostics = process.env.EAGLE_STARTUP_DIAGNOSTICS === "1";
const startupMark = (stage) => {
    if (startupDiagnostics) process.stderr.write(JSON.stringify({ component: "eagle-os-startup", stage, elapsedMs: Math.round(performance.now() - startupAt) }) + "\n");
};
async function startupAwait(stage, operation) {
    startupMark(`${stage}-started`);
    const pending = startupDiagnostics ? setTimeout(() => startupMark(`${stage}-pending`), 5000) : undefined;
    pending?.unref();
    try {
        const value = await operation();
        startupMark(`${stage}-completed`);
        return value;
    } catch (error) {
        startupMark(`${stage}-failed`);
        throw error;
    } finally { clearTimeout(pending); }
}
startupMark("local-modules-loaded");
const { joinSession, createCanvas } = await startupAwait("sdk-import", () => import(sdk));
const panels = new Map();
const dataRoot = process.env.EAGLE_DATA_ROOT || defaultDataRoot();
const skillWorkspace = workspaceId(process.env.EAGLE_WORKSPACE || "default");
let session;
startupMark("canvas-declaration-started");
const canvas = createCanvas({
    id: "eagle-os", displayName: "Eagle OS", description: "Purpose-first Today, Work and Evidence workspace.",
    inputSchema: { type: "object", properties: { workspace: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,59}$" } }, required: ["workspace"], additionalProperties: false },
    open: async ({ instanceId, input }) => {
        const id = workspaceId(input.workspace);
        const previous = panels.get(instanceId);
        if (previous && previous.store.id !== id) { await previous.panel.close(); panels.delete(instanceId); }
        if (!panels.has(instanceId)) {
            const store = new WorkspaceStore({ id, root: dataRoot });
            const bridge = createNativeBridge(() => session, instanceId);
            panels.set(instanceId, { store, bridge, panel: await startServer({ store, hostMode: "native-canvas", skillWorkspace, hostBridge: bridge }) });
        }
        return { title: "Eagle OS", url: panels.get(instanceId).panel.url };
    },
    actions: [
        ...hostCanvasActions((instanceId) => panels.get(instanceId)),
        { name: "get_state", description: "Read this panel's workspace. No source collection or card creation is implied.",
            handler: async ({ instanceId }) => {
                const active = panels.get(instanceId);
                if (!active) throw Error("Open this workspace panel first.");
                let board = await active.store.read();
                if (board.core?.hubSessionId === active.bridge.sessionId && board.core.hubInstanceId === active.bridge.instanceId) {
                    await drainOwnerInbox(active.store, active.bridge); board = await active.store.read();
                }
                return { ...publicBoard(board), core: coreState(board, active.bridge), views: domainViewsState(board), host: hostState(board, active.bridge) };
            } },
        { name: "record_card", description: "Prepare one evidence-backed decision card for Today. Never sends externally. Requires current revision and existing verified evidence.",
            inputSchema: { type: "object", properties: { expectedRevision: { type: "integer", minimum: 0 },
                payload: { type: "object", properties: { key: { type: "string" }, evidenceId: { type: "string" }, workId: { type: "string" },
                    title: { type: "string" }, why: { type: "string" }, options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
                    recommendedIndex: { type: "integer", minimum: 0 }, afterDecision: { type: "string" },
                    kind: { type: "string", enum: ["decision", "draft"] }, consequences: { type: "string" },
                    draft: { type: "object", properties: { channel: { type: "string" }, target: { type: "string" }, text: { type: "string" } },
                        required: ["channel", "target", "text"], additionalProperties: false } },
                    required: ["key", "evidenceId", "title", "why", "options", "recommendedIndex", "afterDecision"], additionalProperties: false } },
                required: ["expectedRevision", "payload"], additionalProperties: false },
            handler: async ({ instanceId, input }) => {
                const active = panels.get(instanceId);
                if (!active) throw Error("Open this workspace panel first.");
                assertHub(await active.store.read(), active.bridge, { allowUnbound: true });
                const board = await active.store.mutate("card", input.payload, input.expectedRevision);
                return { revision: board.revision, card: board.cards.at(-1) };
            } },
    ],
    onClose: async ({ instanceId }) => { const active = panels.get(instanceId); if (active) await active.panel.close(); panels.delete(instanceId); },
});
startupMark("canvas-declaration-completed");
session = await startupAwait("join-session", () => joinSession({
    skillDirectories: [join(dataRoot, "workspaces", skillWorkspace, "skills")], canvases: [canvas],
}));
