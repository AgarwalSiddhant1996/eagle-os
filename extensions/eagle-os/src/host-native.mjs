import { InputError, credentialFree } from "./store.mjs";
import { hostResultSchema, hostPrompt, recordHostResult, queueHostRequest, sourceTypes, selectionEstablished } from "./host.mjs";
import { corePrompt, coreState, recordCoreEvent, drainOwnerInbox, coreMutation, assertHub, submitCoreRequest, dispatchPendingCore } from "./orchestration.mjs";

const str = { type: "string", minLength: 1, maxLength: 1000 };
const obj = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const toolRead = obj({ tool: { enum: ["create_session", "get_session", "send_session_message", "get_session_automation", "save_session_automation"] }, callId: str, sessionId: str, readAt: str, detail: str });
const check = obj({ status: { enum: ["verified", "blocked"] }, detail: str, method: str, readAt: str });
export const coreEventSchema = obj({ jobId: str, type: { enum: ["routing", "owner_created", "owner_reused", "capabilities", "message_accepted", "owner_schedule", "blocked", "cancelled"] }, detail: str,
    owner: obj({ sessionId: str, name: str, appUrl: str, executionLocation: { const: "local" }, configuredModel: { type: "string", maxLength: 100 } },
        ["sessionId", "name", "appUrl", "executionLocation"]),
    receipts: obj({ create: toolRead, inspect: toolRead, message: toolRead, save: toolRead }, []),
    checks: obj({ skills: obj({ ...check.properties, accessMode: { enum: ["guidance-read", "native-loaded", "unavailable"] } }), sourceAccess: check, model: check }),
    schedule: obj({ id: str, sessionId: str, provider: { const: "session-automation" }, interval: { const: "once" }, runAt: str, status: { const: "enabled" }, executionLocation: { const: "local" }, previousAutomation: { const: "none" } }),
}, ["jobId", "type", "detail"]);
export const scheduledWakeSchema = obj({ scheduleId: str, requestId: str, runId: str, trigger: { const: "schedule" },
    receipt: obj({ ...toolRead.properties, tool: { const: "get_session_automation" }, scheduleId: str, runId: str, trigger: { const: "schedule" }, startedAt: str }),
});

