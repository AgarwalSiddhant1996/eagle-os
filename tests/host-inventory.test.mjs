import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { WorkspaceStore } from "../src/store.mjs";
import { startServer } from "../src/server.mjs";
import { createNativeBridge, hostCanvasActions } from "../src/host-native.mjs";
import { recordHostResult } from "../src/host.mjs";
import { submitCoreRequest, coreState } from "../src/orchestration.mjs";

const profile = { title: "Review workspace", role: "pm", preset: "feature-pm", jobs: ["Review changes"], decisions: ["Pick a next step"], sources: [] };
const purpose = "Review selected repository metadata";
const read = (identity = "inventory-host") => ({ identity, readback: "Deterministic adapter metadata readback.", readAt: new Date().toISOString(), method: "Read-only deterministic adapter" });
const coverage = { complete: true, detail: "All selected scoped metadata read." };
const inventory = () => ({
    tools: [
        { id: "repo-reader", name: "Repository metadata reader", provider: "host", sourceTypes: ["repository"], capabilities: ["read metadata"], status: "available", detail: "Advertised availability; account authorization has not been checked." },
        { id: "repo-other", name: "Other repository reader", provider: "optional", sourceTypes: ["repository"], capabilities: ["read metadata"], status: "available", detail: "Available but unchecked in this test selection." },
        { id: "docs-reader", name: "Document reader", provider: "optional", sourceTypes: ["documents"], capabilities: ["read documents"], status: "available", detail: "Available but unchecked in this test selection." },
        { id: "host-helper", name: "Host helper", provider: "host", sourceTypes: [], capabilities: ["describe tools", "write tool advertised", "remote-worker"], status: "available", detail: "Host metadata only; descriptive capabilities grant no source or write authority." },
        { id: "metrics-auth", name: "Metrics reader", provider: "optional", sourceTypes: ["metrics"], capabilities: ["read metrics"], status: "needs-sign-in", detail: "Existing registry metadata reports sign-in is required." },
        { id: "design-missing", name: "Design reader", provider: "optional", sourceTypes: ["design"], capabilities: ["read designs"], status: "missing", detail: "Selected optional integration is unavailable." },
        { id: "messages-unknown", name: "Message reader", provider: "optional", sourceTypes: ["messages"], capabilities: ["read messages"], status: "unknown", detail: "Availability/authentication cannot be established from metadata." },
    ],
    repositories: [
        { id: "repo-a", name: "sample/alpha", status: "available", detail: "Configured repository name only." },
        { id: "repo-b", name: "sample/beta", status: "available", detail: "Configured repository name only." },
        { id: "repo-excluded", name: "sample/excluded", status: "available", detail: "Configured but unchecked repository." },
        { id: "repo-unknown", name: "sample/unknown", status: "unknown", detail: "Configured availability is unknown." },
    ],
    receipt: read(),
});
const selection = (inventoryRequestId = "inventory-one") => ({ purpose, sources: ["repository"], inventoryRequestId,
    selectedToolIds: ["repo-reader", "host-helper"], selectedRepoIds: ["repo-a", "repo-b"] });
