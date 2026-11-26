import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore, applyCommand, blankBoard, todayState } from "../src/store.mjs";
import { startServer } from "../src/server.mjs";
import { createNativeBridge, hostCanvasActions } from "../src/host-native.mjs";
import { recordHostResult, hostState } from "../src/host.mjs";

const profile = { title: "Review workspace", preset: "feature-pm", jobs: ["Review updates"], decisions: ["Pick a next step"], sources: [] };
const scope = { purpose: "Review repository updates", sources: ["repository"], repository: "sample/repo", cadence: "", worker: "" };
const read = () => ({ identity: "sample/repo", readback: "Read a changed review item and its status.", readAt: new Date().toISOString(), method: "Read-only deterministic test adapter" });
const cov = (complete = true) => ({ complete, detail: complete ? "All selected pages read." : "One page read; more pages remain.", ...(complete ? {} : { cursor: "page-two" }) });
const source = (status = "verified") => ({ id: "repo", type: "repository", label: "Selected repository", repo: "sample/repo", status,
    detail: status === "needs-sign-in" ? "Authorization was denied." : "Read back repository identity.", coverage: cov(status === "verified"),
    ...(["verified", "partial"].includes(status) ? { receipt: read() } : {}) });
const discovered = (owner = "host-session") => ({ sources: [source()],
    work: [{ sourceId: "repo", externalKey: "review-a", title: "Review a changed item" }],
    evidence: [{ sourceId: "repo", externalKey: "change-a", workExternalKey: "review-a", summary: "A source update requires a review decision.", url: "https://example.test/change", receipt: read() }],
    owners: [{ sourceId: "repo", workExternalKey: "review-a", sessionId: owner, name: "Review owner", url: "https://example.test/session", receipt: { ...read(), identity: owner, readback: "Read owner session metadata and workstream binding." } }],
    tasks: [{ sourceId: "repo", externalKey: "follow-a", workExternalKey: "review-a", title: "Review source change", sourceUrl: "https://example.test/change" }],
    brief: { headline: "One repository update needs review", lines: ["Source identity and change were read."] } });