export function createNativeBridge(session, instanceId) {
    const current = typeof session === "function" ? session : () => session;
    return {
        instanceId,
        get sessionId() { return current()?.sessionId ?? ""; },
        async send({ prompt, displayPrompt }) {
            const joined = current();
            if (!joined?.sessionId || typeof joined.send !== "function") throw new InputError("Native host session is disconnected.", 503);
            return joined.send({ prompt, displayPrompt });
        },
    };
}
export function hostCanvasActions(activePanel) {
    const active = (instanceId) => {
        const panel = activePanel(instanceId);
        if (!panel) throw new InputError("Open this workspace panel first.", 409);
        return panel;
    };
    return [
        {
            name: "prepare_scheduled_check", description: "Hub-only preregister one fresh nonce-bound isolated local owner scheduled-check assignment after a verified pilot. Returns actual tool instructions; does NOT create/save/run any automation itself.",
            inputSchema: obj({ id: str, workId: str, goal: str, sourceIds: { type: "array", items: str, minItems: 1, maxItems: 5 },
                tier: { enum: ["fast", "mid", "complex"] }, consent: { const: true }, expectedRevision: { type: "integer", minimum: 0 } }),
            handler: async ({ instanceId, input }) => {
                const { store, bridge } = active(instanceId);
                assertHub(await store.read(), bridge);
                const queued = await submitCoreRequest(store, bridge, input, { inline: true, scheduledCheck: true });
                const board = await store.read(), job = board.core.jobs.find((j) => j.id === input.id);
                return { ...queued, prompt: corePrompt(board, job, { fresh: true, directory: store.directory }) };
            },
        },
        {
            name: "get_core_request", description: "Read the bound hub's persisted owner assignment and exact supported app-tool/local-inbox instructions. No source read or owner creation is implied.",
            inputSchema: obj({ jobId: str }),
            handler: async ({ instanceId, input }) => {
                const { store, bridge } = active(instanceId), board = await store.read();
                assertHub(board, bridge);
                const job = board.core.jobs.find((j) => j.id === input.jobId);
                if (!job) throw new InputError("Choose an existing core assignment.", 404);
                return { job: coreState(board, bridge).jobs.find((j) => j.id === input.jobId),
                    prompt: corePrompt(board, job, { fresh: true, directory: store.directory }) };
            },
        },
        {
            name: "record_core_event", description: "Hub-only typed actual app-tool receipts: register isolated owner, check actor capabilities and record message acceptance. Never marks task completion.",
            inputSchema: coreEventSchema,
            handler: async ({ instanceId, input }) => {
                const { store, bridge } = active(instanceId);
                return recordCoreEvent(store, bridge, input);
            },
        },
        {
            name: "record_work", description: "Hub-only drain of immutable local owner inbox. Authenticates per-assignment capability, registered owner generation and source version. Child cannot write board or call a foreign canvas.",
            inputSchema: obj({}),
            handler: async ({ instanceId }) => {
                const { store, bridge } = active(instanceId);
                const result = await drainOwnerInbox(store, bridge);
                const routing = await dispatchPendingCore(store, bridge);
                const board = await store.read();
                return { ...result, routing, revision: board.revision, core: coreState(board, bridge) };
            },
        },
        {
            name: "record_scheduled_wake", description: "Record exact observed provider scheduled-trigger/readback and completed collection. Manual Run now or metadata save is not a scheduled wake. Hub agent attestation, not cryptographic scheduler provenance.",
            inputSchema: scheduledWakeSchema,
            handler: async ({ instanceId, input }) => {
                const { store, bridge } = active(instanceId);
                assertHub(await store.read(), bridge);
                const board = await coreMutation(store, "core_scheduled_wake", input);
                return { revision: board.revision, core: coreState(board, bridge) };
            },
        },
        {
            name: "get_host_request", description: "Read a persisted scoped request and its exact callback instructions. No collection is implied.",
            inputSchema: { type: "object", properties: { requestId: { type: "string" } }, required: ["requestId"], additionalProperties: false },
            handler: async ({ instanceId, input }) => {
                const { store, bridge } = active(instanceId), board = await store.read();
                assertHub(board, bridge, { allowUnbound: true });
                const request = board.host?.requests.find((r) => r.id === input.requestId);
                if (!request || request.hostSessionId !== bridge.sessionId || request.instanceId !== instanceId) throw new InputError("This host instance does not own the request.", 409);
                return { request, prompt: hostPrompt(board, request, { fresh: true }) };
            },
        },
        {
            name: "record_host_result", description: "Record a bounded owning-session callback with exact request id/next sequence. Setup success/partial MUST include actual selected source bindings, full read receipts and matching evidence/work relations; see the concrete minimal example in inputSchema.description. All-failed selected setup requires scoped blockedSources, not success prose. Rejected payloads stay retryable; terminal IDs remain closed. Never re-probe auth/403 denials to recover. No external sends.",
            inputSchema: hostResultSchema,
            handler: async ({ instanceId, input }) => {
                const { store, bridge } = active(instanceId);
                return recordHostResult(store, bridge, input);
            },
        },
        {
            name: "request_collection", description: "Persist a new collector request under an already read-back verified schedule's bounded consent. Returns instructions to execute in this turn, without a second session.send.",
            inputSchema: { type: "object", properties: { workspace: { type: "string" }, id: { type: "string" },
                scope: { type: "object", properties: { purpose: { type: "string" }, sources: { type: "array", items: { type: "string", enum: sourceTypes }, maxItems: 5 }, repository: { type: "string" },
                    inventoryRequestId: { type: "string" }, selectedToolIds: { type: "array", items: { type: "string" }, maxItems: 80 }, selectedRepoIds: { type: "array", items: { type: "string" }, maxItems: 30 },
                    sourceIds: { type: "array", items: { type: "string" }, maxItems: 5 }, autoPrepare: { type: "boolean" } },
                    required: ["purpose", "sources"], additionalProperties: false } }, required: ["workspace", "id", "scope"], additionalProperties: false },
            handler: async ({ instanceId, input }) => {
                const { store, bridge } = active(instanceId);
                credentialFree(input);
                const board = await store.read(), schedule = board.host?.automation;
                assertHub(board, bridge, { allowUnbound: true });
                if (input.workspace !== store.id || !schedule || schedule.status !== "enabled" || schedule.hostSessionId !== bridge.sessionId || schedule.instanceId !== instanceId) throw new InputError("No current verified schedule is bound to this host instance.", 409);
                if (selectionEstablished(board.host) && !schedule.scope.inventoryRequestId ||
                    schedule.selectionSetupRequestId && schedule.selectionSetupRequestId !== board.host.selection?.setupRequestId) throw new InputError("Saved schedule source selection is stale; explicitly reconfigure it before collecting.", 409);
                const scope = input.scope;
                if (!scope || scope.purpose !== schedule.scope.purpose || (scope.repository || "") !== (schedule.scope.repository || "") ||
                    !Array.isArray(scope.sources) || JSON.stringify([...new Set(scope.sources)].sort()) !== JSON.stringify(schedule.scope.sources)) throw new InputError("Collector scope differs from saved schedule consent.", 403);
                for (const key of ["inventoryRequestId", "selectedToolIds", "selectedRepoIds", "sourceIds", "autoPrepare"]) {
                    if (scope[key] !== undefined && JSON.stringify(Array.isArray(scope[key]) ? [...scope[key]].sort() : scope[key]) !==
                        JSON.stringify(Array.isArray(schedule.scope[key]) ? [...schedule.scope[key]].sort() : schedule.scope[key])) throw new InputError("Collector tool/repository IDs differ from saved schedule consent.", 403);
                }
                const lockedScope = { ...scope };
                for (const key of ["inventoryRequestId", "selectedToolIds", "selectedRepoIds", "sourceIds", "autoPrepare"]) if (schedule.scope[key] !== undefined) lockedScope[key] = structuredClone(schedule.scope[key]);
                const queued = await queueHostRequest(store, bridge,
                    { id: input.id, kind: "collect", consent: true, scope: lockedScope, expectedRevision: board.revision,
                        ...(schedule.sourceId ? { sourceId: schedule.sourceId } : {}), ...(schedule.workId ? { workId: schedule.workId } : {}) },
                    { scheduleId: schedule.id, inline: true });
                return { request: queued.request, prompt: hostPrompt(queued.board, queued.request) };
            },
        },
    ];
}
