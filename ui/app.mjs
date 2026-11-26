import {
    clearError,
    showError,
    canRefresh,
    toolSelection,
    routingWorkstreams,
    setupSteps,
    setupOutcome,
    humanStatusLabel,
    humanReadiness,
    todayEmptyState,
    recentActivity,
} from "./ui-state.mjs";
import { navigationViews, domainRows } from "./domain-state.mjs";

const token = location.pathname.split("/")[1];
const root = document.querySelector("#content"), error = document.querySelector("#error");
let state, view = "today", workOpen = "", setup = null, settingsOpen = false, filter = "", dirty = false, settingsPage = "preferences";
let prepareOpen = false, inventoryStarting = false;

const el = (tagName, text, cls) => {
    const n = document.createElement(tagName);
    if (text !== undefined && text !== null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
};
const button = (labelText, fn, cls = "") => {
    const n = el("button", labelText, cls);
    n.type = "button";
    n.addEventListener("click", () => guarded(() => fn(n)));
    return n;
};
const label = (name, control) => {
    const n = el("label", name);
    n.append(control);
    return n;
};
function input(name, value = "", placeholder = "") {
    const n = el("input");
    n.name = name;
    n.value = value;
    n.placeholder = placeholder;
    n.maxLength = 500;
    return n;
}
function textarea(name, value = "", maxLength = 1000) {
    const n = el("textarea");
    n.name = name;
    n.value = value;
    n.maxLength = maxLength;
    n.rows = 4;
    return n;
}
function select(name, options, value) {
    const n = el("select");
    n.name = name;
    for (const [id, text] of options) {
        const o = el("option", text);
        o.value = id;
        n.append(o);
    }
    if (value !== undefined) n.value = value;
    return n;
}
function checkbox(text, checked, onChange) {
    const n = input("", "", "");
    n.type = "checkbox";
    n.checked = checked;
    n.addEventListener("change", () => onChange(n.checked));
    return label(text, n);
}
function statusTone(status = "") {
    if (["verified", "enabled", "configured", "daily-verified", "daily-configured", "ready", "active", "done", "completed"].includes(status)) return "verified";
    if (["blocked", "failed", "needs-sign-in"].includes(status)) return "blocked";
    if (["partial", "queued", "running", "assigned", "routing", "owner-ready", "proposed"].includes(status)) return "warn";
    return "";
}
function tag(text, status = "") {
    const tone = ["verified", "blocked", "warn"].includes(status) ? status : statusTone(status);
    return el("span", text, tone ? `tag ${tone}` : "tag");
}
function statusTag(rawStatus) {
    return tag(humanStatusLabel(rawStatus), rawStatus);
}
function panelCard(title, { count, action } = {}) {
    const card = el("section", null, "panel-card");
    const head = el("div", null, "card-head");
    const left = el("div", null, "card-head-left");
    left.append(el("h2", title));
    if (count !== undefined && count !== null) left.append(el("span", String(count), "count-pill"));
    head.append(left);
    if (action) head.append(action);
    card.append(head);
    return card;
}
function heading(title, description, into = root, action = null) {
    const head = el("div", null, "page-head");
    const copy = el("div", null, "page-head-copy");
    copy.append(el("h1", title));
    if (description) copy.append(el("p", description, "page-description"));
    head.append(copy);
    if (action) head.append(action);
    into.append(head);
}
function empty(title, detail, ctaButton = null) {
    const n = el("div", null, "empty");
    n.append(el("h3", title), el("p", detail));
    if (ctaButton) {
        const actions = el("div", null, "action-row");
        actions.append(ctaButton);
        n.append(actions);
    }
    return n;
}
function time(value) {
    return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
async function request(path, data) {
    const response = await fetch(new URL(path, location.href), {
        method: data ? "POST" : "GET",
        headers: { "X-Workspace-Token": token, ...(data ? { "Content-Type": "application/json" } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
        cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    return result;
}
async function guarded(fn) {
    clearError(error, document.querySelector("#report-error"));
    try { await fn(); }
    catch (e) { showError(error, document.querySelector("#report-error"), e.message); }
}
async function load() {
    state = await request("state");
    if (!state.board.profile && !setup) {
        setup = {
            step: state.board.onboarding?.step ?? 0,
            draft: {
                role: "pm",
                title: "",
                preset: "feature-pm",
                jobs: [],
                decisions: "",
                skills: [],
                connectionMode: "",
                sourceTypes: [],
                repository: "",
                ...(state.board.onboarding?.draft ?? {}),
            },
        };
    }
    render();
}
async function command(name, payload) {
    await request("command", { command: name, payload, expectedRevision: state.board.revision });
    dirty = false;
    await load();
}
const pendingStatuses = new Set(["queued", "running"]);
function hostState() {
    return state.host ?? {
        available: false,
        requests: [],
        sources: [],
        owners: [],
        automation: null,
        remote: { status: "unavailable", detail: "No host bridge is connected." },
        brief: null,
    };
}
function coreState() {
    return state.core ?? { readiness: { status: "workspace-ready", detail: "", checks: [] }, jobs: [] };
}
function hostScope(overrides = {}) {
    const binding = hostState().requests.findLast((r) => r.kind === "setup" && ["verified", "partial"].includes(r.status) && r.scope.inventoryRequestId)?.scope;
    return {
        ...(binding ? { inventoryRequestId: binding.inventoryRequestId, selectedToolIds: binding.selectedToolIds, selectedRepoIds: binding.selectedRepoIds } : {}),
        purpose: setup?.draft.decisions || state.board.profile?.decisions?.join("; ") || "Review work",
        sources: setup?.draft.sourceTypes ?? [...new Set(hostState().sources.map((s) => s.kind || s.type).filter(Boolean))],
        repository: setup?.draft.repository || "",
        cadence: "",
        worker: "",
        ...overrides,
    };
}
async function hostRequest(kind, scope, extra = {}, { fresh = false } = {}) {
    if (!hostState().available) throw Error("Open Eagle OS inside a connected workspace chat to check live tools.");
    const key = `eagle-request:${state.board.workspaceId}:${JSON.stringify({ kind, scope, ...extra })}`;
    let id = sessionStorage.getItem(key);
    const existing = hostState().requests.find((r) => r.id === id);
    if (fresh || !id || existing?.status === "verified") {
        id = crypto.randomUUID();
        sessionStorage.setItem(key, id);
    }
    dirty = false;
    try {
        await request("host-request", { id, kind, scope, ...extra, consent: kind !== "inventory", expectedRevision: state.board.revision });
    } finally {
        await load();
    }
}
async function rerunConnectionCheck() {
    const previous = setupOutcome(hostState()).latest;
    if (!previous || pendingStatuses.has(previous.status)) throw Error("Wait for the current check to finish before trying again.");
    await hostRequest("setup", { ...previous.scope, recoveryOf: previous.id }, {}, { fresh: true });
}
function inventoryScope() {
    return { purpose: setup?.draft.decisions || state.board.profile?.decisions?.join("; ") || "Find available tools for this workspace", sources: [] };
}
async function ensureInventory() {
    if (inventoryStarting || !hostState().available || hostState().inventory || hostState().requests.some((r) => r.kind === "inventory")) return;
    inventoryStarting = true;
    try { await hostRequest("inventory", inventoryScope()); }
    finally { inventoryStarting = false; }
}
function formSubmit(form, title, action) {
    const b = el("button", title, "primary");
    b.type = "submit";
    form.append(b);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        guarded(async () => {
            b.disabled = true;
            try { await action(new FormData(form)); }
            finally { b.disabled = false; }
        });
    });
}
function openPrepareFlow() {
    prepareOpen = true;
    view = "today";
    render();
    const field = root.querySelector("[name='core-goal'], [name='core-work']");
    field?.focus();
}
function evidenceList(workId = "") {
    const section = el("section", null, "timeline");
    const context = state.board.work.find((w) => w.id === workId)?.sourceContext;
    const contextIds = new Set(context?.evidenceIds ?? []);
    const list = state.board.evidence.filter((e) => !workId || e.workId === workId || contextIds.has(e.id) && e.sourceId === context.sourceId).slice().reverse();
    if (!list.length) return empty("No source notes yet", "Add a note from a connected tool or record an open question.");
    for (const e of list) {
        const row = el("article", null, "timeline-entry");
        const top = el("div", null, "row");
        top.append(statusTag(e.status), el("time", time(e.recordedAt)));
        row.append(top, el("p", e.summary));
        if (e.synthetic) row.append(tag("Sample item"));
        if (workId && e.workId !== workId) row.append(tag("Linked context"));
        if (e.url) {
            const a = el("a", "Open source");
            a.href = e.url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            row.append(a);
        }
        section.append(row);
    }
    return section;
}
function followUps(workId = "") {
    const section = el("section", null, "followups");
    const tasks = (state.board.tasks ?? []).filter((t) => t.status === "open" && (!workId || t.workId === workId));
    if (!tasks.length) return empty("All clear for now", "Add a follow-up from any work item when you want to track a next step.");
    for (const task of tasks) {
        const row = el("div", null, "task-row");
        const toggle = input("", "");
        toggle.type = "checkbox";
        toggle.setAttribute("aria-label", `Complete ${task.title}`);
        toggle.addEventListener("change", () => guarded(() => command("task_update", { id: task.id, status: "done" })));
        const detail = el("div");
        detail.append(el("span", task.title), el("small", task.dueDate ? `Due ${task.dueDate}` : "No due date"));
        if (task.sourceUrl) {
            const a = el("a", "Open link");
            a.href = task.sourceUrl;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            detail.append(a);
        }
        row.append(toggle, detail);
        section.append(row);
    }
    return section;
}
function decisionCard(card) {
    const n = el("article", null, "decision-card");
    const evidence = state.board.evidence.find((e) => e.id === card.evidenceId);
    const work = state.board.work.find((w) => w.id === card.workId);
    const owner = hostState().owners.find((o) => o.workId === card.workId);
    const top = el("div", null, "row");
    top.append(
        tag(card.synthetic ? "Sample card" : card.kind === "draft" ? "Draft to review" : "Decision", "verified"),
        el("span", owner?.name || work?.owner || "Unassigned", "muted"),
    );
    n.append(top, el("h3", card.title), el("p", card.why));
    if (card.kind === "draft" && card.draft) {
        n.append(el("p", `${card.draft.channel} · ${card.draft.target}`, "muted"), el("blockquote", card.draft.text, "draft-body"));
    }
    const proof = el("details", null, "proof");
    proof.append(
        el("summary", "Source context and impact"),
        el("p", evidence?.summary ?? "No source summary attached."),
        el("p", card.afterDecision),
    );
    n.append(proof);
    const choices = el("div", null, "decision-options");
    for (const [index, option] of card.options.entries()) {
        choices.append(button(
            option + (index === card.recommendedIndex ? " (Recommended)" : ""),
            () => command("resolve", { id: card.id, choice: index }),
            index === card.recommendedIndex ? "primary" : "secondary",
        ));
    }
    const response = textarea("own-response", "", 1000);
    response.placeholder = card.kind === "draft" ? "Edit the draft or note what to adjust" : "Write your own direction if none of the options fit";
    n.append(
        el("p", `Next: ${card.consequences || card.afterDecision}`, "consequence"),
        choices,
        label("Custom note (optional)", response),
        button("Save custom response", () => command("resolve", { id: card.id, response: response.value }), "secondary compact-btn"),
        el("small", "Saves your decision locally. Nothing is sent externally without separate approval."),
        button("Flag an issue with this card", () => reportFriction(`card:${card.id}`), "text-button"),
    );
    return n;
}
function sourcePicker(parent) {
    const selection = hostState().selection || state.board.host?.selection;
    const sources = hostState().sources.filter((s) => ["verified", "partial"].includes(s.status) && s.receipt
        && (!selection || selection.selectedToolIds.includes(s.toolId) && (s.type !== "repository" || selection.selectedRepoIds.includes(s.repoId))));
    const selected = new Set(sources.map((s) => s.id));
    for (const s of sources) parent.append(checkbox(s.label, true, (checked) => checked ? selected.add(s.id) : selected.delete(s.id)));
    if (!sources.length) parent.append(el("p", "Connect at least one tool first so Eagle knows where to read updates.", "muted"));
    return selected;
}
function renderPrepareForm(parent, workId = "") {
    const box = el("div", null, workId ? "add-section" : "inline-drawer");
    box.append(el("h3", workId ? "Prepare options for this workstream" : "Prepare decision cards"),
        el("p", "Pick the connected sources and tell the workstream owner what options or draft you want prepared.", "muted"));
    const form = el("form");
    const selected = sourcePicker(form);
    if (!workId) {
        const works = routingWorkstreams(state.board, selected);
        if (!works.length) {
            box.append(
                el("p", "Link a work item to one of your connected sources first so an owner can prepare cards for it.", "notice"),
                button("Go to Work items", () => { prepareOpen = false; view = "work"; render(); }, "secondary compact-btn"),
            );
            parent.append(box);
            return;
        }
        const pick = select("core-work", [["", "Choose a workstream"], ...works.map((w) => [w.id, w.title])], works.length === 1 ? works[0].id : "");
        pick.required = true;
        form.append(label("Workstream", pick));
    }
    const goal = textarea("core-goal", "", 1000);
    goal.required = true;
    goal.placeholder = "e.g. Summarize recent blockers and prepare decision options for our next check-in";
    const tier = select("tier", [
        ["fast", "Fast: quick status check"],
        ["mid", "Balanced: routine card preparation"],
        ["complex", "Deep: complex trade-offs or specs"],
    ], "mid");
    const auto = input("autoPrepare");
    auto.type = "checkbox";
    form.append(
        label("What should Eagle prepare?", goal),
        label("Depth", tier),
        label("Keep preparing updates when new activity arrives in these sources", auto),
    );
    const requestId = crypto.randomUUID();
    formSubmit(form, "Prepare cards", async (data) => {
        if (!selected.size) throw Error("Keep at least one connected source selected.");
        const targetId = workId || data.get("core-work");
        if (!routingWorkstreams(state.board, selected).some((w) => w.id === targetId)) throw Error("Select a workstream linked to the chosen sources.");
        dirty = false;
        prepareOpen = false;
        await request("core-request", {
            id: requestId,
            goal: data.get("core-goal"),
            sourceIds: [...selected],
            tier: data.get("tier"),
            workId: targetId,
            consent: true,
            autoPrepare: auto.checked,
            expectedRevision: state.board.revision,
        });
        await load();
    });
    box.append(form);
    const jobs = coreState().jobs.filter((j) => !workId || j.workId === workId).slice(-4).reverse();
    if (jobs.length) {
        const runs = el("details", null, "proof");
        runs.open = jobs.some((j) => j.status === "blocked" || !["verified", "completed", "failed", "cancelled"].includes(j.status));
        runs.append(el("summary", `Recent owner runs (${jobs.length})`));
        for (const job of jobs) {
            const row = el("article", null, "request-row");
            row.append(statusTag(job.status), el("strong", job.goal), el("p", job.detail || "Working on your request...", "muted"));
            if (job.ownerUrl) {
                const a = el("a", job.ownerName || "Open owner thread");
                a.href = job.ownerUrl;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                row.append(a);
            }
            runs.append(row);
        }
        box.append(runs);
    }
    parent.append(box);
}
function renderBriefingCard(into) {
    const b = state.board, host = hostState(), core = coreState();
    const readiness = humanReadiness(core.readiness, host, !!b.dailyNotNowAt);
    const tasks = (b.tasks ?? []).filter((t) => t.status === "open");
    const blocked = b.evidence.filter((e) => e.status === "blocked");
    const pendingProposals = (b.improvements?.candidates ?? []).filter((c) => c.status === "proposed");
    const totalCards = state.today.cards.length + pendingProposals.length;

    const card = el("section", null, "briefing-card");
    card.setAttribute("aria-label", "Morning briefing");

    const top = el("div", null, "briefing-top");
    top.append(el("h2", host.brief?.headline || "Morning briefing", "briefing-headline"), tag(readiness.label, readiness.tone));
    card.append(top);

    if (host.brief?.lines?.length) {
        for (const line of host.brief.lines) card.append(el("p", typeof line === "string" ? line : line.text, "briefing-summary"));
    } else {
        card.append(el("p", readiness.summary, "briefing-summary"));
    }

    const pills = el("div", null, "stat-pills");
    const pillItems = [
        ["Decisions", `${totalCards} to review`],
        ["Follow-ups", `${tasks.length} open`],
        ["Connected tools", blocked.length ? `${blocked.length} need attention` : host.sources.length ? `${host.sources.length} connected` : "None yet"],
    ];
    for (const [name, value] of pillItems) {
        const pill = el("span", null, "stat-pill");
        pill.append(el("strong", name), el("span", value));
        pills.append(pill);
    }
    card.append(pills);

    const actions = el("div", null, "action-row");
    if (host.sources.length) {
        actions.append(button(
            prepareOpen ? "Hide card preparation" : "Prepare decision cards",
            () => { prepareOpen = !prepareOpen; render(); },
            totalCards === 0 ? "primary compact-btn" : "secondary compact-btn",
        ));
    } else {
        actions.append(button("Connect tools", () => { settingsOpen = true; settingsPage = "connections"; render(); }, "primary compact-btn"));
    }
    if (!host.automation) {
        actions.append(button("Set up morning brief", () => { settingsOpen = true; settingsPage = "automation"; render(); }, "secondary compact-btn"));
    }
    actions.append(button("Connected tools", () => { settingsOpen = true; settingsPage = "connections"; render(); }, "secondary compact-btn"));
    card.append(actions);

    if (prepareOpen) renderPrepareForm(card);
    into.append(card);
}
function renderToday() {
    const b = state.board, host = hostState();
    heading("Today", b.profile.title);

    const columns = el("div", null, "today-columns");
    const main = el("div", null, "today-main");
    const aside = el("aside", null, "today-aside");

    renderBriefingCard(main);

    const pending = (b.improvements?.candidates ?? []).filter((c) => c.status === "proposed");
    const totalDecisions = state.today.cards.length + pending.length;
    const decisionsPanel = panelCard("Needs your decision", { count: totalDecisions });
    if (totalDecisions > 0) {
        const stack = el("div", null, "decision-stack");
        for (const candidate of pending) stack.append(improvementCard(candidate));
        for (const c of state.today.cards) stack.append(decisionCard(c));
        decisionsPanel.append(stack);
    } else {
        const emptyInfo = todayEmptyState(state.today, host);
        const cta = emptyInfo.action === "prepare"
            ? button(emptyInfo.cta, () => openPrepareFlow(), "primary")
            : button(emptyInfo.cta, () => { settingsOpen = true; settingsPage = "connections"; render(); }, "primary");
        decisionsPanel.append(empty(emptyInfo.title, emptyInfo.detail, cta));
    }
    main.append(decisionsPanel);

    const activityItems = recentActivity(b.events, 5);
    const recentPanel = panelCard("Recent work", { count: activityItems.length });
    if (!activityItems.length) {
        recentPanel.append(empty("No recent activity yet", "Completed checks, prepared cards, and saved decisions will appear here."));
    } else {
        for (const item of activityItems) {
            const line = el("div", null, "activity-row");
            line.append(el("span", item.label), el("time", time(item.at)));
            recentPanel.append(line);
        }
    }
    main.append(recentPanel);

    const openTasks = (b.tasks ?? []).filter((t) => t.status === "open");
    const followUpsPanel = panelCard("Your follow-ups", {
        count: openTasks.length,
        action: button("Add", () => { view = "work"; render(); }, "secondary compact-btn"),
    });
    followUpsPanel.append(followUps());
    aside.append(followUpsPanel);

    const ownersPanel = panelCard("Work owners", {
        count: host.owners.length,
        action: button("Open Work", () => { view = "work"; render(); }, "secondary compact-btn"),
    });
    if (!host.owners.length) {
        ownersPanel.append(empty("No active owners yet", "Assign a workstream when you prepare decision cards so an owner keeps context warm."));
    } else {
        for (const owner of host.owners) ownersPanel.append(ownerLine(owner));
    }
    aside.append(ownersPanel);

    const schedulePanel = panelCard("Connections and schedule", {
        action: button("Manage", () => { settingsOpen = true; settingsPage = host.sources.length ? "automation" : "connections"; render(); }, "secondary compact-btn"),
    });
    const status = el("div", null, "connection-list");
    status.append(
        connectionRow("Workspace host", state.connections.host === "native-canvas" ? "Connected" : "Local preview", state.connections.host === "native-canvas" ? "verified" : ""),
        connectionRow("Connected tools", host.sources.length ? `${host.sources.length} connected` : "None yet", host.sources.length ? "verified" : ""),
        connectionRow("Morning brief", host.automation ? humanStatusLabel(host.automation.status) : "On demand", host.automation ? "verified" : ""),
    );
    if (host.remote.verifiedAt) status.append(connectionRow("Remote worker", humanStatusLabel(host.remote.status), host.remote.status));
    schedulePanel.append(status);
    aside.append(schedulePanel);

    columns.append(main, aside);
    root.append(columns);
}
function ownerLine(owner) {
    const n = el("div", null, "owner-line");
    if (owner.url) {
        const a = el("a", owner.name || "Open owner thread");
        a.href = owner.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        n.append(a);
    } else {
        n.append(el("span", owner.name || "Work owner"));
    }
    n.append(statusTag(owner.status || "ready"));
    return n;
}
function connectionRow(title, labelValue, rawTone = "") {
    const row = el("div", null, "connection-row");
    const tone = rawTone === true ? "verified" : rawTone === false ? "" : rawTone;
    row.append(el("span", title), tag(labelValue, tone));
    return row;
}
function coverageText(value) {
    return typeof value === "string"
        ? value
        : value
            ? `${value.complete === true ? "Complete" : "Partial"}: ${value.detail || "Scoped read"}`
            : "Scoped read";
}
function renderWork() {
    heading("Work", "Track ownership, source links, and next steps across your active initiatives.");
    const bar = el("div", null, "work-bar");
    const searchWrap = el("div", null, "work-toolbar");
    const search = input("search", filter, "Filter work items...");
    search.setAttribute("aria-label", "Filter work items");
    search.addEventListener("input", () => { filter = search.value; renderWorkList(); });
    searchWrap.append(search);
    bar.append(searchWrap);
    root.append(bar);

    const add = el("details", null, "add-section");
    add.append(el("summary", "Add a work item"));
    const form = el("form", null, "inline-form"), title = input("title", "", "e.g. Onboarding polish");
    title.required = true;
    form.append(label("Work title", title), label("Owner (optional)", input("owner", "", "e.g. Growth team")));
    formSubmit(form, "Add work item", (data) => command("work", Object.fromEntries(data)));
    add.append(form);
    root.append(add, el("div", null, "work-list"));
    renderWorkList();
}
function renderWorkList() {
    const list = root.querySelector(".work-list");
    list.replaceChildren();
    const items = state.board.work.filter((w) => w.title.toLowerCase().includes(filter.toLowerCase()));
    if (!items.length) {
        list.append(empty("No matching work items", "Add a work item above or clear the search filter."));
        return;
    }
    for (const w of items) {
        const card = el("article", null, "work-item"), main = el("div");
        const owner = hostState().owners.find((o) => o.workId === w.id);
        main.append(
            button(w.title, () => { workOpen = w.id; render(); }, "text-button work-title"),
            el("p", w.nextAction || "No next step noted yet", "muted"),
            el("small", `Owner: ${owner?.name || w.owner || "Unassigned"}`),
        );
        const meta = el("div", null, "work-meta");
        if (w.synthetic) meta.append(tag("Sample"));
        meta.append(statusTag(w.status));
        if (owner) meta.append(ownerLine(owner));
        card.append(main, meta);
        list.append(card);
    }
}
function sourceControls(parent, { wizard = false } = {}) {
    const inventory = hostState().inventory;
    if (!hostState().available) {
        parent.append(empty("Live tool connection unavailable here", "Open Eagle OS in a connected workspace chat, or explore using sample data."));
        return;
    }
    if (!inventory) {
        parent.append(el("p", "Checking which tools and repositories are available in this workspace...", "notice"));
        requestList(parent, "inventory");
        const existing = hostState().requests.findLast((r) => r.kind === "inventory");
        if (existing && !pendingStatuses.has(existing.status)) {
            parent.append(
                el("p", existing.detail || "Could not finish checking available tools.", "muted"),
                button("Try again", () => hostRequest("inventory", inventoryScope()), "secondary compact-btn"),
            );
        }
        queueMicrotask(() => guarded(ensureInventory));
        return;
    }
    if (inventory.status !== "verified") {
        parent.append(el("p", "Still waiting for the workspace tool list to finish loading.", "notice"));
        requestList(parent, "inventory");
        return;
    }
    const storageKey = `eagle-exclusions:${state.board.workspaceId}`;
    const saved = localStorage.getItem(storageKey);
    let excluded;
    try {
        const prior = hostState().requests.findLast((r) => r.kind === "setup" && r.scope.inventoryRequestId)?.scope;
        excluded = saved !== null ? JSON.parse(saved) : prior ? {
            tools: prior.excludedToolIds ?? inventory.tools.filter((t) => !prior.selectedToolIds.includes(t.id)).map((t) => t.id),
            repositories: prior.excludedRepoIds ?? inventory.repositories.filter((r) => !prior.selectedRepoIds.includes(r.id)).map((r) => r.id),
        } : { tools: [], repositories: [] };
        toolSelection(inventory, excluded);
    } catch {
        parent.append(
            el("p", "Your saved tool selection needs to be reset before continuing.", "notice"),
            button("Reset selection", () => { localStorage.removeItem(storageKey); render(); }, "secondary compact-btn"),
        );
        return;
    }
    const selectedCount = el("small", "", "muted");
    const grid = el("div", null, "inventory-list");
    const all = [
        ...inventory.tools.filter((t) => t.status === "available").map((t) => ({ ...t, category: "tools" })),
        ...inventory.repositories.filter((r) => r.status === "available").map((r) => ({ ...r, category: "repositories" })),
    ];
    function save() { localStorage.setItem(storageKey, JSON.stringify(excluded)); }
    function refreshRows() {
        grid.replaceChildren();
        for (const [category, title] of [["tools", "Available tools"], ["repositories", "Repositories"]]) {
            const list = all.filter((x) => x.category === category);
            if (!list.length) continue;
            const group = el("div", null, "inventory-group");
            group.append(el("h3", title));
            for (const entry of list) {
                const row = el("div", null, "inventory-row");
                row.dataset.inventoryId = entry.id;
                row.append(
                    checkbox(entry.name, !excluded[category].includes(entry.id), (checked) => {
                        excluded[category] = checked
                            ? excluded[category].filter((id) => id !== entry.id)
                            : [...new Set([...excluded[category], entry.id])];
                        save();
                        refreshRows();
                    }),
                    tag("Ready to check"),
                );
                if (entry.detail || entry.provider) row.append(el("small", entry.detail || entry.provider));
                group.append(row);
            }
            grid.append(group);
        }
        const selection = toolSelection(inventory, excluded);
        selectedCount.textContent = `${selection.selectedToolIds.length} tools and ${selection.selectedRepoIds.length} repositories selected.`;
    }

    const toolbar = el("div", null, "inventory-toolbar");
    const toolbarActions = el("div", null, "action-row");
    toolbarActions.append(
        button("Select all", () => { excluded.tools = []; excluded.repositories = []; save(); refreshRows(); }, "secondary compact-btn"),
        button("Clear", () => { excluded.tools = inventory.tools.map((t) => t.id); excluded.repositories = inventory.repositories.map((r) => r.id); save(); refreshRows(); }, "secondary compact-btn"),
        button("Refresh list", () => hostRequest("inventory", inventoryScope()), "secondary compact-btn"),
    );
    toolbar.append(selectedCount, toolbarActions);
    parent.append(toolbar, grid);
    refreshRows();

    const optional = [
        ...inventory.tools.filter((t) => t.status !== "available"),
        ...inventory.repositories.filter((r) => r.status !== "available"),
    ];
    if (optional.length) {
        const more = el("details", null, "proof");
        more.append(el("summary", `Unavailable or needs sign-in (${optional.length})`));
        for (const entry of optional) {
            const row = el("div", null, "inventory-row");
            row.append(el("strong", entry.name), statusTag(entry.status), el("p", entry.detail || "", "muted"));
            if (inventory.tools.some((t) => t.id === entry.id) && ["needs-sign-in", "missing"].includes(entry.status)) {
                row.append(button(
                    entry.status === "needs-sign-in" ? "Sign in" : "Add tool",
                    () => hostRequest("connector", { purpose: inventoryScope().purpose, sources: [], inventoryRequestId: inventory.requestId, selectedToolIds: [entry.id], selectedRepoIds: [] }),
                    "secondary compact-btn",
                ));
            }
            more.append(row);
        }
        parent.append(more);
    }

    let consent = true;
    parent.append(
        checkbox("Allow read-only checks on the selected tools and repositories (no external messages or edits).", true, (v) => { consent = v; }),
        button("Connect selected tools", async () => {
            const selection = toolSelection(inventory, excluded);
            if (!consent || !selection.selectedToolIds.length) throw Error("Keep at least one tool selected and allow the read-only check.");
            if (wizard) {
                const draft = setup.draft;
                draft.connectionMode = "connect";
                draft.sourceTypes = selection.sources;
                draft.repository = selection.repository;
                await request("command", { command: "setup_progress", payload: { step: 1, draft }, expectedRevision: state.board.revision });
                state = await request("state");
            }
            await hostRequest("setup", {
                purpose: inventoryScope().purpose,
                ...selection,
                excludedToolIds: excluded.tools.filter((id) => inventory.tools.some((t) => t.id === id)),
                excludedRepoIds: excluded.repositories.filter((r) => inventory.repositories.some((entry) => entry.id === r)),
            });
        }, "primary"),
    );
}
function requestList(parent, kind = "") {
    const requests = hostState().requests.filter((r) => !kind || r.kind === kind).slice(-5).reverse();
    const kindLabels = { inventory: "Tool discovery", setup: "Connection check", collect: "Source refresh", schedule: "Morning brief schedule", domain: "Custom tab", remote: "Worker check", connector: "Tool sign-in" };
    for (const r of requests) {
        const row = el("article", null, "request-row");
        const setupResult = r.kind === "setup" && !pendingStatuses.has(r.status);
        const outcome = setupOutcome(hostState());
        const detail = setupResult
            ? outcome.missingBindings
                ? "Check finished without saving tool records. Run the check again to finish connecting."
                : `${outcome.verified} ${outcome.verified === 1 ? "source" : "sources"} connected and ready.`
            : r.detail || "Checking now...";
        const ok = r.status === "verified" && (!setupResult || !outcome.missingBindings);
        row.append(
            tag(humanStatusLabel(r.status), ok ? "verified" : ["blocked", "needs-sign-in"].includes(r.status) ? "blocked" : statusTone(r.status)),
            el("strong", kindLabels[r.kind] || "Workspace check"),
            el("time", time(r.updatedAt || r.at)),
            el("p", detail, "muted"),
        );
        parent.append(row);
    }
}
function renderSources(destination = root) {
    heading("Connected tools", "Choose which tools and repositories Eagle can check in read-only mode.", destination);
    const controls = el("details", null, "add-section");
    controls.open = !hostState().sources.length;
    controls.append(el("summary", hostState().sources.length ? "Add or update connected tools" : "Choose tools to connect"));
    sourceControls(controls);
    destination.append(controls);

    if (hostState().sources.length) {
        const card = panelCard("Active connections", { count: hostState().sources.length });
        for (const source of hostState().sources) {
            const row = el("article", null, "source-row");
            row.append(
                el("h3", source.label),
                statusTag(source.status),
                el("p", source.detail || "Read-only connection ready.", "muted"),
                el("small", `${coverageText(source.coverage)} · Last checked: ${source.lastReadAt ? time(source.lastReadAt) : "Not yet"}`),
                button("Refresh source", () => hostRequest("collect", hostScope({ sources: [source.kind || source.type || "repository"], repository: source.repo || "" }), { sourceId: source.id }), "secondary compact-btn"),
            );
            card.append(row);
        }
        destination.append(card);
    }
    requestList(destination, "setup");
    const evidence = el("details", null, "add-section");
    evidence.append(el("summary", "Source read history"), evidenceList());
    destination.append(evidence);
}
function renderAutomation(destination = root) {
    heading("Set up your morning brief", "Start each day with fresh updates and prepared options waiting in Today.", destination);
    const guide = el("dl", null, "automation-explainer");
    for (const [name, detail] of [
        ["Why", "Save 20 minutes each morning by having recent updates and draft decisions gathered before your first meeting."],
        ["When", "Pick any weekday or daily time that fits your routine, or keep refreshing manually whenever you want."],
        ["How", "Eagle checks your connected tools in read-only mode and prepares options in Today. Nothing is ever sent without your approval."],
    ]) {
        guide.append(el("dt", name), el("dd", detail));
    }
    destination.append(guide);

    const host = hostState();
    if (host.automation) {
        const a = host.automation, row = el("section", null, "panel-card");
        row.append(
            el("div", null, "row"),
        );
        row.firstChild.append(el("h3", a.name || "Morning brief"), statusTag(a.status));
        row.append(
            el("p", `Schedule: ${a.cadence}`),
            el("small", `Last run: ${a.lastRunAt ? time(a.lastRunAt) : "Waiting for first scheduled run"} · Next: ${a.nextRunAt ? time(a.nextRunAt) : "Scheduled"}`),
        );
        destination.append(row);
    }

    const formCard = el("section", null, "panel-card");
    formCard.append(el("h3", host.automation ? "Update schedule" : "Choose your schedule"));
    const selected = sourcePicker(formCard);
    const cadence = input("cadence", host.automation?.cadence || "", "e.g. Weekdays at 8:30 AM local time");
    let consent = true, autoPrepare = true;
    const actions = el("div", null, "action-row");
    actions.append(button(host.automation ? "Update morning brief" : "Save morning brief", () => {
        if (!consent || !cadence.value.trim() || !selected.size) throw Error("Select at least one connected tool, enter a schedule time, and keep approval checked.");
        const sources = host.sources.filter((s) => selected.has(s.id));
        return hostRequest("schedule", hostScope({ cadence: cadence.value, sourceIds: [...selected], sources: [...new Set(sources.map((s) => s.type))], autoPrepare }));
    }, "primary"));
    if (!host.automation) {
        actions.append(button("Stay on demand for now", async () => {
            await command("daily_not_now", { confirmed: true });
            settingsOpen = false;
            dirty = false;
            render();
        }, "secondary"));
    }
    formCard.append(
        label("When should your brief be ready?", cadence),
        checkbox("Prepare decision cards automatically when updates arrive", true, (v) => { autoPrepare = v; }),
        checkbox("Approve this read-only schedule for the selected sources", true, (v) => { consent = v; }),
        actions,
    );
    destination.append(formCard);
    requestList(destination, "schedule");
}
function renderRemote(destination = root) {
    const remote = hostState().remote;
    heading("Optional remote worker", "Connect an existing remote machine only if you run heavy builds or UI checks.", destination);
    destination.append(
        connectionRow("Worker status", humanStatusLabel(remote.status), remote.status),
        el("p", remote.detail || "No remote worker configured.", "notice"),
    );
    if (remote.verifiedAt) destination.append(el("time", `Last checked: ${time(remote.verifiedAt)}`));
    if (remote.capabilities?.length) destination.append(el("p", `Capabilities: ${remote.capabilities.join(", ")}`));
    const worker = input("worker", "", "Worker or host name");
    let consent = false;
    destination.append(
        label("Worker name", worker),
        checkbox("Allow a read-only connection check without starting remote jobs.", false, (v) => { consent = v; }),
        button("Check worker", () => {
            if (!consent || !worker.value.trim()) throw Error("Enter a worker name and approve the read-only check.");
            return hostRequest("remote", hostScope({ worker: worker.value }));
        }, "primary"),
    );
    requestList(destination, "remote");
}
function skillPicker(selected, changed = () => {}) {
    const container = el("section"), packs = el("div", null, "pack-list"), grid = el("div", null, "skill-list");
    const installed = new Set(state.skills.installed.map((s) => s.id));
    const capabilities = new Set(state.skills.capabilities);
    const eligible = (pack) => pack.requires.every((c) => capabilities.has(c));
    const unavailable = new Set(state.skills.packs.filter((p) => !eligible(p)).flatMap((p) => p.skills));
    function refresh() {
        packs.replaceChildren();
        grid.replaceChildren();
        for (const pack of state.skills.packs) {
            const row = el("div", null, "pack-row"), enabled = eligible(pack);
            const check = checkbox(`${pack.name} (${pack.skills.length})`, pack.skills.every((id) => selected.has(id)), (checked) => {
                for (const id of pack.skills) checked ? selected.add(id) : selected.delete(id);
                changed();
                refresh();
            });
            check.querySelector("input").disabled = !enabled;
            row.append(check, el("small", enabled ? pack.description : `Requires ${pack.requires.join(", ")}.`));
            packs.append(row);
        }
        for (const skill of state.skills.available) {
            const item = el("article", null, "skill-item"), blocked = unavailable.has(skill.id);
            const check = checkbox(skill.name, selected.has(skill.id), (checked) => {
                checked ? selected.add(skill.id) : selected.delete(skill.id);
                changed();
                refresh();
            });
            check.querySelector("input").disabled = blocked;
            item.append(check, el("p", skill.description, "muted"), tag(blocked ? "Unavailable" : installed.has(skill.id) ? "Added" : "Available", installed.has(skill.id) ? "verified" : ""));
            grid.append(item);
        }
    }
    const presets = el("div", null, "quick-picks");
    presets.append(button("Select recommended PM playbooks", () => {
        selected.clear();
        for (const pack of state.skills.packs.filter((p) => state.skills.presets.pm.includes(p.id) && eligible(p))) {
            for (const id of pack.skills) selected.add(id);
        }
        changed();
        refresh();
    }, "secondary compact-btn"));
    const individual = el("details");
    individual.append(el("summary", "Browse individual playbooks"), grid);
    container.append(presets, packs, individual);
    refresh();
    return container;
}
function reportFriction(context = "", actual = "") {
    const dialog = openDialog("Share feedback"), form = el("form"), occurrence = crypto.randomUUID();
    const expected = textarea("expected"), observed = textarea("actual", actual);
    expected.required = true;
    observed.required = true;
    form.append(
        el("p", "Save a quick note when something feels slow or off. Everything stays local in this workspace.", "muted"),
        label("Category", select("category", [["missed-check", "Missed check"], ["wrong-output", "Wrong output"], ["slow-flow", "Too slow"], ["ownership", "Ownership"], ["other", "Other"]])),
        label("Area", input("workflow", context.startsWith("card:") ? "Decision review" : "Workspace")),
        label("What did you expect?", expected),
        label("What happened instead?", observed),
        label("Optional context", textarea("sourceEvidence", "", 2000)),
    );
    formSubmit(form, "Save feedback", async (data) => {
        await command("friction", { ...Object.fromEntries(data), context, occurrence });
        dialog.remove();
    });
    dialog.append(form);
}
function renderImprovements() {
    const im = state.board.improvements ?? { feedback: [], candidates: [] };
    const feedback = im.feedback.filter((f) => !f.deletedAt);
    heading("Improvements", "Capture rough edges and review playbook updates before applying them.", root, button("Share feedback", () => reportFriction(), "primary"));

    const stack = el("div", null, "view-stack");

    const patternsCard = panelCard("Recurring patterns", { count: state.improvements.patterns.length });
    if (!state.improvements.patterns.length) {
        patternsCard.append(empty("No recurring patterns yet", "Patterns appear automatically once the same type of issue comes up twice."));
    } else {
        for (const p of state.improvements.patterns) {
            const row = el("article", null, "pattern-row");
            row.append(el("h3", p.title), el("p", p.observed), el("p", p.inference, "muted"),
                button("Draft playbook update", () => proposeImprovement(p.feedbackIds), "secondary compact-btn"));
            patternsCard.append(row);
        }
    }
    stack.append(patternsCard);

    const reviewCard = panelCard("Updates to review", { count: im.candidates.length });
    if (!im.candidates.length) {
        reviewCard.append(empty("No playbook updates waiting", "Draft an update from any feedback item when you want to refine how Eagle works."));
    } else {
        const list = el("div", null, "decision-stack");
        for (const c of [...im.candidates].reverse()) list.append(improvementCard(c));
        reviewCard.append(list);
    }
    stack.append(reviewCard);

    const feedbackCard = panelCard("Saved feedback", { count: feedback.length });
    if (!feedback.length) {
        feedbackCard.append(empty("No feedback saved yet", "Use Share feedback whenever an answer or workflow needs tuning."));
    } else {
        for (const f of [...feedback].reverse()) {
            const row = el("article", null, "feedback-row");
            row.append(tag("Saved"), el("strong", f.workflow), el("time", time(f.at)), el("p", `Expected: ${f.expected}`), el("p", `Happened: ${f.actual}`));
            if (f.sourceEvidence) row.append(el("p", `Context: ${f.sourceEvidence}`, "muted"));
            const actions = el("div", null, "action-row");
            actions.append(
                button("Draft update", () => proposeImprovement([f.id]), "secondary compact-btn"),
                button("Remove", async () => {
                    if (confirm("Remove this saved feedback note?")) await command("friction_delete", { id: f.id });
                }, "text-button"),
            );
            row.append(actions);
            feedbackCard.append(row);
        }
    }
    stack.append(feedbackCard);
    root.append(stack);
}
function proposeImprovement(feedbackIds) {
    const dialog = openDialog("Draft playbook update"), form = el("form");
    let loadedBefore = null;
    const kind = select("kind", [["workspace-skill", "Workspace playbook"], ["review-only", "Other file (manual review)"]]);
    const target = input("target", "", "Playbook id or file name");
    const installed = state.skills.installed.map((s) => [s.id, s.id]);
    const pick = select("installed", [["", "Choose an installed playbook"], ...installed]);
    const before = textarea("before", "", 16000), after = textarea("after", "", 16000);
    before.rows = after.rows = 8;
    before.readOnly = true;
    kind.addEventListener("change", () => { before.readOnly = kind.value === "workspace-skill"; });
    pick.addEventListener("change", () => guarded(async () => {
        if (!pick.value) return;
        const result = await request(`skill-text?id=${encodeURIComponent(pick.value)}`);
        loadedBefore = result.content;
        target.value = pick.value;
        before.value = result.content;
        after.value = result.content;
    }));
    form.append(
        label("Title", input("title")),
        label("What happened", textarea("observed")),
        label("Likely cause (optional)", textarea("inference")),
        label("Update type", kind),
        label("Installed playbook", pick),
        label("Target", target),
        label("Current text", before),
        label("Updated text", after),
        label("How to verify the fix", textarea("scenario")),
    );
    formSubmit(form, "Create review card", async (data) => {
        const d = Object.fromEntries(data);
        const oldText = d.kind === "workspace-skill" ? loadedBefore : d.before;
        if (d.kind === "workspace-skill" && oldText === null) throw Error("Select an installed playbook first.");
        const newText = d.kind === "workspace-skill" && oldText.includes("\r\n") ? d.after.replace(/\r?\n/g, "\r\n") : d.after;
        await command("improvement_propose", {
            title: d.title,
            observed: d.observed,
            inference: d.inference,
            feedbackIds,
            confirmed: true,
            patch: { kind: d.kind, target: d.target, before: oldText, after: newText, scenario: d.scenario },
        });
        dialog.remove();
    });
    dialog.append(form);
}
function improvementCard(c) {
    const n = el("article", null, "decision-card improvement-card");
    n.append(statusTag(c.status), el("h3", c.title), el("p", c.observed));
    if (c.inference) n.append(el("p", `Note: ${c.inference}`, "muted"));
    n.append(el("small", `Target: ${c.patch.target}`));
    const preview = el("details", null, "proof");
    preview.append(
        el("summary", "View exact text change"),
        el("p", `Check: ${c.patch.scenario}`),
        el("pre", state.improvements.previews[c.id], "patch-preview"),
    );
    n.append(preview);
    const payload = { id: c.id, digest: c.digest };
    if (c.status === "proposed") {
        let reviewed = false;
        n.append(
            checkbox("I reviewed this text change and want to approve it.", false, (checked) => { reviewed = checked; }),
            button("Approve change", async () => {
                if (!reviewed || !preview.open) throw Error("Open the text change preview and check the approval box first.");
                await command("improvement_approve", { ...payload, confirmed: true });
            }, "primary"),
        );
    }
    if (["proposed", "approved"].includes(c.status)) {
        const reason = input("reason", "", "Optional note");
        n.append(
            label("Reason (optional)", reason),
            button("Save for later", () => command("improvement_defer", { ...payload, reason: reason.value }), "secondary compact-btn"),
            button("Dismiss", () => command("improvement_reject", { ...payload, reason: reason.value }), "secondary compact-btn"),
        );
    }
    if (c.status === "deferred") n.append(button("Reopen for review", () => command("improvement_reopen", payload), "secondary compact-btn"));
    if (c.status === "approved" && c.patch.kind === "workspace-skill") {
        n.append(button("Apply to workspace playbook", () => command("apply_workspace_patch", { ...payload, confirmed: true }), "primary"));
    }
    if (c.status === "approved" && c.patch.kind === "review-only") {
        const proof = input("application-evidence"), digest = input("readback-hash");
        n.append(
            label("Verification note", proof),
            label("Updated file SHA-256", digest),
            button("Mark applied", () => command("improvement_applied", { ...payload, confirmed: true, evidence: proof.value, readbackHash: digest.value }), "primary"),
        );
    }
    if (c.status === "applied") {
        const evidence = textarea("verification-evidence", "", 2000), result = select("scenario-result", [["passed", "Passed"], ["failed", "Still needs work"]]);
        let checked = false;
        n.append(
            el("p", `Check scenario: ${c.patch.scenario}`),
            label("What you observed", evidence),
            label("Outcome", result),
            checkbox("I verified the scenario.", false, (value) => { checked = value; }),
            button("Save verification", () => command("improvement_verify", { ...payload, confirmed: checked, passed: result.value === "passed", evidence: evidence.value }), "primary"),
        );
    }
    if (c.verificationAttempts?.some((v) => !v.passed)) n.append(tag("Needs another look", "blocked"));
    return n;
}
function openDialog(title) {
    const dialog = el("dialog", null, "sheet"), header = el("div", null, "sheet-header");
    header.append(el("h2", title), button("Close", () => { dialog.close(); dialog.remove(); workOpen = ""; settingsOpen = false; }, "secondary compact-btn"));
    dialog.setAttribute("aria-label", title);
    dialog.append(header);
    document.body.append(dialog);
    dialog.addEventListener("cancel", () => { workOpen = ""; settingsOpen = false; dialog.remove(); });
    dialog.showModal();
    return dialog;
}
function renderWorkBinding(parent, work) {
    const scope = hostState().selection || state.board.host?.selection;
    const sources = hostState().sources.filter((s) => s.status === "verified" && s.receipt
        && (!scope || scope.selectedToolIds.includes(s.toolId) && (s.type !== "repository" || scope.selectedRepoIds.includes(s.repoId))));
    if (!sources.length) {
        parent.append(el("p", "Connect a tool in Settings before linking source context to this work item.", "muted"));
        return;
    }
    const box = el("div", null, "add-section");
    box.append(el("h3", "Link connected source context"), el("p", "Pick the verified source notes this workstream should track.", "muted"));
    const form = el("form");
    const source = select("bind-source", [["", "Choose a connected source"], ...sources.map((s) => [s.id, s.label])], sources.length === 1 ? sources[0].id : "");
    source.required = true;
    const facts = el("div", null, "connection-list"), chosen = new Set();
    function updateFacts() {
        facts.replaceChildren();
        chosen.clear();
        const evidence = state.board.evidence.filter((e) => e.sourceId === source.value && e.status === "verified" && !e.synthetic);
        for (const e of evidence) facts.append(checkbox(e.summary, false, (checked) => checked ? chosen.add(e.id) : chosen.delete(e.id)));
        if (!evidence.length) facts.append(el("p", "No verified source notes recorded for this tool yet.", "muted"));
    }
    source.addEventListener("change", updateFacts);
    updateFacts();
    let approved = true;
    form.append(
        label("Connected source", source),
        facts,
        checkbox("Use these selected notes as context for this workstream.", true, (v) => { approved = v; }),
    );
    formSubmit(form, "Link context", async () => {
        if (!approved || !source.value || !chosen.size) throw Error("Choose a connected source and select at least one note.");
        await command("work_bind", { workId: work.id, sourceId: source.value, evidenceIds: [...chosen], confirmed: true });
    });
    box.append(form);
    parent.append(box);
}
function renderWorkDetail() {
    const w = state.board.work.find((item) => item.id === workOpen);
    if (!w) { workOpen = ""; return; }
    const dialog = openDialog(w.title), form = el("form"), owner = hostState().owners.find((o) => o.workId === w.id);
    if (owner) dialog.append(ownerLine(owner));
    if (!w.sourceId && !w.synthetic) renderWorkBinding(dialog, w);
    else if (!w.synthetic) renderPrepareForm(dialog, w.id);
    form.append(
        label("Owner", input("owner", w.owner || "")),
        label("Status", select("status", [["planned", "Planned"], ["active", "Active"], ["blocked", "Needs attention"], ["done", "Done"]], w.status)),
        label("Next step", input("nextAction", w.nextAction || "")),
    );
    formSubmit(form, "Save details", async (data) => {
        workOpen = "";
        await command("work_update", { id: w.id, ...Object.fromEntries(data) });
    });
    dialog.append(form, el("h3", "Follow-ups"), followUps(w.id));
    const add = el("form"), task = input("title", "", "e.g. Confirm launch copy");
    task.required = true;
    const date = input("dueDate");
    date.type = "date";
    add.append(label("New follow-up", task), label("Due date (optional)", date));
    formSubmit(add, "Add follow-up", (data) => command("task", { workId: w.id, ...Object.fromEntries(data) }));
    dialog.append(add, el("h3", "Source notes"), evidenceList(w.id));
}
function renderSettings() {
    const p = state.board.profile, dialog = openDialog("Workspace settings"), form = el("form");
    const tabs = el("div", null, "settings-tabs");
    for (const [id, title] of [
        ["preferences", "General"],
        ["connections", "Connected tools"],
        ["automation", "Morning brief"],
        ["skills", "Playbooks"],
        ["addons", "Add-on tabs"],
    ]) {
        const b = button(title, () => { settingsPage = id; render(); });
        b.setAttribute("aria-pressed", String(settingsPage === id));
        tabs.append(b);
    }
    dialog.append(tabs);
    if (settingsPage === "connections") { renderSources(dialog); return; }
    if (settingsPage === "automation") { renderAutomation(dialog); return; }
    if (settingsPage === "addons") { renderDomainSettings(dialog); return; }
    if (settingsPage === "skills") {
        const selected = new Set();
        dialog.append(
            el("h3", "PM playbooks"),
            el("p", "Add reusable guides to this workspace. Your global skills and existing edits stay untouched.", "muted"),
            skillPicker(selected),
        );
        const actions = el("div", null, "action-row");
        actions.append(
            button("Add selected", async () => {
                if (!selected.size) throw Error("Select at least one playbook.");
                await request("skills", { ids: [...selected], consent: true });
                await load();
            }, "primary"),
            button("Add all available", async () => {
                await request("skills", { all: true, consent: true });
                await load();
            }, "secondary"),
        );
        dialog.append(actions);
        return;
    }
    const title = input("title", p.title);
    title.required = true;
    form.append(
        label("Workspace name", title),
        el("p", "Optional model preferences for fast checks, routine preparation, and deep product work. Leave blank to inherit your workspace defaults.", "muted"),
    );
    for (const [tier, tierTitle] of [["fast", "Fast model"], ["mid", "Balanced model"], ["complex", "Deep model"]]) {
        form.append(label(tierTitle, input(tier, p.models?.[tier] || "", "Inherit default")));
    }
    formSubmit(form, "Save settings", async (data) => {
        settingsOpen = false;
        await command("intake", {
            ...p,
            title: data.get("title"),
            models: Object.fromEntries(["fast", "mid", "complex"].map((k) => [k, data.get(k)])),
        });
    });
    dialog.append(form);
}
function renderDomainSettings(destination) {
    destination.append(
        el("h3", "Create a custom PM tab"),
        el("p", "Describe a view that helps with a recurring job, like release readiness or experiment tracking. You preview and approve the layout before it is added.", "muted"),
    );
    const form = el("form"), goal = textarea("domain-goal", "", 1000);
    goal.required = true;
    goal.placeholder = "e.g. Track active experiments with hypothesis, status, and target readout date";
    const selected = sourcePicker(form);
    form.append(label("What should this tab help you track?", goal));
    formSubmit(form, "Draft custom tab", async (data) => {
        if (!selected.size) throw Error("Select at least one connected source for this tab.");
        const sourceTypes = [...new Set(hostState().sources.filter((s) => selected.has(s.id)).map((s) => s.type))];
        settingsOpen = false;
        dirty = false;
        await hostRequest("domain", hostScope({ domainPurpose: data.get("domain-goal"), sourceIds: [...selected], sources: sourceTypes }));
    });
    destination.append(form);
    for (const item of state.views?.active ?? []) {
        const row = el("div", null, "request-row");
        row.append(
            el("strong", item.manifest.title),
            statusTag(item.hiddenAt ? "deferred" : item.availability || "ready"),
            button(item.hiddenAt ? "Restore tab" : "Hide tab", () => command(item.hiddenAt ? "view_restore" : "view_remove",
                { id: item.manifest.id, fingerprint: item.fingerprint, confirmed: true }), "secondary compact-btn"),
        );
        destination.append(row);
    }
    const remote = el("details", null, "add-section");
    remote.append(el("summary", "Optional remote worker"));
    renderRemote(remote);
    destination.append(remote);
}
function renderDomainProposal(proposal) {
    const panel = el("article", null, "panel-card"), preview = el("details", null, "proof");
    panel.append(tag("Proposed custom tab", "warn"), el("h3", proposal.title), el("p", proposal.why));
    preview.append(
        el("summary", "Preview tab fields and layout"),
        el("pre", JSON.stringify(proposal.manifest, null, 2), "patch-preview"),
    );
    let reviewed = false;
    const actions = el("div", null, "action-row");
    actions.append(
        button("Add tab", () => {
            if (!reviewed || !preview.open) throw Error("Open the layout preview and check the confirmation box first.");
            return command("view_approve", { id: proposal.id, fingerprint: proposal.fingerprint, confirmed: true });
        }, "primary"),
        button("Dismiss", () => command("view_reject", { id: proposal.id, fingerprint: proposal.fingerprint, confirmed: true }), "secondary"),
    );
    panel.append(
        preview,
        checkbox("I reviewed this tab layout and its connected sources.", false, (v) => { reviewed = v; }),
        actions,
    );
    return panel;
}
function renderDomainView(id) {
    const domain = state.views?.active.find((v) => v.manifest.id === id && !v.hiddenAt);
    if (!domain) { view = "work"; renderWork(); return; }
    heading(domain.manifest.title, domain.manifest.description);
    if (domain.availability === "blocked") {
        root.append(panelCard(domain.manifest.title), empty("This tab needs attention", domain.detail));
        return;
    }
    const rows = domainRows(state, domain), fields = domain.manifest.fields;
    if (!rows.length) {
        const card = panelCard(domain.manifest.title, { count: 0 });
        card.append(empty("No items recorded yet", "Refresh your connected sources to populate this tab."));
        root.append(card);
        return;
    }
    const valueNode = (row, field) => {
        const value = row[field.key];
        if (value === null || value === undefined || value === "") return el("span", "Not set", "muted");
        if (field.type === "url") {
            try {
                const u = new URL(value);
                if (u.protocol !== "https:" || u.username || u.password) return el("span", "Invalid link", "muted");
            } catch {
                return el("span", "Invalid link", "muted");
            }
            const a = el("a", "Open source");
            a.href = value;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            return a;
        }
        return el("span", String(value));
    };
    if (domain.manifest.renderer === "table") {
        const wrap = el("div", null, "domain-table-wrap"), table = el("table", null, "domain-table"), head = el("tr");
        for (const f of fields) head.append(el("th", f.label));
        const thead = el("thead");
        thead.append(head);
        table.append(thead);
        const body = el("tbody");
        for (const row of rows) {
            const tr = el("tr");
            for (const f of fields) {
                const td = el("td");
                td.append(valueNode(row, f));
                tr.append(td);
            }
            body.append(tr);
        }
        table.append(body);
        wrap.append(table);
        root.append(wrap);
    } else {
        const sorted = [...rows];
        if (domain.manifest.renderer === "timeline") sorted.sort((a, b) => {
            const x = Date.parse(a[domain.manifest.groupBy]), y = Date.parse(b[domain.manifest.groupBy]);
            return (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y) ? y : Infinity);
        });
        const articleFor = (row) => {
            const article = el("article", null, "timeline-entry");
            for (const f of fields) {
                const line = el("p");
                line.append(el("strong", `${f.label}: `), valueNode(row, f));
                article.append(line);
            }
            return article;
        };
        if (domain.manifest.renderer === "board") {
            const groups = new Map(), board = el("div", null, "domain-board");
            for (const row of sorted) {
                const key = String(row[domain.manifest.groupBy] ?? "Other");
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(row);
            }
            for (const [name, group] of groups) {
                const column = el("section");
                column.append(el("h2", name));
                for (const row of group) column.append(articleFor(row));
                board.append(column);
            }
            root.append(board);
        } else {
            const card = panelCard(domain.manifest.title, { count: sorted.length });
            for (const row of sorted) {
                const article = articleFor(row);
                if (domain.manifest.groupBy) article.prepend(tag(String(row[domain.manifest.groupBy] ?? "Item")));
                card.append(article);
            }
            root.append(card);
        }
    }
}
async function moveSetup(step) {
    setup.step = step;
    await command("setup_progress", { step, draft: setup.draft });
    root.querySelector("h1")?.focus();
}
function renderWizard() {
    document.querySelector("#tabs").hidden = true;
    document.querySelector("#preferences").hidden = true;

    const steps = el("ol", null, "setup-progress");
    for (const [index, step] of setupSteps.entries()) {
        const n = el("li", null, index < setup.step ? "done" : "");
        n.append(el("span", index < setup.step ? "✓" : String(index + 1), "step-dot"), el("span", step.label));
        if (index === setup.step) n.setAttribute("aria-current", "step");
        steps.append(n);
    }
    root.append(steps);

    const step = setupSteps[setup.step];
    const shell = el("section", null, "setup-surface");
    const title = el("h1", step.title);
    title.tabIndex = -1;
    shell.append(title, el("p", step.help, "setup-lead"));

    const d = setup.draft;
    if (setup.step === 0) {
        shell.append(el("label", "What do you want help staying on top of? (Pick up to 3)"));
        const choices = ["Feature launches", "Product decisions", "Team follow-ups", "Experiment readouts"];
        const chips = el("div", null, "quick-picks");
        for (const value of choices) {
            const b = button(value, () => {
                if (d.jobs.includes(value)) d.jobs = d.jobs.filter((v) => v !== value);
                else if (d.jobs.length < 3) d.jobs.push(value);
                render();
            }, "choice-chip");
            b.setAttribute("aria-pressed", String(d.jobs.includes(value)));
            chips.append(b);
        }
        const fields = el("div", null, "setup-fields");
        const name = input("workspace-title", d.title, "e.g. Core Product");
        name.addEventListener("input", () => { d.title = name.value; });
        const decisions = input("daily-choice", d.decisions, "e.g. Unblock specs, triage open decisions, and prep replies");
        decisions.addEventListener("input", () => { d.decisions = decisions.value; });
        const preset = select("preset", [["feature-pm", "Feature PM"], ["experiment-metrics", "Growth & Experimentation"]], d.preset);
        preset.addEventListener("change", () => { d.preset = preset.value; });
        fields.append(
            label("Workspace name", name),
            label("What would save you the most time each morning?", decisions),
            label("Role focus", preset),
        );
        shell.append(chips, fields);
    } else if (setup.step === 1) {
        if (!d.connectionMode) d.connectionMode = hostState().available ? "connect" : "manual";
        const modes = el("div", null, "connection-picks");
        for (const [id, modeTitle, detail] of [
            ["connect", "Connect my tools", "Let Eagle read selected tools and repositories so updates come to one calm place."],
            ["manual", "Explore with sample data", "Preview Today with one sample decision card first. You can connect real tools anytime."],
        ]) {
            const b = button("", () => { d.connectionMode = id; dirty = false; render(); }, "connection-choice");
            b.setAttribute("aria-pressed", String(d.connectionMode === id));
            b.append(el("strong", modeTitle), el("span", detail));
            modes.append(b);
        }
        shell.append(modes);
        if (d.connectionMode !== "manual") {
            sourceControls(shell, { wizard: true });
            requestList(shell, "setup");
        } else {
            shell.append(el("p", "Sample mode creates one clearly labelled example item so you can try Today right away without connecting accounts.", "notice"));
        }
    } else if (setup.step === 2) {
        const selection = new Set(d.skills);
        const skills = skillPicker(selection, () => { d.skills = [...selection]; });
        shell.append(skills);
    } else if (d.connectionMode === "manual") {
        if (setup.exampleReviewed === undefined) setup.exampleReviewed = true;
        shell.append(
            tag("Sample workspace"),
            el("div", "Sample card: Should we ship the onboarding update now or run one more usability check?", "example-preview"),
            checkbox("Start with this sample card in Today so I can explore how decisions work.", setup.exampleReviewed, (checked) => { setup.exampleReviewed = checked; }),
            el("small", "You can connect your real tools anytime from Today or Settings."),
        );
    } else {
        const outcome = setupOutcome(hostState());
        if (outcome.sources.length || outcome.blockedSources.length) {
            const breakdown = el("section", null, "setup-connections");
            for (const s of outcome.sources) {
                breakdown.append(connectionRow(s.label, s.status === "verified" ? "Connected" : humanStatusLabel(s.status), s.status === "verified" && !!s.receipt));
            }
            for (const s of outcome.blockedSources) {
                breakdown.append(connectionRow(s.name || s.label || s.toolId, humanStatusLabel(s.status || "blocked"), "blocked"));
            }
            shell.append(breakdown);
        } else {
            shell.append(el("p", outcome.missingBindings
                ? "The check finished without saving your tool list. Click Check again below so Today has your connected sources."
                : "Checking your selected tools now...", "notice"));
        }
        if (outcome.terminal && (!outcome.sources.length || outcome.blockedSources.length)) {
            shell.append(button("Check again", () => rerunConnectionCheck(), "secondary compact-btn"));
        }
        shell.append(el("p", "Once you open Today, you can prepare decision cards on demand or schedule a morning brief.", "muted"));
    }

    const controls = el("div", null, "setup-controls");
    if (setup.step > 0) controls.append(button("Back", () => moveSetup(setup.step - 1), "secondary"));
    const right = el("div", null, "setup-controls-right");
    right.append(button(
        setup.step === 3 ? "Open Today" : setup.step === 2 ? "Continue" : "Next",
        async (b) => {
            b.disabled = true;
            try {
                if (setup.step === 0 && (!d.jobs.length || !d.title.trim() || !d.decisions.trim())) {
                    throw Error("Pick at least one focus area, name your workspace, and add a short morning goal.");
                }
                if (setup.step === 1 && !d.connectionMode) {
                    throw Error("Choose Connect my tools or Explore with sample data.");
                }
                if (setup.step === 1 && d.connectionMode === "connect" && !hostState().requests.some((r) => r.kind === "setup")) {
                    throw Error("Click Connect selected tools first, or switch to Explore with sample data.");
                }
                if (setup.step === 2 && d.skills.length) {
                    await request("skills", { ids: d.skills, consent: true });
                }
                if (setup.step < 3) {
                    await moveSetup(setup.step + 1);
                } else {
                    if (d.connectionMode === "manual" && !setup.exampleReviewed) {
                        throw Error("Keep the sample card box checked so Today has an example to show you.");
                    }
                    await request("command", {
                        command: d.connectionMode === "manual" ? "onboard_complete" : "intake",
                        expectedRevision: state.board.revision,
                        payload: { role: "pm", title: d.title, preset: d.preset, jobs: d.jobs, decisions: [d.decisions], sources: [], exampleReviewed: true },
                    });
                    setup = null;
                    view = "today";
                    dirty = false;
                    await load();
                }
            } finally {
                b.disabled = false;
            }
        },
        "primary",
    ));
    controls.append(right);
    shell.append(controls);
    root.append(shell);
}
function render() {
    for (const dialog of document.querySelectorAll("dialog")) dialog.remove();
    root.replaceChildren();
    document.querySelector("#workspace-title").textContent = state.board.profile?.title || "Your workspace";
    const host = hostState();
    const at = host.brief?.at || host.sources.map((s) => s.lastReadAt).filter(Boolean).sort().at(-1);
    document.querySelector("#freshness").textContent = at ? `Updated ${time(at)}` : host.available ? "Ready to check" : "Local preview";
    if (setup) {
        renderWizard();
        return;
    }
    document.querySelector("#tabs").hidden = false;
    document.querySelector("#preferences").hidden = false;
    const tabs = document.querySelector("#tabs");
    tabs.replaceChildren();
    for (const item of navigationViews(state)) {
        const n = button(item.title, () => {
            if (dirty && !confirm("Leave unsaved changes on this tab?")) return;
            dirty = false;
            view = item.id;
            render();
        });
        n.dataset.view = item.id;
        n.setAttribute("aria-current", item.id === view ? "page" : "false");
        tabs.append(n);
    }
    if (view.startsWith("addon:")) renderDomainView(view.slice(6));
    else ({ today: renderToday, work: renderWork, improvements: renderImprovements })[view]();
    for (const proposal of (state.views?.proposals ?? []).filter((p) => p.status === "proposed")) {
        root.append(renderDomainProposal(proposal));
    }
    if (workOpen) renderWorkDetail();
    if (settingsOpen) renderSettings();
}
document.querySelector("#refresh").addEventListener("click", () => guarded(async () => {
    if (dirty && root.querySelector("form") && !confirm("Refreshing will discard unsaved text. Continue?")) return;
    dirty = false;
    await load();
}));
document.querySelector("#preferences").addEventListener("click", () => { settingsOpen = true; render(); });
document.querySelector("#report-error").addEventListener("click", () => reportFriction("error", error.textContent));
document.addEventListener("input", (event) => {
    if (event.target.id !== "theme" && event.target.name !== "search") dirty = true;
});
setInterval(() => {
    if (!state) return;
    const pending = hostState().requests.some((r) => pendingStatuses.has(r.status))
        || coreState().jobs.some((j) => !["verified", "blocked", "failed", "cancelled", "completed"].includes(j.status));
    const protectedDialog = !!document.querySelector("dialog") && !(settingsOpen && ["connections", "automation"].includes(settingsPage));
    if (canRefresh({ dirty, pending, dialogOpen: protectedDialog, editing: document.activeElement?.matches("input,textarea,select"), wizardStep: setup?.step })) {
        guarded(load);
    }
}, 3000);
const theme = document.querySelector("#theme");
let savedTheme = "system";
try { savedTheme = localStorage.getItem("eagle-theme") || "system"; } catch { /* Optional display preference only. */ }
theme.value = savedTheme;
document.documentElement.dataset.theme = savedTheme;
theme.addEventListener("change", () => {
    document.documentElement.dataset.theme = theme.value;
    try { localStorage.setItem("eagle-theme", theme.value); } catch { /* Theme still applies without persistence. */ }
});
guarded(load);