async function fixture(t, { absent = false, fail = false, sdkSession, configured = true } = {}) {
    const fixtures = resolve(".test-output");
    await mkdir(fixtures, { recursive: true });
    const root = await mkdtemp(join(fixtures, "host-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    const options = { root: join(root, "data"), installationRoot: join(root, "installation"), id: "sample" };
    const store = new WorkspaceStore(options);
    if (configured) await store.mutate("intake", profile, 0);
    const sent = [];
    const session = sdkSession ?? { sessionId: "host-session", async send(message) {
        const persisted = await store.read();
        assert.equal(persisted.host.requests.at(-1).status, "queued", "persist-before-dispatch");
        sent.push(message);
        if (fail) throw Error("Disconnected after uncertain acceptance");
        return "submitted-message";
    } };
    const bridge = absent ? undefined : createNativeBridge(session, "review-panel");
    const panel = await startServer({ store, hostMode: absent ? "standalone" : "native-canvas", hostBridge: bridge });
    t.after(() => panel.close());
    const base = new URL(panel.url);
    const headers = { "X-Workspace-Token": base.pathname.split("/")[1], Origin: base.origin, "Content-Type": "application/json" };
    const actions = hostCanvasActions((instanceId) => instanceId === "review-panel" ? { store, bridge } : undefined);
    const action = (name, input, instanceId = "review-panel") => actions.find((a) => a.name === name).handler({ instanceId, input });
    const get = async () => (await fetch(new URL("state", base), { headers })).json();
    const post = async (path, body, overrides = {}) => {
        const response = await fetch(new URL(path, base), { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
        return { status: response.status, ...(await response.json()) };
    };
    const request = async (id, kind = "setup", extra = {}) => post("host-request", { id, kind, consent: true, scope, expectedRevision: (await store.read()).revision, ...extra });
    const callback = async (requestId, sequence, status, result = {}, extra = {}) => action("record_host_result",
        { workspace: "sample", requestId, ownerSessionId: "host-session", sequence, status, detail: `${status} through deterministic test adapter.`, result, ...extra });
    const finish = async (requestId, result = discovered()) => { await callback(requestId, 1, "running"); return callback(requestId, 2, "verified", result); };
    return { store, options, sent, bridge, panel, get, post, request, callback, finish, action };
}
test("HTTP connected setup accepts persisted wizard purpose without creating a profile or skipping unfinished onboarding", async (t) => {
    const f = await fixture(t, { configured: false });
    const draft = { role: "pm", title: "Review workspace", jobs: ["Review updates"], decisions: "Pick the next step",
        connectionMode: "connect", sourceTypes: ["repository"], repository: "sample/repo" };
    assert.equal((await f.request("no-draft")).status, 400);
    assert.equal(f.sent.length, 0); assert.equal((await f.store.read()).host.requests.length, 0);
    const progress = await f.post("command", { command: "setup_progress", payload: { step: 1, draft }, expectedRevision: 0 });
    assert.equal(progress.status, 200); assert.equal(progress.board.profile, null);
    const submitted = await f.request("wizard-connect");
    assert.equal(submitted.status, 200); assert.equal(submitted.request.dispatchState, "accepted"); assert.equal(f.sent.length, 1);
    assert.match(f.sent[0].prompt, /Persisted workspace purpose/); assert.match(f.sent[0].prompt, /Pick the next step/);
    const { sources: readSources, work, evidence } = discovered();
    await f.finish("wizard-connect", { sources: readSources, work, evidence });
    const reopened = await new WorkspaceStore(f.options).read();
    assert.equal(reopened.profile, null); assert.equal(reopened.onboarding.step, 1); assert.equal(reopened.onboarding.flowVersion, 2);
    assert.deepEqual(reopened.onboarding.draft, draft); assert.equal(reopened.onboarding.complete, undefined);
    assert.equal(todayState(reopened).code, "setup"); assert.equal(reopened.host.sources[0].status, "verified");
    for (const [kind, extra] of [
        ["collect", {}], ["prepare", { workId: "not-yet-configured" }],
        ["schedule", { scope: { ...scope, cadence: "daily 09:00" } }],
        ["remote", { scope: { purpose: "Check worker", sources: [], worker: "review-worker" } }],
    ]) assert.equal((await f.request(`before-finish-${kind}`, kind, extra)).status, 400);
    assert.equal(f.sent.length, 1);
});
test("wizard setup still rejects incomplete purpose and source scope outside persisted onboarding consent", async (t) => {
    const f = await fixture(t, { configured: false });
    const draft = { role: "pm", title: "Review workspace", jobs: ["Review updates"], decisions: "", sourceTypes: ["repository"], repository: "sample/repo" };
    await f.post("command", { command: "setup_progress", payload: { step: 1, draft }, expectedRevision: 0 });
    assert.equal((await f.request("incomplete-purpose")).status, 400);
    let b = await f.store.read();
    await f.post("command", { command: "setup_progress", payload: { step: 1, draft: { ...draft, decisions: "Pick next step" } }, expectedRevision: b.revision });
    assert.equal((await f.request("broader-sources", "setup", { scope: { ...scope, sources: ["repository", "messages"] } })).status, 400);
    assert.equal((await f.request("different-repo", "setup", { scope: { ...scope, repository: "another/repo" } })).status, 400);
    b = await f.store.read();
    assert.equal(b.profile, null); assert.equal(b.host.requests.length, 0); assert.equal(f.sent.length, 0);
});
test("adapter integration: HTTP -> persisted request -> supported SDK send -> typed source read -> owner preparation -> ready card", async (t) => {
    const f = await fixture(t);
    const queued = await f.request("setup-one");
    assert.equal(queued.status, 200); assert.equal(queued.request.status, "queued"); assert.equal(f.sent.length, 1);
    assert.equal(queued.request.dispatchState, "accepted"); assert.equal(queued.request.dispatchReceipt.messageId, "submitted-message");
    assert.deepEqual(Object.keys(f.sent[0]).sort(), ["displayPrompt", "prompt"]);
    assert.match(f.sent[0].prompt, /record_host_result/); assert.match(f.sent[0].prompt, /review-panel/);
    await f.finish("setup-one");
    let b = await f.store.read();
    assert.equal(b.host.sources[0].status, "verified"); assert.equal(b.host.owners[0].workId, b.work[0].id);
    assert.equal(todayState(b).code, "pending"); assert.equal(b.cards.length, 0);
    const workId = b.work[0].id;
    await f.request("prepare-one", "prepare", { workId });
    await f.finish("prepare-one", { cards: [{ sourceId: "repo", externalKey: "decision-a", evidenceExternalKey: "change-a",
        title: "Choose the review path", why: "The changed item needs a choice.", options: ["Review now", "Ask for context"], recommendedIndex: 0,
        afterDecision: "Save this choice locally.", kind: "draft", consequences: "Nothing is sent.",
        draft: { channel: "Local draft", target: "Review thread", text: "Please review the scoped change." } }] });
    b = await f.store.read();
    assert.equal(todayState(b).code, "ready"); assert.equal(b.cards[0].draft.target, "Review thread");
    const state = await f.get();
    assert.equal(state.host.available, true); assert.equal(state.host.sessionId, "host-session");
    assert.equal(state.host.brief.headline, "One repository update needs review");
    assert.equal(b.tasks[0].sourceUrl, "https://example.test/change");
    const persisted = JSON.parse(await readFile(f.store.path, "utf8"));
    assert.equal(Object.hasOwn(persisted.host, "available"), false); assert.equal(Object.hasOwn(persisted.host, "sessionId"), false);
    const reopened = new WorkspaceStore(f.options);
    assert.equal((await reopened.read()).cards[0].id, b.cards[0].id);
    assert.equal(hostState(await reopened.read()).available, false);
    b = await reopened.mutate("resolve", { id: b.cards[0].id, response: "Review after the next source read." }, b.revision);
    assert.equal(b.cards[0].response, "Review after the next source read."); assert.equal(b.cards[0].status, "resolved");
    assert.equal(f.sent.length, 2, "resolution is local only");
});
test("request replay is retry-safe; changed-content ids, stale revisions and unconsented requests are rejected", async (t) => {
    const f = await fixture(t);
    const body = { id: "stable-id", kind: "setup", scope, consent: true, expectedRevision: 1 };
    assert.equal((await f.post("host-request", body)).status, 200);
    const duplicate = await f.post("host-request", body);
    assert.equal(duplicate.duplicate, true); assert.equal(f.sent.length, 1);
    assert.equal((await f.post("host-request", { ...body, scope: { ...scope, purpose: "Different purpose" } })).status, 409);
    assert.equal((await f.post("host-request", { ...body, id: "stale-id" })).status, 409);
    assert.equal((await f.request("no-consent", "setup", { consent: false })).status, 400);
    assert.equal((await f.request("outside-types", "setup", { scope: { ...scope, sources: ["all-tools"] } })).status, 400);
    assert.equal((await f.request("missing-cadence", "schedule")).status, 400);
    assert.equal((await f.post("command", { command: "host_result", payload: {}, expectedRevision: 2 })).status, 403);
    const deniedOrigin = await f.post("host-request", body, { Origin: "https://example.test" });
    assert.equal(deniedOrigin.status, 403);
});
test("missing and disconnected hosts persist exact blocked state without pretending to queue or redispatch", async (t) => {
    const absent = await fixture(t, { absent: true });
    const blocked = await absent.request("host-missing");
    assert.equal(blocked.status, 503); assert.equal(blocked.request.status, "blocked"); assert.equal((await absent.get()).host.available, false);
    const failed = await fixture(t, { fail: true });
    const uncertain = await failed.request("host-failed");
    assert.equal(uncertain.status, 503); assert.match(uncertain.error, /acceptance is unknown/);
    assert.equal(uncertain.request.dispatchState, "unknown"); assert.match(uncertain.request.dispatchReceipt.detail, /do not retry/);
    assert.equal((await failed.request("host-failed")).duplicate, true); assert.equal(failed.sent.length, 1);
    await failed.callback("host-failed", 1, "running");
    await failed.callback("host-failed", 2, "needs-sign-in", { sources: [source("needs-sign-in")] });
    assert.equal((await failed.store.read()).host.requests[0].status, "needs-sign-in", "a late callback can settle uncertain dispatch without another send");
});
test("callbacks enforce exact replay, request/session/instance binding and monotonic sequence without revision churn", async (t) => {
    const f = await fixture(t); await f.request("callback-one");
    await assert.rejects(() => f.callback("callback-one", 2, "running"), /out-of-order/);
    await assert.rejects(() => f.callback("callback-one", 1, "verified", discovered()), /First callback/);
    await assert.rejects(() => f.callback("callback-one", 1, "running", {}, { ownerSessionId: "wrong-session" }), /owning session/);
    await assert.rejects(() => f.callback("callback-one", 1, "running", {}, { workspace: "other" }), /workspace mismatch/);
    await assert.rejects(() => f.action("get_host_request", { requestId: "callback-one" }, "wrong-panel"), /Open/);
    await assert.rejects(() => recordHostResult(f.store, { ...f.bridge, sessionId: "replacement" }, { requestId: "callback-one" }), /does not own/);
    await f.callback("callback-one", 1, "running");
    const resumed = await f.action("get_host_request", { requestId: "callback-one" });
    assert.match(resumed.prompt, /Do NOT repeat it or restart/); assert.match(resumed.prompt, /terminal callback sequence is 2/);
    const revision = (await f.store.read()).revision;
    await f.callback("callback-one", 1, "running");
    assert.equal((await f.store.read()).revision, revision);
    await assert.rejects(() => f.callback("callback-one", 1, "running", {}, { detail: "Changed replay" }), /content changed/);
    const result = discovered(); await f.callback("callback-one", 2, "verified", result);
    const completed = (await f.store.read()).revision;
    await f.callback("callback-one", 2, "verified", result);
    assert.equal((await f.store.read()).revision, completed);
    await assert.rejects(() => f.callback("callback-one", 3, "running"), /terminal/);
});
test("auth denial and partial pages remain separate from complete verification; individual read evidence can persist", async (t) => {
    const f = await fixture(t); await f.request("denied");
    await f.callback("denied", 1, "running");
    await f.callback("denied", 2, "needs-sign-in", { sources: [source("needs-sign-in")] });
    let b = await f.store.read();
    assert.equal(b.host.sources[0].lastReadAt, null); assert.equal(b.evidence.length, 0);
    assert.equal(b.host.requests[0].status, "needs-sign-in");
    await f.request("partial", "collect", { sourceId: "repo" }); await f.callback("partial", 1, "running");
    const partial = { ...discovered(), sources: [source("partial")] };
    await assert.rejects(() => f.callback("partial", 2, "verified", partial), /complete current/);
    await f.callback("partial", 2, "partial", partial);
    b = await f.store.read();
    assert.equal(b.host.sources[0].coverage.cursor, "page-two"); assert.equal(b.host.sources[0].status, "partial");
    assert.equal(b.evidence[0].status, "verified"); assert.ok(b.evidence[0].receipt);
    assert.equal(b.host.requests[1].status, "partial"); assert.equal(b.cards.length, 0);
    await f.request("continue", "collect", { sourceId: "repo" });
    assert.match(f.sent.at(-1).prompt, /page-two/);
    await f.finish("continue");
    b = await f.store.read(); assert.equal(b.work.length, 1); assert.equal(b.evidence.length, 1);
    assert.equal(b.host.sources[0].status, "verified"); assert.equal(b.tasks.length, 1);
});
test("typed ingestion is atomic, bounded, scoped and rejects nested credential keys and arbitrary board replacement", async (t) => {
    const f = await fixture(t); await f.request("typed"); await f.callback("typed", 1, "running");
    const before = await f.store.read();
    for (const result of [
        { board: {} },
        { sources: [{ ...source(), type: "messages" }] },
        { sources: [{ ...source(), repo: "another/repo" }] },
        { sources: [{ ...source(), receipt: undefined }] },
        { ...discovered(), evidence: [{ ...discovered().evidence[0], unexpected: "replacement" }] },
        { ...discovered(), evidence: [{ ...discovered().evidence[0], receipt: { ...read(), access_token: "do-not-store" } }] },
        { work: Array.from({ length: 41 }, () => ({})) },
    ]) await assert.rejects(() => f.callback("typed", 2, "verified", result));
    assert.deepEqual(await f.store.read(), before);
    await f.callback("typed", 2, "verified", discovered());
    assert.equal((await f.store.read()).work.length, 1);
});
test("stale registered owner bindings cannot prepare; preparation requires existing real source evidence", async (t) => {
    const f = await fixture(t); await f.request("owner-setup"); await f.finish("owner-setup");
    const b = await f.store.read(), workId = b.work[0].id;
    await f.request("old-prep", "prepare", { workId });
    await f.request("owner-refresh", "collect"); await f.finish("owner-refresh", discovered("new-owner"));
    await assert.rejects(() => f.callback("old-prep", 1, "running"), /Stale owner/);
    await f.request("new-prep", "prepare", { workId });
    await assert.rejects(() => f.callback("new-prep", 1, "running"), /owning session/);
    await f.callback("new-prep", 1, "running", {}, { ownerSessionId: "new-owner" });
    const card = { sourceId: "repo", externalKey: "not-backed", evidenceExternalKey: "missing", title: "Choose",
        why: "A decision", options: ["One", "Two"], recommendedIndex: 0, afterDecision: "Save locally" };
    await assert.rejects(() => f.callback("new-prep", 2, "verified", { cards: [card] }, { ownerSessionId: "new-owner" }), /actual source evidence/);
    assert.equal((await f.store.read()).cards.length, 0);
    assert.match(f.sent.at(-1).prompt, /route this bounded preparation instruction/);
});
test("owner metadata accepts only narrow native session/chat app links while evidence stays HTTPS-only", async (t) => {
    const f = await fixture(t);
    for (const kind of ["sessions", "chats"]) {
        const requestId = `owner-link-${kind}`;
        await f.request(requestId); await f.callback(requestId, 1, "running");
        const result = discovered(), appUrl = `ghapp://${kind}/${randomUUID()}`;
        result.owners[0].url = appUrl;
        const invalid = [
            `${appUrl}?token=private`, `${appUrl}#fragment`, `${appUrl}/extra`,
            appUrl.replace(`://${kind}/`, `://other/`),
            appUrl.replace(`://${kind}/`, `://user@${kind}/`),
            appUrl.replace(`://${kind}/`, `://${kind}:123/`),
            `ghapp://${kind}/not-a-session-id`,
        ];
        for (const url of invalid) await assert.rejects(() => f.callback(requestId, 2, "verified", { ...result, owners: [{ ...result.owners[0], url }] }), /credentials|schemes/);
        await assert.rejects(() => f.callback(requestId, 2, "verified", { ...result, evidence: [{ ...result.evidence[0], url: appUrl }] }), /credentials|schemes/);
        await f.callback(requestId, 2, "verified", result);
        assert.equal((await f.store.read()).host.owners[0].url, appUrl);
    }
});
test("verified schedule requires exact readback and wires only bounded registered-source collector wakes", async (t) => {
    const f = await fixture(t); await f.request("schedule-setup"); await f.finish("schedule-setup");
    const scheduleScope = { ...scope, cadence: "daily 09:00" };
    await f.request("schedule-one", "schedule", { scope: scheduleScope }); await f.callback("schedule-one", 1, "running");
    const automation = { id: "saved-schedule", name: "Repository collector", cadence: "daily 09:00", status: "enabled",
        lastRunAt: null, nextRunAt: new Date(Date.now() + 86400000).toISOString(), coverage: cov(), receipt: { ...read(), identity: "saved-schedule", readback: "Read exact saved schedule, cadence and enabled state." },
        sessionId: "host-session", provider: "session-automation" };
    await assert.rejects(() => f.callback("schedule-one", 2, "verified", {}), /exact saved schedule/);
    await assert.rejects(() => f.callback("schedule-one", 2, "verified", { automation: { ...automation, cadence: "hourly" } }), /approved cadence/);
    await assert.rejects(() => f.callback("schedule-one", 2, "verified", { automation: { ...automation, sessionId: "another-session" } }), /same-session/);
    await f.callback("schedule-one", 2, "verified", { automation });
    const b = await f.store.read();
    assert.equal(b.host.automation.id, "saved-schedule"); assert.equal(b.host.automation.lastRunAt, null);
    assert.equal(b.host.automation.nextRunAt, automation.nextRunAt);
    const sends = f.sent.length, collectorScope = { purpose: scope.purpose, sources: scope.sources, repository: scope.repository };
    const wake = await f.action("request_collection", { workspace: "sample", id: "wake-one", scope: collectorScope });
    assert.equal(wake.request.kind, "collect"); assert.equal(wake.request.status, "queued"); assert.equal(f.sent.length, sends);
    assert.match(wake.prompt, /bounded incremental reads/);
    const updatedAutomation = { ...automation, lastRunAt: new Date().toISOString(), nextRunAt: new Date(Date.now() + 172800000).toISOString() };
    await f.finish("wake-one", { ...discovered(), automation: updatedAutomation });
    assert.equal((await f.store.read()).work.length, 1);
    assert.equal((await f.store.read()).host.automation.lastRunAt, updatedAutomation.lastRunAt);
    assert.equal((await f.store.read()).host.automation.nextRunAt, updatedAutomation.nextRunAt);
    await assert.rejects(() => f.action("request_collection", { workspace: "sample", id: "broader", scope: { ...collectorScope, sources: ["messages"] } }), /differs/);
});
test("remote verification requires a real identity receipt; disconnect replaces prior success without fictional capabilities", async (t) => {
    const f = await fixture(t);
    const remoteScope = { purpose: "Check selected worker identity", sources: [], worker: "review-worker" };
    await f.request("remote-missing", "remote", { scope: remoteScope }); await f.callback("remote-missing", 1, "running");
    await f.callback("remote-missing", 2, "blocked", { remote: { status: "missing-capability", capability: "Read-only remote identity adapter", detail: "No supported adapter is available." } });
    assert.equal((await f.get()).host.remote.status, "missing-capability");
    await f.request("remote-read", "remote", { scope: remoteScope }); await f.callback("remote-read", 1, "running");
    await assert.rejects(() => f.callback("remote-read", 2, "verified", { remote: { status: "verified", capability: "test identity read", detail: "Checked", identity: "review-worker" } }), /read receipt/);
    await f.callback("remote-read", 2, "verified", { remote: { status: "verified", capability: "test identity read", detail: "Identity read back.", identity: "review-worker", receipt: { ...read(), identity: "review-worker" } } });
    assert.equal((await f.get()).host.remote.identity, "review-worker");
    await f.request("remote-disconnect", "remote", { scope: remoteScope }); await f.callback("remote-disconnect", 1, "running");
    await f.callback("remote-disconnect", 2, "blocked", { remote: { status: "disconnected", capability: "test identity read", detail: "Worker disconnected during read." } });
    const state = await f.get();
    assert.equal(state.host.remote.status, "disconnected"); assert.equal(state.host.remote.verifiedAt, undefined);
});
test("HTTP skill eligibility follows verified remote receipts and revokes remote-worker on disconnect", async (t) => {
    const f = await fixture(t);
    const selection = { packs: ["remote-operations"], consent: true };
    assert.deepEqual((await f.get()).skills.capabilities, []);
    assert.equal((await f.post("skills", selection)).status, 400);
    const remoteScope = { purpose: "Verify selected worker", sources: [], worker: "review-worker" };
    await f.request("skill-remote-check", "remote", { scope: remoteScope });
    await f.callback("skill-remote-check", 1, "running");
    assert.deepEqual((await f.get()).skills.capabilities, []);
    await assert.rejects(() => f.callback("skill-remote-check", 2, "verified", {
        remote: { status: "verified", capability: "test identity read", detail: "No read receipt supplied.", identity: "review-worker" },
    }), /read receipt/);
    assert.deepEqual((await f.get()).skills.capabilities, []);
    await f.callback("skill-remote-check", 2, "verified", { remote: { status: "verified", capability: "test identity read",
        detail: "Actual deterministic adapter identity read.", identity: "review-worker", receipt: { ...read(), identity: "review-worker" } } });
    assert.deepEqual((await f.get()).skills.capabilities, ["remote-worker"]);
    assert.equal((await f.post("skills", selection)).status, 200);
    assert.ok((await f.get()).skills.installed.some((skill) => skill.id === "remote-operations"));
    await f.request("skill-remote-disconnect", "remote", { scope: remoteScope });
    await f.callback("skill-remote-disconnect", 1, "running");
    await f.callback("skill-remote-disconnect", 2, "blocked", { remote: { status: "disconnected",
        capability: "test identity read", detail: "Selected worker disconnected." } });
    const disconnected = await f.get();
    assert.deepEqual(disconnected.skills.capabilities, []);
    assert.ok(disconnected.skills.installed.some((skill) => skill.id === "remote-operations"), "revocation does not delete opted-in local files");
    assert.equal((await f.post("skills", selection)).status, 400);
});
test("workspaces and host instances do not share globals or lose local work during collection", async (t) => {
    const first = await fixture(t), second = await fixture(t);
    await first.request("same-id"); await first.finish("same-id");
    assert.equal((await second.get()).host.requests.length, 0);
    await second.request("same-id");
    assert.equal(first.sent.length, 1); assert.equal(second.sent.length, 1);
    let b = await first.store.read();
    b = await first.store.mutate("work_update", { id: b.work[0].id, status: "active", owner: "Local owner", nextAction: "Keep my next step" }, b.revision);
    await first.request("refresh", "collect"); await first.finish("refresh");
    const refreshed = await first.store.read();
    assert.equal(refreshed.work[0].id, b.work[0].id); assert.equal(refreshed.work[0].owner, "Local owner"); assert.equal(refreshed.work[0].nextAction, "Keep my next step");
    assert.equal(refreshed.tasks.length, 1); assert.deepEqual(refreshed.improvements, b.improvements);
});
test("concurrent bound callbacks retry only store contention and preserve both requests", async (t) => {
    const f = await fixture(t);
    await f.request("parallel-one"); await f.request("parallel-two");
    await Promise.all([f.callback("parallel-one", 1, "running"), f.callback("parallel-two", 1, "running")]);
    let b = await f.store.read();
    assert.deepEqual(b.host.requests.map((r) => r.status), ["running", "running"]);
    b = await f.store.mutate("work", { title: "Keep locally added work" }, b.revision);
    await f.callback("parallel-one", 2, "verified", discovered());
    const after = await f.store.read();
    assert.equal(after.work[0].title, "Keep locally added work");
    assert.equal(after.work.length, 2); assert.equal(after.host.requests[1].status, "running");
});
test("migrating an old board and ingesting stable updates preserves unrelated notes and feedback", async (t) => {
    const f = await fixture(t); await f.request("notes-read"); await f.finish("notes-read");
    await f.request("notes-refresh", "collect"); await f.callback("notes-refresh", 1, "running");
    const board = await f.store.read();
    board.notes = { text: "Workspace notes" }; board.feedback = ["Keep this feedback"];
    board.work[0].notes = "Work notes"; board.evidence[0].feedback = "Evidence feedback";
    const after = applyCommand(board, "host_result", { workspace: "sample", requestId: "notes-refresh", ownerSessionId: "host-session", sequence: 2,
        status: "verified", detail: "Read a stable source update.", result: discovered() });
    assert.deepEqual(after.notes, board.notes); assert.deepEqual(after.feedback, board.feedback);
    assert.equal(after.work[0].notes, "Work notes"); assert.equal(after.evidence[0].feedback, "Evidence feedback");
    assert.equal(after.evidence[0].id, board.evidence[0].id);
    const legacy = blankBoard("sample"); delete legacy.host; legacy.profile = profile; legacy.notes = "Keep old notes";
    const migrated = applyCommand(legacy, "host_enqueue", { request: { id: "legacy-request", kind: "setup", consent: true, scope }, sessionId: "host-session", instanceId: "review-panel" });
    assert.equal(migrated.notes, "Keep old notes"); assert.equal(migrated.host.requests[0].status, "queued");
});
test("local commands support setup connection progress, secure task links, local drafts and own responses without sends", () => {
    let b = applyCommand(blankBoard("sample"), "setup_progress", { step: 2, draft: { connectionMode: "connect", sourceTypes: ["repository"], repository: "sample/repo" } });
    assert.equal(b.onboarding.draft.connectionMode, "connect");
    assert.throws(() => applyCommand(b, "setup_progress", { step: 2, draft: { sourceTypes: ["invalid"] } }), /source types/);
    b = applyCommand(b, "intake", profile);
    b = applyCommand(b, "work", { title: "Local work" });
    assert.throws(() => applyCommand(b, "task", { workId: b.work[0].id, title: "Review", sourceUrl: "javascript:alert(1)" }), /credentials|schemes/);
    assert.throws(() => applyCommand(b, "setup_progress", { step: 2, draft: { settings: { api_key: "not-stored" } } }), /credentials/);
});
