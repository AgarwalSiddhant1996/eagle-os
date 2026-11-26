import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore, applyCommand, blankBoard } from "../src/store.mjs";
import { startServer } from "../src/server.mjs";
import { skillCatalog } from "../src/skills.mjs";

const profile = { role: "pm", title: "Test studio", preset: "feature-pm", jobs: ["Review changes"], decisions: ["Pick a next step"], sources: [] };
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), "eagle-parity-")); t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    return new WorkspaceStore({ root, id: "review" });
}
test("first-run progress survives reload without pretending the workspace is configured", async (t) => {
    const store = await fixture(t);
    await assert.rejects(() => store.mutate("setup_progress", { step: 2, draft: { ...profile, decisions: "Pick a next step", skills: [] } }, 0), /unsupported field/);
    const saved = await store.mutate("setup_progress", { step: 0, draft: { role: "pm", title: "Feature review", jobs: ["Review feature feedback"], decisions: "Choose an approach", skills: [] } }, 0);
    const again = await new WorkspaceStore({ root: store.root, id: "review" }).read();
    assert.equal(again.profile, null); assert.equal(again.onboarding.step, 0); assert.equal(again.onboarding.draft.role, "pm");
    assert.equal(saved.cards.length, 0);
});
test("onboarding requires explicit synthetic acknowledgement, creates one usable card and never duplicates it", async (t) => {
    const store = await fixture(t);
    await assert.rejects(() => store.mutate("onboard_complete", profile, 0), /acknowledge/);
    let b = await store.mutate("onboard_complete", { ...profile, exampleReviewed: true }, 0);
    assert.equal(b.onboarding.complete, true); assert.equal(b.cards.length, 1);
    assert.equal(b.evidence[0].status, "verified"); assert.equal(b.evidence[0].synthetic, true);
    assert.match(b.evidence[0].verificationMethod, /User acknowledged/);
    b = await store.mutate("onboard_complete", { ...profile, exampleReviewed: true }, b.revision);
    assert.equal(b.cards.length, 1); assert.equal(b.tasks.length, 1);
});
test("work detail and dated follow-ups persist with validation; old v1 workspaces gain tasks without losing cards", async (t) => {
    const store = await fixture(t);
    let b = await store.mutate("intake", profile, 0);
    b = await store.mutate("work", { title: "Test work", owner: "Reviewer" }, b.revision);
    const id = b.work[0].id;
    b = await store.mutate("work_update", { id, owner: "Owner", status: "active", nextAction: "Read the source" }, b.revision);
    assert.equal(b.work[0].owner, "Owner"); assert.equal(b.work[0].nextAction, "Read the source");
    await assert.rejects(() => store.mutate("task", { workId: id, title: "Follow up", dueDate: "2026-02-31" }, b.revision), /valid/);
    b = await store.mutate("task", { workId: id, title: "Follow up", dueDate: "2026-12-01" }, b.revision);
    b = await store.mutate("task_update", { id: b.tasks[0].id, status: "done" }, b.revision);
    assert.equal(b.tasks[0].status, "done");
    const legacy = blankBoard("legacy"); delete legacy.tasks; legacy.profile = profile;
    const updated = applyCommand(legacy, "work", { title: "New item" });
    assert.deepEqual(updated.cards, []); assert.deepEqual(updated.tasks, []);
});
test("native state truthfully reports canvas mode and bundled skills; install requires opt-in and remains workspace-local", async (t) => {
    const store = await fixture(t), panel = await startServer({ store, hostMode: "native-canvas" }); t.after(() => panel.close());
    const base = new URL(panel.url), token = base.pathname.split("/")[1];
    const headers = { "X-Workspace-Token": token, "Content-Type": "application/json", Origin: base.origin };
    const state = await (await fetch(new URL("state", base), { headers })).json();
    assert.equal(state.connections.host, "native-canvas"); assert.equal(state.connections.remoteWorker, "not_configured");
    assert.equal(state.skills.available.length, (await skillCatalog()).length); assert.equal(state.skills.installed.length, 0);
    const skill = state.skills.available[0].id;
    const denied = await fetch(new URL("skills", base), { method: "POST", headers, body: JSON.stringify({ ids: [skill] }) });
    assert.equal(denied.status, 400);
    const added = await fetch(new URL("skills", base), { method: "POST", headers, body: JSON.stringify({ ids: [skill], consent: true }) });
    assert.equal(added.status, 200);
    const next = await (await fetch(new URL("state", base), { headers })).json();
    assert.equal(next.skills.installed.length, 1);
    const installed = await readFile(join(store.directory, "skills", skill, "SKILL.md"), "utf8");
    assert.match(installed, /^---/);
});