const source = (repoId = "repo-a", repo = "sample/alpha", sourceId = "source-a") => ({
    id: sourceId, toolId: "repo-reader", repoId, type: "repository", label: repo, repo, status: "verified", detail: "Actual selected repository metadata read.",
    coverage, receipt: read(repo),
});
const sources = () => [source(), source("repo-b", "sample/beta", "source-b")];
const sourceReadResult = (items = sources()) => {
    const key = (source) => source.id === "source-a" ? "review-a" : `review-${source.id}`;
    return { sources: items,
        work: items.map((source) => ({ sourceId: source.id, externalKey: key(source), title: "Review actual selected source record" })),
        evidence: items.map((source) => ({ sourceId: source.id, externalKey: source.id === "source-a" ? "evidence-a" : `evidence-${source.id}`,
            workExternalKey: key(source), summary: "Actual bounded selected source record read.", receipt: source.receipt })) };
};
async function fixture(t, { configured = true, sessionId = "inventory-host" } = {}) {
    const fixtures = resolve(".test-output");
    await mkdir(fixtures, { recursive: true });
    const root = await mkdtemp(join(fixtures, "host-inventory-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    const store = new WorkspaceStore({ root: join(root, "data"), installationRoot: join(root, "installation"), id: "sample" });
    if (configured) await store.mutate("intake", profile, 0);
    const sent = [], bridge = createNativeBridge({ sessionId, async send(message) {
        const board = await store.read();
        assert.equal(message.prompt.includes("get_core_request") ? board.core.jobs.at(-1).status : board.host.requests.at(-1).status, "queued");
        sent.push(message); return `accepted-${sent.length}`;
    } }, "inventory-panel");
    const panel = await startServer({ store, hostMode: "native-canvas", hostBridge: bridge });
    t.after(() => panel.close());
    const base = new URL(panel.url), headers = { "X-Workspace-Token": base.pathname.split("/")[1], Origin: base.origin, "Content-Type": "application/json" };
    const post = async (path, body) => {
        const response = await fetch(new URL(path, base), { method: "POST", headers, body: JSON.stringify(body) });
        return { status: response.status, ...(await response.json()) };
    };
    const state = async () => (await fetch(new URL("state", base), { headers })).json();
    const actions = hostCanvasActions((instanceId) => instanceId === "inventory-panel" ? { store, bridge } : undefined);
    const action = (name, input) => actions.find((a) => a.name === name).handler({ instanceId: "inventory-panel", input });
    const request = async (id, kind, scope, extra = {}) => post("host-request",
        { id, kind, scope, consent: kind !== "inventory", expectedRevision: (await store.read()).revision, ...extra });
    const callback = (requestId, sequence, status, result = {}, extra = {}) => action("record_host_result",
        { workspace: "sample", requestId, ownerSessionId: sessionId, sequence, status, detail: "Deterministic metadata/source adapter outcome.", result, ...extra });
    const finish = async (requestId, result) => { await callback(requestId, 1, "running"); return callback(requestId, 2, "verified", result); };
    const discover = async (id = "inventory-one", result = inventory()) => {
        const queued = await request(id, "inventory", { purpose, sources: [] });
        assert.equal(queued.status, 200);
        await finish(id, { inventory: result });
        return result;
    };
    const connect = async (id = "selected-setup", scope = selection()) => {
        const queued = await request(id, "setup", scope);
        assert.equal(queued.status, 200);
        await finish(id, sourceReadResult());
        return queued;
    };
    return { store, bridge, sent, post, state, action, request, callback, finish, discover, connect, url: panel.url };
}
test("metadata inventory before profile -> unchecked exclusions -> selected setup -> allowed collect/owner ingestion", async (t) => {
    const f = await fixture(t, { configured: false });
    assert.equal((await f.state()).host.inventory, null);
    const draft = { role: "pm", title: "Review workspace", jobs: ["Review changes"], decisions: "Pick the next step" };
    await f.post("command", { command: "setup_progress", payload: { step: 1, draft }, expectedRevision: 0 });
    const metadata = await f.discover();
    assert.match(f.sent[0].prompt, /FIRST.*get_host_request/);
    assert.doesNotMatch(f.sent[0].prompt, /inputSchema|"tools":/);
    const snapshot = await f.action("get_host_request", { requestId: "inventory-one" });
    assert.match(snapshot.prompt, /already terminal/);
    let s = await f.state();
    assert.equal(s.board.profile, null); assert.equal(s.host.sources.length, 0);
    assert.equal(s.host.inventory.requestId, "inventory-one"); assert.equal(s.host.inventory.status, "verified");
    assert.equal(s.host.inventory.tools.find((tool) => tool.id === "metrics-auth").status, "needs-sign-in");
    assert.equal(s.host.inventory.tools.find((tool) => tool.id === "design-missing").status, "missing");
    assert.equal(s.host.inventory.tools.find((tool) => tool.id === "messages-unknown").status, "unknown");
    assert.deepEqual(s.skills.capabilities, [], "descriptive capabilities do not activate remote-worker");
    const committedSelection = { ...selection(), excludedToolIds: ["repo-other", "docs-reader", "metrics-auth", "design-missing", "messages-unknown"],
        excludedRepoIds: ["repo-excluded", "repo-unknown"] };
    await f.connect("selected-setup", committedSelection);
    s = await f.state();
    assert.equal(s.board.profile, null); assert.equal(s.board.onboarding.step, 1); assert.equal(s.board.onboarding.flowVersion, 2);
    assert.deepEqual(s.host.selection.selectedToolIds, ["host-helper", "repo-reader"]);
    const reopenedStore = new WorkspaceStore({ root: f.store.root, id: f.store.id, installationRoot: f.store.installationRoot });
    const reopened = await reopenedStore.read();
    assert.deepEqual(reopened.host.requests.find((r) => r.id === "selected-setup").scope.excludedToolIds, [...committedSelection.excludedToolIds].sort());
    assert.deepEqual(reopened.host.requests.find((r) => r.id === "selected-setup").scope.excludedRepoIds, [...committedSelection.excludedRepoIds].sort());
    const reopenedPanel = await startServer({ store: reopenedStore, hostBridge: f.bridge });
    t.after(() => reopenedPanel.close());
    const reopenedUrl = new URL(reopenedPanel.url);
    assert.notEqual(reopenedUrl.origin, new URL(f.url).origin);
    const afterOriginChange = await (await fetch(new URL("state", reopenedUrl), { headers: { "X-Workspace-Token": reopenedUrl.pathname.split("/")[1] } })).json();
    assert.deepEqual(afterOriginChange.host.requests.find((r) => r.id === "selected-setup").scope.excludedToolIds, [...committedSelection.excludedToolIds].sort());
    assert.deepEqual(s.host.sources.map((entry) => entry.repo), ["sample/alpha", "sample/beta"]);
    assert.ok(s.host.sources.every((entry) => entry.toolId === "repo-reader" && entry.inventoryRequestId === "inventory-one"));
    assert.match(f.sent.at(-1).prompt, /never authorize write tools/);
    assert.doesNotMatch(f.sent.at(-1).prompt, /sample\/excluded/);
    await f.post("command", { command: "intake", payload: profile, expectedRevision: s.board.revision });
    const collect = await f.request("selected-collect", "collect", { purpose, sources: ["repository"] });
    assert.equal(collect.status, 200); assert.deepEqual(collect.request.scope.selectedRepoIds, ["repo-a", "repo-b"]);
    assert.equal(collect.request.scope.inventoryRequestId, "inventory-one");
    await f.finish("selected-collect", { sources: sources(),
        work: [{ sourceId: "source-a", externalKey: "review-a", title: "Review selected metadata" }],
        evidence: [{ sourceId: "source-a", externalKey: "evidence-a", workExternalKey: "review-a", summary: "Actual selected metadata read.", receipt: read("sample/alpha") }],
        owners: [{ sourceId: "source-a", workExternalKey: "review-a", sessionId: "inventory-host", name: "Review owner", receipt: read() }] });
    s = await f.state();
    assert.equal(s.board.work.length, 2); assert.equal(s.board.evidence.length, 2); assert.equal(s.host.owners[0].sessionId, "inventory-host");
    assert.deepEqual(s.host.inventory.tools, metadata.tools.map((tool) => ({ ...tool, sourceTypes: [...tool.sourceTypes].sort() })));
});
test("inventory is consent:false metadata only, cannot ingest content, full schemas, credentials, duplicate names or paths", async (t) => {
    const f = await fixture(t, { configured: false });
    assert.equal((await f.request("consented-inventory", "inventory", { purpose, sources: [] }, { consent: true })).status, 400);
    assert.equal((await f.request("source-inventory", "inventory", { purpose, sources: ["messages"] })).status, 400);
    assert.equal((await f.request("repo-inventory", "inventory", { purpose, sources: [], repository: "sample/alpha" })).status, 400);
    const request = await f.request("inventory-one", "inventory", { purpose, sources: [] });
    assert.equal(request.status, 200);
    const fresh = await f.action("get_host_request", { requestId: "inventory-one" });
    assert.match(fresh.prompt, /ZERO mail\/chat\/spec\/document\/file content reads/);
    assert.match(fresh.prompt, /Do NOT crawl a connector catalog/);
    await f.callback("inventory-one", 1, "running");
    const attempts = [
        { inventory: inventory(), sources: [source()] },
        { work: [{ title: "Do not ingest" }] },
        { remote: { status: "verified" } },
        { inventory: { ...inventory(), credentials: { password: "do-not-store" } } },
        { inventory: { ...inventory(), receipt: { ...read(), identity: "another-host" } } },
        { inventory: { ...inventory(), tools: [{ ...inventory().tools[0], inputSchema: { type: "object" } }] } },
        { inventory: { ...inventory(), tools: [inventory().tools[0], { ...inventory().tools[0], id: "another-id" }] } },
        { inventory: { ...inventory(), tools: [{ ...inventory().tools[0], status: "verified" }] } },
        { inventory: { ...inventory(), repositories: [{ ...inventory().repositories[0], name: "/outside/config" }] } },
        { inventory: { ...inventory(), tools: Array.from({ length: 81 }, () => inventory().tools[0]) } },
    ];
    for (const result of attempts) await assert.rejects(() => f.callback("inventory-one", 2, "verified", result));
    const untouched = await f.state();
    assert.deepEqual(untouched.host.inventory.tools, []); assert.equal(untouched.host.sources.length, 0); assert.equal(untouched.board.work.length, 0);
    await f.callback("inventory-one", 2, "verified", { inventory: inventory() });
});
test("selected setup rejects unavailable/unknown descriptors, stale inventory, omitted IDs and expanded sources/repositories", async (t) => {
    const f = await fixture(t); await f.discover();
    for (const scope of [
        { purpose, sources: ["repository"], repository: "sample/alpha" },
        { ...selection(), selectedToolIds: ["metrics-auth"], sources: ["metrics"] },
        { ...selection(), selectedToolIds: ["design-missing"], sources: ["design"] },
        { ...selection(), selectedToolIds: ["messages-unknown"], sources: ["messages"] },
        { ...selection(), selectedRepoIds: ["repo-unknown"] },
        { ...selection(), selectedRepoIds: ["not-in-inventory"] },
        { ...selection(), sources: ["repository", "documents"] },
        { ...selection(), repository: "sample/excluded" },
        { ...selection(), selectedToolIds: ["repo-reader", "repo-reader"] },
        { ...selection(), excludedToolIds: ["repo-reader"] },
        { ...selection(), excludedRepoIds: ["repo-a"] },
        { ...selection(), excludedToolIds: ["not-a-known-tool"] },
        { ...selection(), excludedRepoIds: ["not-a-known-repo"] },
    ]) assert.equal((await f.request(`denied-${(await f.store.read()).revision}-${scope.selectedToolIds?.join("-") || "omitted"}`, "setup", scope)).status, 400);
    assert.equal((await f.request("no-setup-collect", "collect", { purpose, sources: ["repository"] })).status, 400);
    assert.equal((await f.request("no-setup-schedule", "schedule", { purpose, sources: ["repository"], cadence: "daily 09:00" })).status, 400);
    await f.discover("inventory-newer");
    assert.equal((await f.request("stale-setup", "setup", selection())).status, 409);
    assert.equal((await f.request("new-setup", "setup", selection("inventory-newer"))).status, 200);
    assert.equal(f.sent.length, 3, "invalid source selections never dispatch");
});
test("typed source receipts enforce exact selected tool/repo bindings and complete selected-repository coverage", async (t) => {
    const f = await fixture(t); await f.discover();
    await f.request("selected-setup", "setup", selection()); await f.callback("selected-setup", 1, "running");
    for (const rejected of [
        { ...source(), toolId: "repo-other" },
        { ...source(), toolId: "host-helper" },
        { ...source(), toolId: undefined },
        source("repo-excluded", "sample/excluded"),
        { ...source(), repo: "sample/excluded", receipt: read("sample/excluded") },
        { ...source(), type: "documents", repoId: undefined },
    ]) await assert.rejects(() => f.callback("selected-setup", 2, "verified", { sources: [rejected, sources()[1]] }), /selected|selection|scope/);
    await assert.rejects(() => f.callback("selected-setup", 2, "verified", { sources: [source()] }), /every selected repository/);
    assert.equal((await f.state()).host.sources.length, 0);
    await f.callback("selected-setup", 2, "verified", sourceReadResult());
    assert.equal((await f.request("expanded-collect", "collect", { ...selection(), selectedToolIds: ["repo-reader", "repo-other", "host-helper"] })).status, 409);
    assert.equal((await f.request("excluded-repo-collect", "collect", { ...selection(), selectedRepoIds: ["repo-a", "repo-excluded"] })).status, 409);
    assert.equal((await f.request("documents-collect", "collect", { purpose, sources: ["documents"] })).status, 400);
    await f.request("bound-collect", "collect", { purpose, sources: ["repository"] }); await f.callback("bound-collect", 1, "running");
    await assert.rejects(() => f.callback("bound-collect", 2, "verified", { sources: [{ ...source(), toolId: "repo-other" }, sources()[1]] }), /excluded|rebound/);
});
test("inventory/callback replay is retry-safe; newer listing and changed source consent reject stale callbacks", async (t) => {
    const f = await fixture(t);
    const metadata = inventory(); await f.discover("inventory-one", metadata);
    const sent = f.sent.length, revision = (await f.store.read()).revision;
    const replay = await f.request("inventory-one", "inventory", { purpose, sources: [] }, { expectedRevision: 0 });
    assert.equal(replay.duplicate, true); assert.equal(f.sent.length, sent);
    await f.callback("inventory-one", 2, "verified", { inventory: metadata });
    assert.equal((await f.store.read()).revision, revision);
    await assert.rejects(() => f.callback("inventory-one", 2, "verified", { inventory: { ...metadata, tools: [] } }), /content changed/);
    await assert.rejects(() => recordHostResult(f.store, { ...f.bridge, sessionId: "replacement-host" }, { requestId: "inventory-one" }), /does not own/);
    await f.connect();
    await f.request("old-collect", "collect", { purpose, sources: ["repository"] });
    await f.request("unfinished-inventory", "inventory", { purpose, sources: [] });
    await f.discover("inventory-newer");
    await assert.rejects(() => f.callback("unfinished-inventory", 1, "running"), /Stale inventory/);
    assert.equal((await f.request("old-inventory-setup", "setup", selection())).status, 409);
    const stillBound = await f.request("bound-after-refresh", "collect", { purpose, sources: ["repository"] });
    assert.equal(stillBound.status, 200); assert.equal(stillBound.request.scope.inventoryRequestId, "inventory-one");
    await f.request("replacement-setup", "setup", selection("inventory-newer"));
    const stale = await f.action("get_host_request", { requestId: "old-collect" });
    assert.match(stale.prompt, /stale.*selected source consent changed/); assert.doesNotMatch(stale.prompt, /Current source registry/);
    await assert.rejects(() => f.callback("old-collect", 1, "running"), /consent changed/);
    await assert.rejects(() => f.callback("bound-after-refresh", 1, "running"), /consent changed/);
});
test("partial inventory cannot authorize setup and starting inventory closes legacy callback bypass", async (t) => {
    const f = await fixture(t);
    await f.request("legacy-pending", "setup", { purpose, sources: ["repository"], repository: "sample/alpha" });
    await f.request("inventory-one", "inventory", { purpose, sources: [] });
    await assert.rejects(() => f.callback("legacy-pending", 1, "running"), /predates inventory selection/);
    await f.callback("inventory-one", 1, "running");
    const resumed = await f.action("get_host_request", { requestId: "inventory-one" });
    assert.match(resumed.prompt, /Running callback already persisted/);
    await f.callback("inventory-one", 2, "partial", { inventory: inventory() });
    assert.equal((await f.state()).host.inventory.status, "partial");
    assert.equal((await f.request("partial-selection", "setup", selection())).status, 409);
    assert.equal((await f.request("legacy-after-inventory", "setup", { purpose, sources: ["repository"], repository: "sample/alpha" })).status, 400);
});
test("pure host tool selection remains metadata-only and never authorizes advertised write or remote capabilities", async (t) => {
    const f = await fixture(t); await f.discover();
    const scope = { purpose: "Keep host metadata available", sources: [], inventoryRequestId: "inventory-one", selectedToolIds: ["host-helper"], selectedRepoIds: [],
        excludedToolIds: ["repo-reader", "docs-reader"], excludedRepoIds: ["repo-a", "repo-b"] };
    assert.equal((await f.request("host-only-setup", "setup", scope)).status, 200);
    await f.callback("host-only-setup", 1, "running");
    await assert.rejects(() => f.callback("host-only-setup", 2, "verified", {}), /metadata\/non-source/);
    await f.callback("host-only-setup", 2, "blocked", {});
    const state = await f.state();
    assert.equal(state.host.sources.length, 0); assert.equal(state.board.work.length, 0);
    assert.equal(state.host.remote.status, "unverified"); assert.deepEqual(state.skills.capabilities, []);
    assert.equal((await f.request("host-only-data", "collect", { purpose, sources: ["documents"] })).status, 400);
    assert.match(f.sent.at(-1).prompt, /grant NO account\/source access/);
});
test("connector dispatch only offers one explicitly selected unavailable capability and never grants data access", async (t) => {
    const f = await fixture(t, { configured: false }); await f.discover();
    const offerScope = (toolId) => ({ purpose: "Offer this selected required capability", sources: [], inventoryRequestId: "inventory-one", selectedToolIds: [toolId], selectedRepoIds: [] });
    assert.equal((await f.request("available-offer", "connector", offerScope("repo-reader"))).status, 400);
    assert.equal((await f.request("unknown-offer", "connector", offerScope("messages-unknown"))).status, 400);
    assert.equal((await f.request("source-offer", "connector", { ...offerScope("design-missing"), sources: ["design"] })).status, 400);
    await f.request("signin-offer", "connector", offerScope("metrics-auth"));
    const fresh = await f.action("get_host_request", { requestId: "signin-offer" });
    assert.match(fresh.prompt, /ONLY a supported native sign-in\/catalog OFFER/);
    await f.callback("signin-offer", 1, "running");
    await assert.rejects(() => f.callback("signin-offer", 2, "verified", { connector: { toolId: "metrics-auth", status: "offered", detail: "No real offer receipt", instruction: "Not sufficient" } }), /read receipt/);
    await f.callback("signin-offer", 2, "needs-sign-in", { connector: { toolId: "metrics-auth", status: "needs-sign-in",
        detail: "No supported native sign-in UI capability is available.", instruction: "Open the owning host's supported account settings; no sign-in was performed." } });
    await f.request("missing-offer", "connector", offerScope("design-missing"));
    await f.callback("missing-offer", 1, "running");
    await assert.rejects(() => f.callback("missing-offer", 2, "verified", { connector: { toolId: "repo-other", status: "offered", detail: "Wrong tool", instruction: "Wrong offer", receipt: read("repo-other") } }), /selected unavailable/);
    await assert.rejects(() => f.callback("missing-offer", 2, "verified", { sources: [source()] }), /outside this request kind/);
    await f.callback("missing-offer", 2, "verified", { connector: { toolId: "design-missing", status: "offered",
        detail: "Deterministic test adapter presented the selected matching offer.", instruction: "Review the native approval card; nothing was installed.", receipt: read("design-missing") } });
    const state = await f.state();
    assert.equal(state.host.requests.find((r) => r.id === "signin-offer").connector.status, "needs-sign-in");
    assert.equal(state.host.requests.at(-1).connector.status, "offered");
    assert.equal(state.host.sources.length, 0); assert.equal(state.host.selection, null); assert.equal(state.board.work.length, 0);
    assert.equal(state.host.inventory.tools.find((tool) => tool.id === "design-missing").status, "missing");
});
test("scheduled collector retains exact selected IDs and blocks changed consent instead of broadening source types", async (t) => {
    const f = await fixture(t); await f.discover(); await f.connect();
    await f.request("selected-schedule", "schedule", { purpose, sources: ["repository"], cadence: "daily 09:00" });
    await f.finish("selected-schedule", { automation: { id: "saved-selected-schedule", name: "Selected collector", cadence: "daily 09:00", status: "enabled",
        lastRunAt: null, nextRunAt: new Date(Date.now() + 86400000).toISOString(), coverage, receipt: read("saved-selected-schedule"), sessionId: "inventory-host", provider: "session-automation" } });
    let state = await f.state();
    assert.deepEqual(state.host.automation.scope.selectedRepoIds, ["repo-a", "repo-b"]);
    assert.deepEqual(state.host.automation.scope.selectedToolIds, ["host-helper", "repo-reader"]);
    const sends = f.sent.length;
    const wake = await f.action("request_collection", { workspace: "sample", id: "selected-wake", scope: { purpose, sources: ["repository"] } });
    assert.deepEqual(wake.request.scope.selectedToolIds, ["host-helper", "repo-reader"]);
    assert.deepEqual(wake.request.scope.selectedRepoIds, ["repo-a", "repo-b"]); assert.equal(f.sent.length, sends);
    await f.finish("selected-wake", { sources: sources() });
    await assert.rejects(() => f.action("request_collection", { workspace: "sample", id: "expanded-wake", scope: { ...selection(), selectedToolIds: ["repo-reader", "repo-other"] } }), /differ from saved/);
    await f.discover("inventory-newer");
    await f.request("replacement-setup", "setup", selection("inventory-newer"));
    await assert.rejects(() => f.action("request_collection", { workspace: "sample", id: "stale-wake", scope: { purpose, sources: ["repository"] } }), /selection is stale/);
    state = await f.state(); assert.equal(state.host.requests.some((r) => r.id === "stale-wake"), false);
});
test("empty setup terminal callbacks are rejected atomically, corrected next sequence succeeds, and exact replay stays protected", async (t) => {
    const f = await fixture(t); await f.discover();
    await f.request("shape-repair", "setup", selection()); await f.callback("shape-repair", 1, "running");
    const before = await f.store.read();
    for (const status of ["partial", "verified"]) await assert.rejects(() => f.callback("shape-repair", 2, status,
        { sources: [], evidence: [] }, { detail: "Verified 13 selected tool/repository sources." }), /Minimal result shape/);
    await assert.rejects(() => f.callback("shape-repair", 2, "partial", { sources: sources(), evidence: [] }), /matching current result.evidence/);
    let b = await f.store.read();
    assert.equal(b.revision, before.revision); assert.equal(b.host.requests.at(-1).sequence, 1);
    assert.equal(b.host.requests.at(-1).status, "running"); assert.equal(b.host.sources.length, 0); assert.equal(b.evidence.length, 0);
    const corrected = sourceReadResult();
    const result = await f.callback("shape-repair", 2, "verified", corrected);
    assert.equal(result.counts.sources, 2); assert.equal(result.counts.evidence, 2);
    b = await f.store.read(); const revision = b.revision;
    await f.callback("shape-repair", 2, "verified", corrected);
    assert.equal((await f.store.read()).revision, revision);
    await assert.rejects(() => f.callback("shape-repair", 2, "verified", { ...corrected,
        evidence: corrected.evidence.map((entry) => ({ ...entry, summary: "Changed replay" })) }), /content changed/);
    assert.equal(f.sent.length, 2, "shape correction does not submit another SDK request or authorize a source re-probe");
});
test("mixed setup reads and scoped denied dispositions require evidence and ignore non-source tool counts", async (t) => {
    const f = await fixture(t); await f.discover();
    const locked = { ...selection(), sources: ["repository", "documents"], selectedToolIds: ["repo-reader", "docs-reader", "host-helper"] };
    await f.request("mixed-setup", "setup", locked); await f.callback("mixed-setup", 1, "running");
    const readResult = sourceReadResult();
    await assert.rejects(() => f.callback("mixed-setup", 2, "partial", readResult), /each selected source-capable tool/);
    const denied = { toolId: "docs-reader", type: "documents", status: "blocked", httpStatus: 403, detail: "Actual permission denial; do not retry." };
    await assert.rejects(() => f.callback("mixed-setup", 2, "partial", { ...readResult,
        blockedSources: [{ ...denied, toolId: "host-helper" }] }), /excluded by the locked source selection/);
    const outcome = await f.callback("mixed-setup", 2, "partial", { ...readResult, blockedSources: [denied] });
    assert.equal(outcome.counts.sources, 2); assert.equal(outcome.counts.blockedSources, 1); assert.equal(outcome.counts.evidence, 2);
    const state = await f.state(), blocked = state.host.blockedSources[0];
    assert.equal(blocked.toolId, "docs-reader"); assert.equal(blocked.httpStatus, 403);
    assert.equal(blocked.status, "blocked"); assert.equal(blocked.inventoryRequestId, "inventory-one");
    assert.equal(blocked.requestId, "mixed-setup"); assert.equal(blocked.receipt, undefined);
    assert.ok(!state.host.sources.some((source) => source.toolId === "host-helper"), "metadata helpers are never source bindings");
    assert.equal(state.host.requests.at(-1).status, "partial");
    const queued = await submitCoreRequest(f.store, f.bridge, { id: "partial-core", workId: state.board.work[0].id,
        goal: "Prepare only the actual readable source", sourceIds: ["source-a"], tier: "mid", consent: true, expectedRevision: state.board.revision });
    assert.equal(queued.request.status, "queued"); assert.deepEqual(queued.request.sourceIds, ["source-a"]);
    assert.equal((await f.store.read()).core.hubSessionId, f.bridge.sessionId, "genuine partial setup can bind the hub");
    assert.notEqual(coreState(await f.store.read(), f.bridge).readiness.status, "on-demand-ready", "admission is not an owner round trip");
    const currentRevision = (await f.store.read()).revision;
    await assert.rejects(() => submitCoreRequest(f.store, f.bridge, { id: "denied-core",
        workId: state.board.work[0].id, goal: "Must not route denied scope", sourceIds: ["docs-reader"], tier: "mid",
        consent: true, expectedRevision: currentRevision }), /current consented real complete/);
});
test("all-denied setup needs complete typed coverage; fresh exact-scope recovery preserves denials without reopening or probing", async (t) => {
    const f = await fixture(t); await f.discover();
    const locked = selection();
    await f.request("denied-setup", "setup", locked); await f.callback("denied-setup", 1, "running");
    const denied = [
        { toolId: "repo-reader", type: "repository", repoId: "repo-a", repo: "sample/alpha", status: "blocked", httpStatus: 403, detail: "Actual denied repository scope." },
        { toolId: "repo-reader", type: "repository", repoId: "repo-b", repo: "sample/beta", status: "needs-sign-in", httpStatus: 401, detail: "Actual authentication denial." },
    ];
    await assert.rejects(() => f.callback("denied-setup", 2, "blocked", { blockedSources: [denied[0]] }), /each selected repository/);
    await assert.rejects(() => f.callback("denied-setup", 2, "partial", { blockedSources: denied }), /Empty setup success\/partial/);
    await f.callback("denied-setup", 2, "blocked", { sources: [], evidence: [], blockedSources: denied });
    let b = await f.store.read();
    assert.equal(b.host.sources.length, 0); assert.equal(b.evidence.length, 0);
    assert.equal(b.host.blockedSources.length, 2); assert.equal(b.host.requests.at(-1).status, "blocked");
    await assert.rejects(() => f.callback("denied-setup", 3, "running"), /terminal callback/);
    assert.equal((await f.request("scope-expanded-recovery", "setup", { ...locked, recoveryOf: "denied-setup", selectedRepoIds: ["repo-a"] })).status, 409);
    assert.equal((await f.request("unknown-recovery", "setup", { ...locked, recoveryOf: "absent" })).status, 409);
    const fresh = await f.request("fresh-recovery", "setup", { ...locked, recoveryOf: "denied-setup" });
    assert.equal(fresh.status, 200); assert.equal(fresh.request.sequence, 0);
    assert.equal(fresh.request.recovery.requestId, "denied-setup");
    assert.match(f.sent.at(-1).prompt, /Known denied registry\/blockedSources bindings stay blocked/);
    await f.callback("fresh-recovery", 1, "running");
    await assert.rejects(() => f.callback("fresh-recovery", 2, "partial", sourceReadResult()), /cannot turn a known denied binding/);
    b = await f.store.read(); assert.equal(b.host.requests.at(-1).sequence, 1);
    await f.callback("fresh-recovery", 2, "blocked", { blockedSources: denied });
    b = await f.store.read();
    assert.equal(b.host.requests.find((request) => request.id === "denied-setup").sequence, 2);
    assert.equal(b.host.blockedSources.length, 2); assert.equal(b.host.sources.length, 0);
    assert.equal(f.sent.length, 3, "only inventory and explicitly requested setup IDs are sent; callbacks never re-probe");
});
