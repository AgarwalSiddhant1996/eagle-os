export function clearError(error, report) {
    error.hidden = true;
    report.hidden = true;
    error.textContent = "";
}
export function showError(error, report, message) {
    error.textContent = `${message} Your unsaved input is still here.`;
    error.hidden = false;
    report.hidden = false;
    error.focus();
}
export function canRefresh({ dirty, dialogOpen, editing, wizardStep, pending }) {
    return pending && !dirty && !dialogOpen && !editing && (wizardStep === undefined || wizardStep === 1 || wizardStep === 3);
}
export const setupSteps = Object.freeze([
    { id: "purpose", title: "Set up your PM workspace", label: "Focus", help: "Pick the recurring work you own so your morning brief highlights only the decisions that need you." },
    { id: "connections", title: "Connected tools", label: "Connected tools", help: "Choose which available tools and repositories Eagle can check in read-only mode to save you from chasing status across tabs." },
    { id: "skills", title: "Add PM playbooks", label: "Playbooks", help: "Select reusable guides for specs, research, metrics, and replies. You can change these anytime in Settings." },
    { id: "review", title: "Your workspace is ready", label: "Ready", help: "Check your connected tools below, then open Today to prepare decision cards or set up your morning brief." },
]);

const statusLabels = Object.freeze({
    verified: "Verified",
    partial: "Partial",
    blocked: "Needs attention",
    "needs-sign-in": "Sign in needed",
    missing: "Not installed",
    unknown: "Unchecked",
    unverified: "Unchecked",
    queued: "Queued",
    running: "In progress",
    "owner-ready": "In progress",
    assigned: "In progress",
    routing: "In progress",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    enabled: "Scheduled",
    configured: "Scheduled",
    planned: "Planned",
    active: "Active",
    done: "Done",
    proposed: "For review",
    approved: "Approved",
    applied: "Applied",
    deferred: "Saved for later",
    ready: "Ready",
    "workspace-ready": "Ready",
    "on-demand-ready": "Ready",
    "daily-configured": "Morning brief scheduled",
    "daily-verified": "Morning brief active",
});

export function humanStatusLabel(status) {
    if (!status || typeof status !== "string") return "Unchecked";
    if (statusLabels[status]) return statusLabels[status];
    const cleaned = status.replace(/[-_]+/g, " ").trim();
    return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : "Unchecked";
}

export function humanReadiness(readiness = {}, host = {}, dailyDismissed = false) {
    const status = readiness?.status || "workspace-ready";
    const sources = host?.sources ?? [];
    const verifiedSources = sources.filter((s) => s.status === "verified" && s.receipt).length;
    if (status === "daily-verified") {
        return { label: "Morning brief active", tone: "verified", summary: "Scheduled morning updates and workstream preparation are running." };
    }
    if (status === "daily-configured" || host?.automation?.status === "enabled") {
        return { label: "Morning brief scheduled", tone: "verified", summary: `Scheduled for ${host?.automation?.cadence || "your saved cadence"}. Eagle will prepare updates from your connected tools.` };
    }
    if (status === "blocked") {
        return { label: "Needs attention", tone: "blocked", summary: readiness?.detail || "One check needs your attention before continuing." };
    }
    if (status === "on-demand-ready") {
        return {
            label: dailyDismissed ? "Ready" : "Needs daily setup",
            tone: "verified",
            summary: dailyDismissed
                ? `${verifiedSources || sources.length} connected ${verifiedSources === 1 ? "source is" : "sources are"} ready whenever you refresh.`
                : "Workstream prep is ready. Set up your morning brief when you want automatic daily updates.",
        };
    }
    if (verifiedSources > 0) {
        return {
            label: dailyDismissed ? "Ready" : "Needs daily setup",
            tone: "verified",
            summary: `${verifiedSources} connected ${verifiedSources === 1 ? "tool is" : "tools are"} ready. Prepare decision cards now or set up your morning brief.`,
        };
    }
    if (sources.length > 0) {
        return { label: "Checking tools", tone: "", summary: "Finish checking your connected tools so Eagle can pull updates into Today." };
    }
    return { label: "Ready to connect", tone: "", summary: "Connect your tools once so Eagle can gather updates into a calm morning brief." };
}

