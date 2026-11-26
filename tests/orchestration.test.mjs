import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { WorkspaceStore, applyCommand, replaceWorkspaceFile } from "../src/store.mjs";
import { createNativeBridge, hostCanvasActions } from "../src/host-native.mjs";
import { startServer } from "../src/server.mjs";
import { submitHostRequest, recordHostResult } from "../src/host.mjs";
import { applyCoreCommand, coreState, coreDigest, drainOwnerInbox, submitCoreRequest, workSourceVersion } from "../src/orchestration.mjs";

const scope = { purpose: "Review selected changes", sources: ["repository"], repository: "sample/repo" };
const cov = { complete: true, detail: "All bounded selected items read." };
const read = (identity = "sample/repo") => ({ identity, readback: "Actual deterministic fixture record.", method: "Scoped test read adapter", readAt: new Date().toISOString() });
const tool = (name, sessionId) => ({ tool: name, callId: `call-${name}`, sessionId, readAt: new Date().toISOString(), detail: "Actual deterministic tool-derived receipt fixture." });
const source = () => ({ id: "repo", type: "repository", label: "Review source", repo: "sample/repo", status: "verified", detail: "Selected source read.", coverage: cov, receipt: read() });
const discovered = (summary = "Changed evidence requires a decision.") => ({ sources: [source()],
    work: [{ sourceId: "repo", externalKey: "work-a", title: "Review selected change" }],
    evidence: [{ sourceId: "repo", workExternalKey: "work-a", externalKey: "evidence-a", summary, receipt: read() }] });
