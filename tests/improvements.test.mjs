import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore, blankBoard, applyCommand } from "../src/store.mjs";
import { detectPatterns, hashText, exactDiff, readWorkspaceSkill } from "../src/improvements.mjs";
import { startServer } from "../src/server.mjs";

const feedback = { category: "missed-check", workflow: "Review", expected: "Read the evidence first", actual: "A check was skipped", occurrence: "run-one" };
const before = '---\nname: sample\nversion: 1.0.0\ndescription: Check a sample task.\n---\nRead the evidence.\n';
const after = before + "Record the source before deciding.\n";
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), "eagle-improvement-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    return new WorkspaceStore({ root, id: "local" });
}
async function ready(t, kind = "workspace-skill") {
    const store = await fixture(t);
    await mkdir(join(store.directory, "skills", "sample"), { recursive: true });
    await writeFile(join(store.directory, "skills", "sample", "SKILL.md"), before);
    let b = await store.mutate("friction", feedback, 0);
    b = await store.mutate("improvement_propose", { title: "Check sources first", observed: feedback.actual,
        inference: "The checklist may omit a step.", feedbackIds: [b.improvements.feedback[0].id], confirmed: true,
        patch: { kind, target: kind === "workspace-skill" ? "sample" : "reviewed-file", before, after, scenario: "Repeat the skipped-source case and confirm the source is recorded." } }, b.revision);
    return { store, b, payload: { id: b.improvements.candidates[0].id, digest: b.improvements.candidates[0].digest, confirmed: true } };
}
test("friction is local, retries deduplicate, changed occurrence reuse fails and patterns state facts rather than a proven cause", async (t) => {
    const store = await fixture(t);
    let b = await store.mutate("friction", feedback, 0);
    b = await store.mutate("friction", feedback, b.revision);
    assert.equal(b.improvements.feedback.length, 1);
    assert.deepEqual(detectPatterns(b.improvements), []);
    await assert.rejects(() => store.mutate("friction", { ...feedback, actual: "Different result" }, b.revision), /different content/);
    b = await store.mutate("friction", { ...feedback, occurrence: "run-two" }, b.revision);
    const [pattern] = detectPatterns(b.improvements);
    assert.equal(pattern.count, 2); assert.equal(pattern.feedbackIds.length, 2);
    assert.match(pattern.observed, /not independently verified/); assert.match(pattern.inference, /not established/);
    assert.equal((await store.read()).improvements.feedback.length, 2);
    b = await store.mutate("friction_delete", { id: b.improvements.feedback[0].id }, b.revision);
    assert.deepEqual(detectPatterns(b.improvements), []);
    assert.equal(b.improvements.feedback[0].actual, undefined);
});
test("an old workspace gains improvements without losing work or notes", () => {
    const legacy = blankBoard("legacy"); delete legacy.improvements;
    legacy.work.push({ id: "retained", title: "Existing work" });
    const b = applyCommand(legacy, "friction", feedback);
    assert.deepEqual(b.work, legacy.work);
    assert.equal(b.improvements.feedback[0].status, "captured");
    assert.equal(legacy.improvements, undefined);
});
test("exact patch approval, guarded application and original-scenario verification are separate durable stages", async (t) => {
    let { store, b, payload } = await ready(t);
    const target = join(store.directory, "skills", "sample", "SKILL.md");
    const c = b.improvements.candidates[0], preview = exactDiff(c.patch);
    assert.match(preview, /--- before\/sample/); assert(preview.includes("+Record the source before deciding."));
    await assert.rejects(() => store.mutate("apply_workspace_patch", payload, b.revision), /approved/);
    await assert.rejects(() => store.mutate("improvement_approve", { ...payload, digest: "stale" }, b.revision), /changed/);
    await assert.rejects(() => store.mutate("improvement_approve", { ...payload, confirmed: false }, b.revision), /explicitly approve/);
    b = await store.mutate("improvement_approve", payload, b.revision);
    assert.equal(await readFile(target, "utf8"), before);
    await assert.rejects(() => store.mutate("improvement_verify", { ...payload, passed: true, evidence: "Case passed" }, b.revision), /Apply/);
    b = await store.mutate("apply_workspace_patch", payload, b.revision);
    assert.equal(await readFile(target, "utf8"), after);
    assert.equal(b.improvements.candidates[0].status, "applied");
    assert.equal(b.improvements.candidates[0].application.readbackHash, hashText(after));
    b = await store.mutate("improvement_verify", { ...payload, passed: false, evidence: "Source was still omitted." }, b.revision);
    assert.equal(b.improvements.candidates[0].status, "applied");
    b = await store.mutate("improvement_verify", { ...payload, passed: true, evidence: "Repeated the original case; source and scope were checked." }, b.revision);
    assert.equal(b.improvements.candidates[0].status, "verified");
    assert.equal(b.improvements.candidates[0].verificationAttempts.length, 2);
    assert.deepEqual(b.improvements.candidates[0].history.map((h) => h.status), ["proposed", "approved", "applied", "verified"]);
    assert.equal((await store.read()).improvements.candidates[0].status, "verified");
});
test("a concurrent custom edit or stale board revision prevents application without overwriting the skill", async (t) => {
    let { store, b, payload } = await ready(t);
    b = await store.mutate("improvement_approve", payload, b.revision);
    const target = join(store.directory, "skills", "sample", "SKILL.md"), custom = before + "A local customization.\n";
    await writeFile(target, custom);
    await assert.rejects(() => store.mutate("apply_workspace_patch", payload, b.revision - 1), /changed/);
    await assert.rejects(() => store.mutate("apply_workspace_patch", payload, b.revision), /Nothing was overwritten/);
    assert.equal(await readFile(target, "utf8"), custom);
    assert.equal((await store.read()).improvements.candidates[0].status, "approved");
});
test("exact before text and patch readback preserve installed CRLF skill files", async (t) => {
    let { store, b } = await ready(t);
    const target = join(store.directory, "skills", "sample", "SKILL.md"), windowsBefore = before.replace(/\n/g, "\r\n");
    await writeFile(target, windowsBefore);
    assert.equal(await readWorkspaceSkill(store.directory, "sample"), windowsBefore);
    const windowsAfter = windowsBefore + "Check the original scenario.\r\n";
    b = await store.mutate("improvement_propose", { title: "Keep exact line endings", observed: "The scenario was missed.",
        feedbackIds: [b.improvements.feedback[0].id], confirmed: true,
        patch: { kind: "workspace-skill", target: "sample", before: windowsBefore, after: windowsAfter, scenario: "Repeat the missed case." } }, b.revision);
    const candidate = b.improvements.candidates.at(-1), payload = { id: candidate.id, digest: candidate.digest, confirmed: true };
    b = await store.mutate("improvement_approve", payload, b.revision);
    b = await store.mutate("apply_workspace_patch", payload, b.revision);
    assert.equal(await readFile(target, "utf8"), windowsAfter);
    assert.equal(b.improvements.candidates.at(-1).status, "applied");
});
test("review-only changes require approval and exact after-hash readback, not a pretend application", async (t) => {
    let { store, b, payload } = await ready(t, "review-only");
    await assert.rejects(() => store.mutate("improvement_applied", { ...payload, evidence: "Read back" }, b.revision), /Approve/);
    b = await store.mutate("improvement_approve", payload, b.revision);
    await assert.rejects(() => store.mutate("improvement_applied", { ...payload, evidence: "Read back", readbackHash: hashText(before) }, b.revision), /does not match/);
    b = await store.mutate("improvement_applied", { ...payload, evidence: "Owner reports the reviewed file was changed.", readbackHash: hashText(after) }, b.revision);
    assert.match(b.improvements.candidates[0].application.method, /not independently inspected/);
    assert.equal(await readFile(join(store.directory, "skills", "sample", "SKILL.md"), "utf8"), before);
});
test("rejected and deferred proposals do not regenerate an unchanged pattern; new occurrences can reopen discovery", async (t) => {
    let { store, b, payload } = await ready(t);
    b = await store.mutate("improvement_defer", { ...payload, reason: "Review later" }, b.revision);
    assert.deepEqual(detectPatterns(b.improvements), []);
    b = await store.mutate("improvement_reopen", payload, b.revision);
    b = await store.mutate("improvement_reject", { ...payload, reason: "Wrong fix" }, b.revision);
    await assert.rejects(() => store.mutate("improvement_approve", payload, b.revision), /proposed/);
    b = await store.mutate("friction", { ...feedback, occurrence: "run-two" }, b.revision);
    assert.equal(detectPatterns(b.improvements)[0].count, 2);
});
test("patch targets cannot escape the workspace, introduce invalid skill metadata or follow symlinks", async (t) => {
    let { store, b, payload } = await ready(t);
    const proposal = { title: "Invalid target", observed: "Skipped check", feedbackIds: [b.improvements.feedback[0].id], confirmed: true };
    for (const target of ["../elsewhere", "a\\b", "a/b"]) {
        await assert.rejects(() => store.mutate("improvement_propose", { ...proposal, patch: { kind: "workspace-skill", target, before, after, scenario: "Repeat case" } }, b.revision), /not a path/);
    }
    await assert.rejects(() => store.mutate("improvement_propose", { ...proposal, patch: { kind: "workspace-skill", target: "sample", before, after: "Broken metadata", scenario: "Repeat case" } }, b.revision), /metadata/);
    b = await store.mutate("improvement_approve", payload, b.revision);
    const target = join(store.directory, "skills", "sample", "SKILL.md"), outside = join(store.root, "outside.md");
    await writeFile(outside, before); await rm(target);
    try { await symlink(outside, target); }
    catch (e) { if (e.code === "EPERM") { t.diagnostic("File symlink creation unavailable; path-traversal and metadata guards exercised."); return; } throw e; }
    await assert.rejects(() => store.mutate("apply_workspace_patch", payload, b.revision), /never links/);
    assert.equal(await readFile(outside, "utf8"), before);
});
test("HTTP requires same-origin consent, exposes exact previews, and does not invent remote capabilities", async (t) => {
    const { store } = await ready(t), server = await startServer({ store }); t.after(() => server.close());
    const base = new URL(server.url), headers = { "X-Workspace-Token": base.pathname.split("/")[1], Origin: base.origin, "Content-Type": "application/json" };
    const state = await (await fetch(new URL("state", base), { headers })).json();
    assert.deepEqual(state.skills.capabilities, []);
    assert.match(Object.values(state.improvements.previews)[0], /Record the source/);
    const denied = await fetch(new URL("command", base), { method: "POST", headers: { ...headers, Origin: "https://example.test" }, body: JSON.stringify({ command: "improvement_approve" }) });
    assert.equal(denied.status, 403);
    const traversal = await fetch(new URL("skill-text?id=..", base), { headers });
    assert.equal(traversal.status, 400);
});