export function todayEmptyState(today = {}, host = {}) {
    const sources = host?.sources ?? [];
    const verifiedSources = sources.filter((s) => s.status === "verified").length;
    if (today.code === "blocked") {
        return {
            title: "A connected source needs attention",
            detail: "Review your connected tools to clear the blocked check and refresh Today.",
            action: "connections",
            cta: "Check connected tools",
        };
    }
    if (sources.length > 0 && (today.code === "pending" || verifiedSources > 0)) {
        return {
            title: "Ready to prepare decision cards",
            detail: `${sources.length} ${sources.length === 1 ? "source is" : "sources are"} connected with 0 open cards. Pick a workstream to turn recent updates into clear options.`,
            action: "prepare",
            cta: "Prepare decision cards",
        };
    }
    if (sources.length > 0) {
        return {
            title: "Finish connecting your tools",
            detail: "Complete the read check on your selected tools so Eagle can prepare decision cards.",
            action: "connections",
            cta: "Review connected tools",
        };
    }
    return {
        title: "No decision cards yet",
        detail: "Connect your tools so Eagle can check recent activity and prepare options for your review.",
        action: "connections",
        cta: "Connect tools",
    };
}

const hiddenActivityCommands = new Set([
    "setup_progress",
    "host_inventory",
    "core_dispatch",
    "core_event",
    "core_deltas",
    "core_delta_status",
]);

const activityLabels = Object.freeze({
    onboard_complete: "Sample workspace ready",
    intake: "Preferences updated",
    work: "Work item added",
    work_bind: "Source context linked",
    work_update: "Work details updated",
    evidence: "Evidence recorded",
    card: "Decision card prepared",
    resolve: "Decision recorded",
    task: "Follow-up added",
    task_update: "Follow-up updated",
    daily_not_now: "On-demand refresh selected",
    host_request: "Tool check started",
    host_callback: "Connected tools updated",
    core_enqueue: "Work assigned to owner",
    core_result: "Owner finished preparation",
    friction: "Feedback saved",
    friction_delete: "Feedback removed",
    improvement_propose: "Playbook change proposed",
    improvement_approve: "Playbook change approved",
    improvement_defer: "Playbook change saved for later",
    improvement_reject: "Playbook change dismissed",
    improvement_reopen: "Playbook change reopened",
    apply_workspace_patch: "Playbook updated",
    improvement_applied: "Manual update recorded",
    improvement_verify: "Playbook check recorded",
    view_approve: "Custom tab added",
    view_remove: "Custom tab hidden",
    view_restore: "Custom tab restored",
    view_reject: "Custom tab dismissed",
});

export function recentActivity(events = [], limit = 5) {
    const seen = new Set();
    const rows = [];
    for (let i = events.length - 1; i >= 0 && rows.length < limit; i--) {
        const event = events[i];
        if (!event || hiddenActivityCommands.has(event.command)) continue;
        const label = activityLabels[event.command] || "Workspace updated";
        if (seen.has(label)) continue;
        seen.add(label);
        rows.push({ label, at: event.at, command: event.command });
    }
    return rows;
}
export function setupOutcome(host) {
    const latest = (host.requests ?? []).findLast((r) => r.kind === "setup");
    const sources = host.sources ?? [];
    const terminal = latest && !["queued", "running"].includes(latest.status);
    return { latest, terminal: !!terminal, sources,
        verified: sources.filter((s) => s.status === "verified" && s.receipt).length,
        missingBindings: !!terminal && sources.length === 0 && ["verified", "partial", "completed"].includes(latest.status),
        blockedSources: latest?.blockedSources ?? [] };
}
export function routingWorkstreams(board, sourceIds) {
    const allowed = new Set(sourceIds);
    return board.work.filter((w) => !w.synthetic && allowed.has(w.sourceId));
}
export function toolSelection(inventory, excluded = { tools: [], repositories: [] }) {
    if (!Array.isArray(excluded.tools) || !Array.isArray(excluded.repositories)
        || [...excluded.tools, ...excluded.repositories].some((id) => typeof id !== "string")) throw Error("Saved tool exclusions are invalid. Review or reset this workspace selection.");
    const tools = inventory.tools.filter((t) => t.status === "available" && !excluded.tools.includes(t.id));
    const repositories = inventory.repositories.filter((r) => r.status === "available" && !excluded.repositories.includes(r.id));
    return {
        inventoryRequestId: inventory.requestId,
        selectedToolIds: [...new Set(tools.map((t) => t.id))],
        selectedRepoIds: [...new Set(repositories.map((r) => r.id))],
        sources: [...new Set(tools.flatMap((t) => t.sourceTypes))],
        repository: repositories.length === 1 ? repositories[0].name : "",
    };
}