async function fixture(t, { missing = false, fail = false, wizard = false, models = {} } = {}) {
    await mkdir(resolve(".test-output"), { recursive: true });
    const root = await mkdtemp(join(resolve(".test-output"), "core-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    const store = new WorkspaceStore({ id: "sample", root: join(root, "data"), installationRoot: join(root, "installation") });
    if (wizard) await store.mutate("setup_progress", { step: 3, draft: { role: "pm", title: "Review workspace", jobs: ["Review changes"],
        decisions: "Choose next step", sourceTypes: ["repository"], repository: "sample/repo" } }, 0);
    else await store.mutate("intake", { title: "Review workspace", preset: "feature-pm", jobs: ["Review changes"], decisions: ["Choose next step"], sources: [], models }, 0);
    const sent = [];
    const bridge = createNativeBridge({ sessionId: "hub-session", async send(message) {
        const b = await store.read();
        if (message.prompt.includes("get_core_request")) assert.ok(b.core.jobs.at(-1), "core job persisted before SDK send");
        sent.push(message); if (fail && message.prompt.includes("get_core_request")) throw Error("Unknown admission");
        return "actual-sdk-acceptance";
    } }, "hub-panel");
    await submitHostRequest(store, bridge, { id: "setup", kind: "setup", scope, consent: true, expectedRevision: (await store.read()).revision });
    const callback = (requestId, sequence, status, result = {}) => recordHostResult(store, bridge,
        { workspace: "sample", requestId, ownerSessionId: "hub-session", sequence, status, result, detail: "Observed adapter callback." });
    await callback("setup", 1, "running"); await callback("setup", 2, "verified", discovered());
    const actualBridge = missing ? undefined : bridge;
    const panel = await startServer({ store, hostMode: missing ? "standalone" : "native-canvas", hostBridge: actualBridge });
    t.after(() => panel.close());
    const base = new URL(panel.url), headers = { Origin: base.origin, "Content-Type": "application/json", "X-Workspace-Token": base.pathname.split("/")[1] };
    const post = async (path, body) => {
        const r = await fetch(new URL(path, base), { method: "POST", headers, body: JSON.stringify(body) });
        return { statusCode: r.status, ...(await r.json()) };
    };
    const get = async () => (await fetch(new URL("state", base), { headers })).json();
    const actions = hostCanvasActions((id) => id === "hub-panel" ? { store, bridge } : undefined);
    const action = (name, input = {}) => actions.find((a) => a.name === name).handler({ instanceId: "hub-panel", input });
    const coreRequest = async (id = "pilot", extra = {}) => post("core-request", { id, workId: (await store.read()).work[0].id,
        sourceIds: ["repo"], tier: "mid", goal: "Prepare one review decision", consent: true, expectedRevision: (await store.read()).revision, ...extra });
    const register = async (jobId = "pilot", { reused = false, location = "local", ownerId = "owner-session", configuredModel } = {}) => {
        await action("record_core_event", { jobId, type: "routing", detail: "Starting actual tool routing." });
        return action("record_core_event", { jobId, type: reused ? "owner_reused" : "owner_created", detail: "Created and inspected actual owner.",
            owner: { sessionId: ownerId, name: "Review owner", appUrl: "https://example.test/owner", executionLocation: location, ...(configuredModel ? { configuredModel } : {}) },
            receipts: { ...(reused ? {} : { create: tool("create_session", ownerId) }), inspect: tool("get_session", ownerId) } });
    };
    const accept = async (jobId = "pilot", status = "verified") => {
        const check = { status, detail: "Actual actor-local capabilities inspected.", method: "Actor read-only tool/skills/config check", readAt: new Date().toISOString() };
        await action("record_core_event", { jobId, type: "capabilities", detail: "Inspected capabilities.", checks: { skills: { ...check, accessMode: "guidance-read" }, sourceAccess: check, model: check } });
        return action("record_core_event", { jobId, type: "message_accepted", detail: "Actual supported owner message accepted.",
            receipts: { message: tool("send_session_message", "owner-session") } });
    };
    const result = async (jobId = "pilot") => {
        const b = await store.read(), j = b.core.jobs.find((j) => j.id === jobId), evidenceId = b.evidence[0].id;
        return { workspace: "sample", jobId, assignmentId: j.assignmentId, workId: j.workId, ownerSessionId: j.ownerSessionId,
            ownerGeneration: j.ownerGeneration, sourceVersion: j.sourceVersion, status: "completed", detail: "Returned source-backed local review.",
            evidenceIds: [evidenceId], card: { evidenceId, title: "Choose a review path", why: "The source change needs review.", options: ["Review now", "Ask for context"],
                recommendedIndex: 0, afterDecision: "Record locally; nothing sent." } };
    };
    const submit = async (r) => {
        const helper = join(store.directory, "callbacks", "owner-inbox.mjs"), grant = join(store.directory, "callbacks", `${r.assignmentId}.json`);
        await new Promise((resolve, reject) => {
            const child = execFile(process.execPath, [helper, "--grant", grant], { timeout: 5000 }, (e, stdout, stderr) => {
                if (e) reject(e); else { assert.equal(stderr, ""); assert.equal(stdout, "Owner result submitted to local inbox.\n"); resolve(); }
            });
            child.stdin.end(JSON.stringify(r));
        });
    };
    return { store, bridge, actualBridge, post, get, coreRequest, register, accept, result, submit, action, callback, sent, panel };
}
test("HTTP core -> persisted SDK message -> actual app-tool receipts -> executable immutable inbox -> card and on-demand readiness", async (t) => {
    const f = await fixture(t);
    const queued = await f.coreRequest();
    assert.equal(queued.statusCode, 200); assert.equal(queued.request.dispatchState, "accepted");
    assert.equal(queued.request.model, "inherited"); assert.equal(queued.request.usedModel, "unknown");
    assert.equal(queued.board.core.jobs[0].callbackHash, undefined);
    assert.match(f.sent.at(-1).prompt, /get_core_request/);
    const instructions = await f.action("get_core_request", { jobId: "pilot" });
    assert.match(instructions.prompt, /create_session/); assert.match(instructions.prompt, /send_session_message/);
    assert.match(instructions.prompt, /owner-inbox\.mjs/); assert.match(instructions.prompt, /Omit model/);
    await f.register(); await f.accept();
    assert.equal((await f.get()).core.readiness.status, "workspace-ready", "message accepted is not completed");
    const result = await f.result(); await f.submit(result);
    let s = await f.get();
    assert.equal(s.core.readiness.status, "on-demand-ready"); assert.equal(s.board.cards.length, 1);
    assert.equal(s.core.jobs[0].status, "completed");
    assert.equal(s.board.core.jobs[0].callbackHash, undefined);
    assert.equal((await f.store.read()).core.owners[0].receipts.create.tool, "create_session");
    const revision = s.board.revision;
    await f.submit(result); s = await f.get();
    assert.equal(s.board.revision, revision); assert.equal(s.board.cards.length, 1);
    const reopened = new WorkspaceStore({ root: f.store.root, installationRoot: f.store.installationRoot, id: "sample" });
    assert.equal((await reopened.read()).core.jobs[0].status, "completed");
    const grant = JSON.parse(await readFile(join(f.store.directory, "callbacks", `${result.assignmentId}.json`), "utf8"));
    assert.ok(grant.callbackCapability); assert.ok(!(await readFile(f.store.path, "utf8")).includes(grant.callbackCapability));
    await assert.rejects(() => f.submit({ ...result, credentials: "Do not persist this field" }));
});
test("PM review-step pilot validates saved purpose without prematurely completing profile or onboarding", async (t) => {
    const f = await fixture(t, { wizard: true });
    await f.coreRequest(); await f.register(); await f.accept(); await f.submit(await f.result());
    const s = await f.get();
    assert.equal(s.core.readiness.status, "on-demand-ready"); assert.equal(s.board.profile, null);
    assert.equal(s.board.onboarding.step, 3); assert.equal(s.board.onboarding.flowVersion, 2); assert.equal(s.board.onboarding.complete, undefined);
});
test("pre-profile core pilot requires current PM flow review step, not a stale old index", async (t) => {
    const f = await fixture(t, { wizard: true }), b = await f.store.read();
    b.onboarding.step = 4;
    assert.throws(() => applyCoreCommand(b, "core_enqueue", { request: { id: "stale-review", workId: b.work[0].id,
        sourceIds: ["repo"], tier: "mid", goal: "Do not route stale onboarding", consent: true } }, new Date().toISOString()), /final onboarding purpose/);
    assert.equal(b.core.jobs.length, 0);
});
test("core rejects fake/manual sources, missing consent, changed IDs and stale revisions; absent/failed host remain honest", async (t) => {
    const f = await fixture(t);
    assert.equal((await f.coreRequest("bad", { sourceIds: ["manual"] })).statusCode, 409);
    assert.equal((await f.coreRequest("no-consent", { consent: false })).statusCode, 400);
    assert.equal((await f.coreRequest("stale", { expectedRevision: 0 })).statusCode, 409);
    await f.coreRequest();
    const duplicate = await f.coreRequest();
    assert.equal(duplicate.duplicate, true); assert.equal(f.sent.length, 2);
    assert.equal((await f.coreRequest("pilot", { goal: "Changed content" })).statusCode, 409);
    assert.equal((await f.coreRequest("fanout")).statusCode, 409);
    const absent = await fixture(t, { missing: true });
    assert.equal((await absent.coreRequest()).statusCode, 503); assert.equal((await absent.get()).core.readiness.status, "blocked");
    const failed = await fixture(t, { fail: true });
    assert.equal((await failed.coreRequest()).statusCode, 503); assert.equal((await failed.coreRequest()).duplicate, true);
    assert.match((await failed.get()).core.readiness.detail, /admission is unknown/);
});
test("hub binding rejects foreign session/instance writes, callbacks and capability reads after same-workspace open", async (t) => {
    const f = await fixture(t); await f.coreRequest();
    const other = { sessionId: "foreign-session", instanceId: "other-panel", async send() { throw Error("Must not send"); } };
    const panel = await startServer({ store: f.store, hostBridge: other });
    t.after(() => panel.close());
    const base = new URL(panel.url), headers = { Origin: base.origin, "Content-Type": "application/json", "X-Workspace-Token": base.pathname.split("/")[1] };
    const r = await fetch(new URL("command", base), { method: "POST", headers,
        body: JSON.stringify({ command: "work", payload: { title: "Foreign write" }, expectedRevision: (await f.store.read()).revision }) });
    assert.equal(r.status, 403);
    await assert.rejects(() => submitCoreRequest(f.store, other, { id: "foreign" }), /registered hub/);
    await assert.rejects(() => recordHostResult(f.store, other, { requestId: "setup" }), /registered hub/);
    await assert.rejects(() => drainOwnerInbox(f.store, { ...f.bridge, instanceId: "other-panel" }), /registered hub/);
    for (const command of ["core_result", "core_event", "view_propose", "view_rows"]) assert.equal((await f.post("command", {
        command, payload: {}, expectedRevision: (await f.store.read()).revision })).statusCode, 403);
});
test("owner identity/model receipts and actor checks are required; cloud cannot assume local callback path", async (t) => {
    const f = await fixture(t, { models: { mid: "selected-review-model" } }); await f.coreRequest();
    const prompt = await f.action("get_core_request", { jobId: "pilot" });
    assert.match(prompt.prompt, /selected-review-model/);
    await assert.rejects(() => f.register("pilot", { configuredModel: "different-model" }), /explicit chosen model/);
    await assert.rejects(() => f.action("record_core_event", { jobId: "pilot", type: "owner_created", detail: "Not local",
        owner: { sessionId: "cloud-owner", name: "Owner", appUrl: "https://example.test/owner", executionLocation: "cloud" },
        receipts: { create: tool("create_session", "cloud-owner"), inspect: tool("get_session", "cloud-owner") } }), /isolated local/);
    await f.action("record_core_event", { jobId: "pilot", type: "owner_created", detail: "Exact actual configured model.",
        owner: { sessionId: "owner-session", name: "Owner", appUrl: "https://example.test/owner", executionLocation: "local", configuredModel: "selected-review-model" },
        receipts: { create: tool("create_session", "owner-session"), inspect: tool("get_session", "owner-session") } });
    await assert.rejects(() => f.accept("pilot", "blocked"), /checks must pass/);
    await f.accept(); await f.submit(await f.result()); await f.get();
    await f.coreRequest("reuse"); await f.register("reuse", { reused: true, configuredModel: "selected-review-model" });
    assert.equal((await f.store.read()).core.owners.length, 1);
    assert.equal((await f.store.read()).core.jobs[1].ownerGeneration, 1);
});
test("nonce, assignment, stale generation/scope and changed replay checks protect owner result writes", async (t) => {
    const f = await fixture(t); await f.coreRequest(); await f.register(); await f.accept();
    const b = await f.store.read(), result = await f.result(), grant = JSON.parse(await readFile(join(f.store.directory, "callbacks", `${result.assignmentId}.json`), "utf8"));
    const apply = (r, capability = grant.callbackCapability, board = b) => applyCoreCommand(structuredClone(board), "core_result", { callbackCapability: capability, result: r }, new Date().toISOString());
    assert.throws(() => apply(result, "wrong"), /capability/);
    assert.throws(() => apply({ ...result, ownerSessionId: "other-owner" }), /binding mismatch/);
    assert.throws(() => apply({ ...result, ownerGeneration: 2 }), /binding mismatch/);
    assert.throws(() => apply({ ...result, sourceVersion: "other" }), /binding mismatch/);
    assert.throws(() => apply({ ...result, senderSessionId: "owner-session" }), /Unsupported owner result fields/);
    assert.throws(() => apply({ ...result, evidenceIds: ["invented"] }), /exact verified/);
    const stale = structuredClone(b); stale.evidence[0].summary = "Different semantic evidence";
    assert.throws(() => apply(result, grant.callbackCapability, stale), /source version/);
    const cancelled = applyCommand(b, "core_event", { jobId: "pilot", type: "cancelled", detail: "Stopped by user." });
    assert.throws(() => apply(result, grant.callbackCapability, cancelled), /cancelled/);
    const changedOwner = structuredClone(b); changedOwner.core.owners[0].generation++;
    assert.throws(() => apply(result, grant.callbackCapability, changedOwner), /generation is stale/);
    const finishedWork = structuredClone(b); finishedWork.work[0].status = "done";
    assert.throws(() => apply(result, grant.callbackCapability, finishedWork), /late owner writes/);
    await f.submit(result); await f.get();
    const completed = await f.store.read();
    assert.throws(() => apply({ ...result, detail: "Changed replay" }, grant.callbackCapability, completed), /replay changed/);
    await assert.rejects(() => f.submit({ ...result, detail: "Changed immutable inbox" }));
    assert.equal((await f.store.read()).cards.length, 1);
});
test("daily requires observed scheduled trigger AND semantic delta owner return; read timestamps never wake unchanged owners", async (t) => {
    const f = await fixture(t); await f.coreRequest(); await f.register(); await f.accept(); await f.submit(await f.result()); await f.get();
    const scheduleScope = { ...scope, sourceIds: ["repo"], autoPrepare: true, cadence: "daily 09:00" };
    await submitHostRequest(f.store, f.bridge, { id: "schedule", kind: "schedule", scope: scheduleScope, consent: true, expectedRevision: (await f.store.read()).revision });
    await f.callback("schedule", 1, "running");
    await f.callback("schedule", 2, "verified", { automation: { id: "schedule-a", name: "Review collector", cadence: scheduleScope.cadence, status: "enabled",
        sessionId: "hub-session", provider: "session-automation", lastRunAt: null, nextRunAt: null, coverage: cov, receipt: read("schedule-a") } });
    assert.equal((await f.get()).core.readiness.status, "daily-configured");
    await assert.rejects(() => f.action("request_collection", { workspace: "sample", id: "expanded", scope: { ...scope, sourceIds: ["other"], autoPrepare: true } }), /differ/);
    const wake = await f.action("request_collection", { workspace: "sample", id: "quiet", scope });
    assert.deepEqual(wake.request.scope.sourceIds, ["repo"]); assert.equal(wake.request.scope.autoPrepare, true);
    await f.callback("quiet", 1, "running"); await f.callback("quiet", 2, "verified", discovered());
    assert.equal((await f.store.read()).core.jobs.length, 1, "same evidence with newer receipts does not wake owner");
    await f.action("request_collection", { workspace: "sample", id: "changed", scope });
    const startedAt = (await f.store.read()).host.requests.at(-1).at;
    await f.callback("changed", 1, "running"); await f.callback("changed", 2, "verified", discovered("A genuinely different source-backed decision."));
    const b = await f.store.read(), job = b.core.jobs.at(-1);
    assert.equal(b.core.jobs.length, 2); assert.equal(job.collectRequestId, "changed"); assert.equal(job.scheduleId, "schedule-a");
    const scheduled = { scheduleId: "schedule-a", requestId: "changed", runId: "run-a", trigger: "schedule",
        receipt: { ...tool("get_session_automation", "hub-session"), scheduleId: "schedule-a", runId: "run-a", trigger: "schedule", startedAt } };
    await assert.rejects(() => f.action("record_scheduled_wake", { ...scheduled, trigger: "manual" }), /not manual/);
    await f.action("record_scheduled_wake", scheduled);
    assert.equal((await f.get()).core.readiness.status, "daily-configured");
    await f.register(job.id, { reused: true }); await f.accept(job.id); await f.submit(await f.result(job.id));
    assert.equal((await f.get()).core.readiness.status, "daily-verified");
    assert.equal((await f.store.read()).core.owners.length, 1);
});
test("explicit Not now preserves existing schedules and semantic versions ignore notes/receipt time", async (t) => {
    const f = await fixture(t); let b = await f.store.read();
    await f.store.mutate("daily_not_now", { confirmed: true }, b.revision);
    b = await f.store.read(); assert.equal(b.core.dailyChoice.status, "not-now");
    const before = workSourceVersion(b, b.work[0].id, ["repo"]);
    const changed = structuredClone(b);
    changed.work[0].notes = "User note"; changed.evidence[0].recordedAt = "2026-01-01T00:00:00Z"; changed.evidence[0].receipt.readAt = "2026-01-01T00:00:00Z";
    assert.equal(workSourceVersion(changed, b.work[0].id, ["repo"]), before);
    changed.host.automation = { id: "existing" };
    assert.throws(() => applyCommand(changed, "daily_not_now", { confirmed: true }), /existing schedule/);
});
test("fresh local child scheduled-check grant authenticates provider trigger/source return without foreign canvas or replacing automation", async (t) => {
    const f = await fixture(t); await f.coreRequest(); await f.register(); await f.accept(); await f.submit(await f.result()); await f.get();
    let b = await f.store.read();
    const prepared = await f.action("prepare_scheduled_check", { id: "timed-check", workId: b.work[0].id, goal: "One bounded timed source-backed review",
        sourceIds: ["repo"], tier: "mid", consent: true, expectedRevision: b.revision });
    assert.match(prepared.prompt, /ISOLATED SCHEDULED CHECK/);
    assert.equal(f.sent.length, 2, "preregistration does not itself schedule or send a host message");
    assert.notEqual(prepared.request.assignmentId, b.core.jobs[0].assignmentId);
    await f.register("timed-check", { reused: true });
    const runAt = new Date().toISOString();
    const ownerSchedule = { id: "child-once", sessionId: "owner-session", provider: "session-automation", interval: "once", runAt,
        status: "enabled", executionLocation: "local", previousAutomation: "none" };
    const receipts = { save: tool("save_session_automation", "owner-session"), inspect: tool("get_session_automation", "owner-session") };
    await assert.rejects(() => f.action("record_core_event", { jobId: "timed-check", type: "owner_schedule", detail: "Unsafe replacement",
        schedule: { ...ownerSchedule, previousAutomation: "existing" }, receipts }), /never replace existing/);
    await f.action("record_core_event", { jobId: "timed-check", type: "owner_schedule", detail: "Exact one-time test saved and read back.", schedule: ownerSchedule, receipts });
    await f.accept("timed-check");
    let state = await f.get();
    assert.equal(state.core.scheduledCheck.status, "configured"); assert.equal(state.core.readiness.status, "on-demand-ready");
    const result = { ...(await f.result("timed-check")), sourceReads: [{ sourceId: "repo", receipt: read(), coverage: cov }] };
    const grant = JSON.parse(await readFile(join(f.store.directory, "callbacks", `${result.assignmentId}.json`), "utf8"));
    const invalid = { ...result, scheduledWake: { scheduleId: "child-once", runId: "child-run", trigger: "manual", startedAt: runAt,
        receipt: { ...tool("get_session_automation", "owner-session"), scheduleId: "child-once", runId: "child-run", trigger: "manual", startedAt: runAt } } };
    b = await f.store.read();
    assert.throws(() => applyCoreCommand(structuredClone(b), "core_result", { callbackCapability: grant.callbackCapability, result: invalid }, new Date().toISOString()), /provider scheduled trigger/);
    result.scheduledWake = { scheduleId: "child-once", runId: "child-run", trigger: "schedule", startedAt: runAt,
        receipt: { ...tool("get_session_automation", "owner-session"), scheduleId: "child-once", runId: "child-run", trigger: "schedule", startedAt: runAt } };
    await f.submit(result); state = await f.get();
    assert.equal(state.core.scheduledCheck.status, "verified");
    assert.equal(state.core.readiness.status, "on-demand-ready", "one-time check is not a configured daily collector");
    assert.equal(state.board.host.automation, null);
});
test("semantic delta backlog persists while pilot runs and hub drain advances only one owner", async (t) => {
    const f = await fixture(t); await f.coreRequest(); await f.register(); await f.accept();
    await submitHostRequest(f.store, f.bridge, { id: "schedule", kind: "schedule", consent: true,
        scope: { ...scope, cadence: "daily 09:00", sourceIds: ["repo"], autoPrepare: true }, expectedRevision: (await f.store.read()).revision });
    await f.callback("schedule", 1, "running");
    await f.callback("schedule", 2, "verified", { automation: { id: "schedule-a", name: "Review collector", cadence: "daily 09:00", status: "enabled",
        sessionId: "hub-session", provider: "session-automation", lastRunAt: null, nextRunAt: null, coverage: cov, receipt: read("schedule-a") } });
    await f.action("request_collection", { workspace: "sample", id: "multi-change", scope });
    await f.callback("multi-change", 1, "running");
    await f.callback("multi-change", 2, "verified", { sources: [source()],
        work: ["work-b", "work-c"].map((externalKey) => ({ sourceId: "repo", externalKey, title: `Review ${externalKey}` })),
        evidence: ["work-b", "work-c"].map((workExternalKey) => ({ sourceId: "repo", workExternalKey, externalKey: `evidence-${workExternalKey}`,
            summary: "An actually read new review item.", receipt: read() })) });
    let b = await f.store.read();
    assert.equal(b.core.deltas.length, 2); assert.ok(b.core.deltas.every((d) => d.status === "pending"));
    assert.equal(b.core.jobs.length, 1, "no concurrent owner fanout during pilot");
    await f.submit(await f.result());
    await f.action("record_work");
    b = await f.store.read();
    assert.equal(b.core.jobs.length, 2); assert.equal(b.core.deltas.filter((d) => d.status === "pending").length, 1);
    assert.equal(b.core.deltas.filter((d) => d.status === "dispatched").length, 1);
    assert.equal(f.sent.length, 4, "only one additional assignment dispatched");
});
test("changing explicit model mapping blocks reuse instead of silently replacing or downgrading owner", async (t) => {
    const f = await fixture(t); await f.coreRequest(); await f.register(); await f.accept(); await f.submit(await f.result()); await f.get();
    const b = await f.store.read();
    await f.store.mutate("intake", { title: "Review workspace", preset: "feature-pm", jobs: ["Review changes"], decisions: ["Choose next step"],
        sources: [], models: { mid: "different-explicit-model" } }, b.revision);
    assert.equal((await f.coreRequest("new-mapping")).statusCode, 409);
    assert.equal((await f.get()).core.readiness.status, "blocked");
    assert.equal((await f.store.read()).core.owners[0].modelSelection, "inherited");
});
test("domain callback proposes only narrowed consented safe manifests; HTTP cannot spoof proposal/rows", async (t) => {
    const f = await fixture(t);
    const request = { id: "domain", kind: "domain", consent: true, scope: { ...scope, domainPurpose: "Track review decisions", sourceIds: ["repo"] }, expectedRevision: (await f.store.read()).revision };
    await submitHostRequest(f.store, f.bridge, request);
    await f.callback("domain", 1, "running");
    const manifest = { id: "review-view", title: "Reviews", description: "Source-backed review work.", renderer: "table", dataset: "work", sourceIds: ["repo"], fields: [{ key: "title", label: "Title", type: "text" }] };
    await assert.rejects(() => f.callback("domain", 2, "verified", { domainProposal: { title: "Reviews", why: "Review decisions", manifest: { ...manifest, sourceIds: ["other"] } } }));
    await assert.rejects(() => f.callback("domain", 2, "verified", { sources: [source()] }), /outside this request kind/);
    await f.callback("domain", 2, "verified", { domainProposal: { title: "Reviews", why: "A bounded review view.", manifest } });
    const state = await f.get(); assert.equal(state.views.proposals.length, 1); assert.equal(state.views.active.length, 0);
    assert.equal((await f.post("command", { command: "view_propose", payload: {}, expectedRevision: state.board.revision })).statusCode, 403);
});
test("atomic store replacement retries transient reader denial with the same pending file and rejects other failures", async () => {
    const calls = [];
    await replaceWorkspaceFile("pending-file", "board-file", async (from, to) => {
        calls.push([from, to]);
        if (calls.length < 3) throw Object.assign(Error("Transient reader denial"), { code: calls.length === 1 ? "EPERM" : "EBUSY" });
    });
    assert.deepEqual(calls, Array.from({ length: 3 }, () => ["pending-file", "board-file"]));
    let attempts = 0;
    await assert.rejects(() => replaceWorkspaceFile("pending-file", "board-file", async () => {
        attempts++; throw Object.assign(Error("Missing pending file"), { code: "ENOENT" });
    }), /Missing pending file/);
    assert.equal(attempts, 1, "non-contention failures never trigger unsafe replacement retries");
});
test("user-defined Work binds real source context explicitly and owner card preserves both user metadata and source provenance", async (t) => {
    const f = await fixture(t);
    let b = await f.store.read();
    const sourceWorkId = b.work[0].id, evidenceId = b.evidence[0].id;
    await f.post("command", { command: "work", payload: { title: "My review purpose", owner: "User" }, expectedRevision: b.revision });
    b = await f.store.read();
    const userWorkId = b.work.at(-1).id;
    await f.store.mutate("work_update", { id: userWorkId, status: "active", owner: "User", nextAction: "Keep my chosen next step" }, b.revision);
    assert.equal((await f.coreRequest("unbound", { workId: userWorkId })).statusCode, 400);
    b = await f.store.read();
    const payload = { workId: userWorkId, sourceId: "repo", evidenceIds: [evidenceId], confirmed: true };
    const bound = await f.post("command", { command: "work_bind", payload, expectedRevision: b.revision });
    assert.equal(bound.statusCode, 200);
    assert.deepEqual(bound.board.work.at(-1).sourceContext.evidenceIds, [evidenceId]);
    assert.equal(bound.board.work.at(-1).sourceId, "repo", "primary source is explicit context, not fabricated source ownership");
    assert.equal(bound.board.work.at(-1).origin, "user");
    assert.equal(bound.board.work.at(-1).externalKey, undefined);
    assert.equal(bound.board.work.at(-1).title, "My review purpose");
    assert.equal(bound.board.work.at(-1).owner, "User");
    assert.equal(bound.board.work.at(-1).nextAction, "Keep my chosen next step");
    assert.equal(bound.board.work.at(-1).status, "active");
    assert.equal(bound.board.evidence.length, 1); assert.equal(bound.board.evidence[0].workId, sourceWorkId);
    const replay = await f.post("command", { command: "work_bind", payload, expectedRevision: bound.board.revision });
    assert.equal(replay.board.revision, bound.board.revision, "identical confirmation does not manufacture new reads or revisions");
    assert.equal((await f.coreRequest("pilot", { workId: userWorkId })).statusCode, 200);
    const instructions = await f.action("get_core_request", { jobId: "pilot" });
    assert.match(instructions.prompt, /user-defined work using explicitly approved source CONTEXT/);
    await f.register(); await f.accept(); await f.submit(await f.result()); const state = await f.get();
    assert.equal(state.core.readiness.status, "on-demand-ready");
    assert.equal(state.board.cards[0].workId, userWorkId);
    assert.equal(state.board.cards[0].contextWorkId, sourceWorkId);
    assert.equal(state.board.cards[0].evidenceId, evidenceId);
    assert.equal(state.board.evidence[0].workId, sourceWorkId);
    assert.equal(state.board.work.at(-1).owner, "User");
    assert.equal(state.board.work.at(-1).nextAction, "Keep my chosen next step");
    assert.equal(state.board.work[0].title, "Review selected change");
});
test("work context rejects fake, excluded, unrelated, unticked and stale evidence plus conflicting owner bindings", async (t) => {
    const f = await fixture(t);
    await submitHostRequest(f.store, f.bridge, { id: "extra-context", kind: "collect", scope, consent: true, expectedRevision: (await f.store.read()).revision });
    await f.callback("extra-context", 1, "running"); await f.callback("extra-context", 2, "verified", {
        sources: [source()], evidence: [{ sourceId: "repo", workExternalKey: "work-a", externalKey: "evidence-b", summary: "Another actual but unselected record.", receipt: read() }] });
    let b = await f.store.read();
    await f.store.mutate("work", { title: "User review", owner: "User" }, b.revision);
    b = await f.store.read();
    const userWorkId = b.work.at(-1).id, selectedId = b.evidence[0].id, untickedId = b.evidence[1].id;
    const payload = { workId: userWorkId, sourceId: "repo", evidenceIds: [selectedId], confirmed: true };
    assert.equal((await f.post("command", { command: "work_bind", payload: { ...payload, confirmed: false }, expectedRevision: b.revision })).statusCode, 400);
    assert.equal((await f.post("command", { command: "work_bind", payload, expectedRevision: 0 })).statusCode, 409);
    const fake = structuredClone(b);
    fake.evidence.push({ ...fake.evidence[0], id: "fake-record" });
    assert.throws(() => applyCommand(fake, "work_bind", { ...payload, evidenceIds: ["fake-record"] }), /genuinely host-ingested/);
    const unmarked = structuredClone(b); delete unmarked.evidence[0].hostIngestion;
    assert.throws(() => applyCommand(unmarked, "work_bind", payload), /genuinely host-ingested/);
    const excluded = structuredClone(b);
    excluded.host.sources[0].inventoryRequestId = "inventory";
    excluded.host.sources[0].toolId = "excluded-reader";
    excluded.host.sources[0].repoId = "repo-config";
    excluded.host.selection = { inventoryRequestId: "inventory", setupRequestId: "selected", selectedToolIds: [],
        selectedRepoIds: ["repo-config"], sources: ["repository"] };
    assert.throws(() => applyCommand(excluded, "work_bind", payload), /current consented complete/);
    const routed = structuredClone(b); routed.core.owners.push({ workId: userWorkId, sessionId: "prior-owner" });
    assert.throws(() => applyCommand(routed, "work_bind", payload), /active or routed/);
    await f.store.mutate("work_bind", payload, b.revision);
    b = await f.store.read();
    await f.store.mutate("work", { title: "Unrelated user work", owner: "User" }, b.revision);
    b = await f.store.read();
    const card = { key: "unrelated-context", evidenceId: selectedId, workId: b.work.at(-1).id, title: "Unrelated",
        why: "Must not borrow context", options: ["One", "Two"], recommendedIndex: 0, afterDecision: "Local only" };
    assert.throws(() => applyCommand(b, "card", card), /unrelated work/);
    assert.throws(() => applyCommand(b, "card", { ...card, workId: userWorkId, evidenceId: untickedId }), /unrelated work/);
    assert.throws(() => applyCommand(b, "work_bind", { ...payload, evidenceIds: [untickedId] }), /already bound/);
    await f.coreRequest("pilot", { workId: userWorkId }); await f.register(); await f.accept();
    const result = await f.result(), grant = JSON.parse(await readFile(join(f.store.directory, "callbacks", `${result.assignmentId}.json`), "utf8"));
    b = await f.store.read();
    assert.throws(() => applyCoreCommand(structuredClone(b), "core_result", { callbackCapability: grant.callbackCapability,
        result: { ...result, evidenceIds: [untickedId], card: { ...result.card, evidenceId: untickedId } } }, new Date().toISOString()), /exact verified/);
    b.host.sources[0].status = "needs-sign-in";
    assert.throws(() => applyCoreCommand(b, "core_result", { callbackCapability: grant.callbackCapability, result }, new Date().toISOString()), /context or source consent is stale/);
});
test("chosen user context semantic changes queue its owner while unchanged source reads remain quiet", async (t) => {
    const f = await fixture(t);
    let b = await f.store.read();
    await f.store.mutate("work", { title: "User context review", owner: "User" }, b.revision);
    b = await f.store.read();
    const userWorkId = b.work.at(-1).id;
    await f.store.mutate("work_bind", { workId: userWorkId, sourceId: "repo", evidenceIds: [b.evidence[0].id], confirmed: true }, b.revision);
    await f.coreRequest("pilot", { workId: userWorkId }); await f.register(); await f.accept(); await f.submit(await f.result()); await f.get();
    await submitHostRequest(f.store, f.bridge, { id: "schedule", kind: "schedule", consent: true,
        scope: { ...scope, cadence: "daily 09:00", sourceIds: ["repo"], autoPrepare: true }, expectedRevision: (await f.store.read()).revision });
    await f.callback("schedule", 1, "running");
    await f.callback("schedule", 2, "verified", { automation: { id: "schedule-a", name: "Review collector", cadence: "daily 09:00", status: "enabled",
        sessionId: "hub-session", provider: "session-automation", lastRunAt: null, nextRunAt: null, coverage: cov, receipt: read("schedule-a") } });
    await f.action("request_collection", { workspace: "sample", id: "quiet-context", scope });
    await f.callback("quiet-context", 1, "running"); await f.callback("quiet-context", 2, "verified", discovered());
    assert.equal((await f.store.read()).core.jobs.length, 1);
    await f.action("request_collection", { workspace: "sample", id: "changed-context", scope });
    await f.callback("changed-context", 1, "running"); await f.callback("changed-context", 2, "verified", discovered("A genuine changed chosen-context signal."));
    b = await f.store.read();
    const delta = b.core.deltas.find((d) => d.workId === userWorkId);
    assert.ok(delta, "bound user owner is included in the same durable scoped queue");
    assert.equal(delta.sourceId, "repo"); assert.equal(delta.sourceVersion, workSourceVersion(b, userWorkId, ["repo"]));
    const counts = { deltas: b.core.deltas.length, jobs: b.core.jobs.length };
    await f.action("request_collection", { workspace: "sample", id: "quiet-again", scope });
    await f.callback("quiet-again", 1, "running"); await f.callback("quiet-again", 2, "verified", discovered("A genuine changed chosen-context signal."));
    b = await f.store.read();
    assert.deepEqual({ deltas: b.core.deltas.length, jobs: b.core.jobs.length }, counts);
    assert.equal(b.work.find((w) => w.id === userWorkId).title, "User context review");
    assert.equal(b.work.find((w) => w.id === userWorkId).owner, "User");
});
