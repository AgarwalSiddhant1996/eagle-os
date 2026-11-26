import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    clearError,
    showError,
    canRefresh,
    toolSelection,
    routingWorkstreams,
    setupOutcome,
    setupSteps,
    humanStatusLabel,
    humanReadiness,
    todayEmptyState,
    recentActivity,
} from "../ui/ui-state.mjs";

test("an error followed by a successful action hides both the error and its friction helper", async () => {
    const error = { hidden: true, textContent: "", focus() { this.focused = true; } }, report = { hidden: true };
    const guarded = async (fn) => { clearError(error, report); try { await fn(); } catch (e) { showError(error, report, e.message); } };
    await guarded(async () => { throw Error("Source access failed."); });
    assert.equal(error.hidden, false); assert.equal(report.hidden, false); assert.equal(error.focused, true);
    await guarded(async () => {});
    assert.equal(error.hidden, true); assert.equal(report.hidden, true); assert.equal(error.textContent, "");
});
test("live host progress never replaces unsaved forms, modal work, active typing or unrelated wizard steps", () => {
    const safe = { pending: true, dirty: false, dialogOpen: false, editing: false };
    assert.equal(canRefresh(safe), true);
    assert.equal(canRefresh({ ...safe, wizardStep: 1 }), true);
    assert.equal(canRefresh({ ...safe, wizardStep: 3 }), true);
    for (const field of ["dirty", "dialogOpen", "editing"]) assert.equal(canRefresh({ ...safe, [field]: true }), false);
    assert.equal(canRefresh({ ...safe, wizardStep: 0 }), false);
    assert.equal(canRefresh({ ...safe, wizardStep: 2 }), false);
    assert.equal(canRefresh({ ...safe, pending: false }), false);
});
const inventory = {
    requestId: "inventory-one",
    tools: [
        { id: "issues", status: "available", sourceTypes: ["repository"] },
        { id: "files", status: "available", sourceTypes: ["documents"] },
        { id: "mail", status: "needs-sign-in", sourceTypes: ["messages"] },
        { id: "design", status: "missing", sourceTypes: ["design"] },
        { id: "host-routing", status: "available", sourceTypes: [] },
    ],
    repositories: [
        { id: "repo-one", name: "sample/one", status: "available" },
        { id: "repo-two", name: "sample/two", status: "available" },
        { id: "repo-unknown", name: "unknown", status: "unknown" },
    ],
};
test("detect-first proposes all available tools and repositories without checking unavailable entries", () => {
    const selected = toolSelection(inventory);
    assert.deepEqual(selected.selectedToolIds, ["issues", "files", "host-routing"]);
    assert.deepEqual(selected.selectedRepoIds, ["repo-one", "repo-two"]);
    assert.deepEqual(selected.sources, ["repository", "documents"]);
    assert.equal(selected.repository, "");
});
test("unchecked tool and repository exclusions narrow actual source scope and survive inventory refresh", () => {
    const excluded = { tools: ["files"], repositories: ["repo-two"] };
    const selected = toolSelection(inventory, excluded);
    assert.deepEqual(selected.selectedToolIds, ["issues", "host-routing"]);
    assert.deepEqual(selected.selectedRepoIds, ["repo-one"]);
    assert.deepEqual(selected.sources, ["repository"]); assert.equal(selected.repository, "sample/one");
    const again = toolSelection({ ...inventory, requestId: "inventory-two" }, excluded);
    assert.deepEqual(again.selectedToolIds, selected.selectedToolIds);
    assert.equal(again.inventoryRequestId, "inventory-two");
});
test("invalid saved exclusions fail instead of silently reselecting every tool", () => {
    assert.throws(() => toolSelection(inventory, { tools: "files", repositories: [] }), /invalid/);
});
test("hub routing offers distinct real workstreams and removes excluded-source and synthetic choices", () => {
    const board = { work: [
        { id: "first", sourceId: "source-one", title: "First review" },
        { id: "second", sourceId: "source-one", title: "Second review" },
        { id: "excluded", sourceId: "source-two", title: "Outside scope" },
        { id: "demo", sourceId: "source-one", title: "Example", synthetic: true },
        { id: "manual", title: "Unbound plan" },
    ] };
    assert.deepEqual(routingWorkstreams(board, ["source-one"]).map((w) => w.id), ["first", "second"]);
    assert.deepEqual(routingWorkstreams(board, []).map((w) => w.id), []);
    assert.equal(board.work.length, 5);
});
test("a terminal setup narrative cannot count empty structured bindings as verified sources", () => {
    const host = { sources: [], requests: [{ id: "broken", kind: "setup", status: "partial", detail: "Verified 13 selected sources." }] };
    const outcome = setupOutcome(host);
    assert.equal(outcome.missingBindings, true); assert.equal(outcome.verified, 0);
    assert.equal(outcome.latest.id, "broken"); assert.equal(outcome.terminal, true);
    const recovered = setupOutcome({ ...host, sources: [{ id: "one", status: "verified", receipt: { readAt: "2026-11-23T00:00:00Z" } }],
        requests: [...host.requests, { id: "fresh", kind: "setup", status: "verified" }] });
    assert.equal(recovered.missingBindings, false); assert.equal(recovered.verified, 1); assert.equal(recovered.latest.id, "fresh");
});
test("blocked sources and pending reads stay distinct from real verified source receipts", () => {
    const blockedSources = [{ toolId: "blocked", status: "needs-sign-in", detail: "Authentication required." }];
    const failed = setupOutcome({ sources: [], requests: [{ id: "failed", kind: "setup", status: "blocked", blockedSources }] });
    assert.equal(failed.missingBindings, false); assert.equal(failed.verified, 0); assert.deepEqual(failed.blockedSources, blockedSources);
    const pending = setupOutcome({ sources: [{ status: "verified" }, { status: "partial", receipt: {} }], requests: [{ kind: "setup", status: "running" }] });
    assert.equal(pending.terminal, false); assert.equal(pending.verified, 0);
});
test("human status and readiness helpers map internal slugs to calm plain-English labels", () => {
    assert.equal(humanStatusLabel("workspace-ready"), "Ready");
    assert.equal(humanStatusLabel("on-demand-ready"), "Ready");
    assert.equal(humanStatusLabel("daily-configured"), "Morning brief scheduled");
    assert.equal(humanStatusLabel("needs-sign-in"), "Sign in needed");
    const hostWithFourSources = {
        sources: [1, 2, 3, 4].map((n) => ({ id: `src-${n}`, status: "verified", receipt: { readAt: "2026-11-23T08:00:00Z" } })),
        automation: null,
    };
    const needsDaily = humanReadiness({ status: "workspace-ready" }, hostWithFourSources, false);
    assert.equal(needsDaily.label, "Needs daily setup");
    assert.equal(needsDaily.tone, "verified");
    const dismissedDaily = humanReadiness({ status: "workspace-ready" }, hostWithFourSources, true);
    assert.equal(dismissedDaily.label, "Ready");
    const scheduled = humanReadiness({ status: "daily-configured" }, { ...hostWithFourSources, automation: { status: "enabled", cadence: "Weekdays 8:30 AM" } }, false);
    assert.equal(scheduled.label, "Morning brief scheduled");
});
test("today empty state offers actionable Prepare decision cards CTA when sources are connected and 0 cards exist", () => {
    const fourConnected = {
        sources: [1, 2, 3, 4].map((n) => ({ id: `s-${n}`, status: "verified", receipt: { readAt: "2026-11-23T08:00:00Z" } })),
    };
    const readyToPrepare = todayEmptyState({ code: "pending", cards: [] }, fourConnected);
    assert.equal(readyToPrepare.action, "prepare");
    assert.equal(readyToPrepare.cta, "Prepare decision cards");
    assert.match(readyToPrepare.detail, /4 sources are connected/);
    const unconnected = todayEmptyState({ code: "setup", cards: [] }, { sources: [] });
    assert.equal(unconnected.action, "connections");
    assert.equal(unconnected.cta, "Connect tools");
    const blocked = todayEmptyState({ code: "blocked", cards: [] }, fourConnected);
    assert.equal(blocked.action, "connections");
});
test("recentActivity hides internal host plumbing and deduplicates repeated Workspace updated rows", () => {
    const events = [
        { command: "setup_progress", at: "2026-11-23T08:00:00Z" },
        { command: "unknown_one", at: "2026-11-23T08:01:00Z" },
        { command: "unknown_two", at: "2026-11-23T08:02:00Z" },
        { command: "unknown_three", at: "2026-11-23T08:03:00Z" },
        { command: "host_inventory", at: "2026-11-23T08:04:00Z" },
        { command: "card", at: "2026-11-23T08:05:00Z" },
    ];
    const items = recentActivity(events, 5);
    assert.deepEqual(items.map((item) => item.label), ["Decision card prepared", "Workspace updated"]);
    assert.equal(items[1].at, "2026-11-23T08:03:00Z");
});
test("onboarding copy and UI templates keep calm plain-English labels, card surfaces and 2-column Today structure", () => {
    assert.deepEqual(setupSteps.map((s) => s.label), ["Focus", "Connected tools", "Playbooks", "Ready"]);
    const uiDir = path.resolve(import.meta.dirname, "../ui");
    const appSource = fs.readFileSync(path.join(uiDir, "app.mjs"), "utf8");
    const stateSource = fs.readFileSync(path.join(uiDir, "ui-state.mjs"), "utf8");
    const cssSource = fs.readFileSync(path.join(uiDir, "style.css"), "utf8");
    for (const bannedJargon of ["availability inventory", "record_host_result", "These are the recorded host results", "On-demand is valid."]) {
        assert.equal(appSource.includes(bannedJargon), false, `Unexpected jargon in app.mjs: ${bannedJargon}`);
        assert.equal(stateSource.includes(bannedJargon), false, `Unexpected jargon in ui-state.mjs: ${bannedJargon}`);
    }
    assert.equal(appSource.includes("tag(core.readiness.status)"), false);
    assert.equal(cssSource.includes(".panel-card"), true);
    assert.equal(cssSource.includes(".today-columns"), true);
    assert.equal(cssSource.includes(".briefing-card"), true);
});
