import { mkdir, readFile, writeFile, rename, open, unlink, realpath } from "node:fs/promises";
import { join, resolve, relative, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { emptyImprovements, applyImprovementCommand, applyWorkspacePatch } from "./improvements.mjs";
import { emptyHost, applyHostCommand, sourceTypes } from "./host.mjs";
import { emptyCore, applyCoreCommand, bindUserWorkContext, approvedContextEvidence } from "./orchestration.mjs";
import { applyDomainCommand } from "./domain-views.mjs";

const codeRoot = fileURLToPath(new URL("../", import.meta.url));
export const defaultDataRoot = () => join(homedir(), ".copilot", "eagle-os-data");
export class InputError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
export const workspaceId = (value) => {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(value)) throw new InputError("Use a short lowercase workspace id.");
    return value;
};
export const text = (value, label, max = 500) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new InputError(`${label} is required and must be at most ${max} characters.`);
    return value.trim();
};
export function safeLink(value) {
    if (!value) return "";
    let url;
    try { url = new URL(value); } catch { throw new InputError("Evidence link must be an absolute secure URL."); }
    if (url.protocol !== "https:" || url.username || url.password || /[?&](?:token|sig|auth|code)=/i.test(value)) throw new InputError("Evidence links cannot contain credentials or insecure schemes.");
    return url.href;
}
function stringList(value, label) {
    if (!Array.isArray(value) || !value.length || value.length > 3) throw new InputError(`Choose one to three ${label}.`);
    return value.map((v) => text(v, label, 200));
}
export function credentialFree(value, depth = 0) {
    if (depth > 20) throw new InputError("Workspace data is nested too deeply.");
    if (!value || typeof value !== "object") return;
    for (const [key, field] of Object.entries(value)) {
        if (/^(?:.*token|password|secret|clientsecret|apikey|privatekey|authorization|cookie|credentials)$/i.test(key.replace(/[_-]/g, ""))) throw new InputError("Store credentials in your supported credential facility, not workspace JSON.");
        if (typeof field === "string" && /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{20,})/.test(field)) throw new InputError("Credentials cannot be stored in workspace text.");
        credentialFree(field, depth + 1);
    }
}
export function blankBoard(id) {
    return { schemaVersion: 1, workspaceId: id, revision: 0, profile: null, work: [], evidence: [], cards: [], tasks: [], onboarding: null, host: emptyHost(), core: emptyCore(), improvements: emptyImprovements(), events: [] };
}
const pmPresets = ["feature-pm", "experiment-metrics"];
export function normalizeSavedBoard(board) {
    const b = structuredClone(board);
    if (b.profile && b.profile.profileVersion !== 2) {
        b.profile.role = "pm";
        if (!pmPresets.includes(b.profile.preset)) b.profile.preset = "feature-pm";
        b.profile.profileVersion = 2;
    }
    if (b.onboarding && b.onboarding.flowVersion !== 2) {
        if (Number.isInteger(b.onboarding.step) && b.onboarding.step >= 0 && b.onboarding.step <= 4) {
            b.onboarding.step = [0, 0, 1, 2, 3][b.onboarding.step];
        }
        if (b.onboarding.draft) {
            b.onboarding.draft.role = "pm";
            if (b.onboarding.draft.preset !== undefined && !pmPresets.includes(b.onboarding.draft.preset)) b.onboarding.draft.preset = "feature-pm";
        }
        b.onboarding.flowVersion = 2;
    }
    return b;
}
export function applyCommand(board, command, payload, now = new Date().toISOString()) {
    const b = normalizeSavedBoard(board);
    b.tasks ??= [];
    credentialFree(payload);
    if (command.startsWith("core_")) {
        if (applyCoreCommand(b, command, payload, now) === false) return board;
    } else if (command.startsWith("view_")) {
        applyDomainCommand(b, command, payload, now);
    } else if (command.startsWith("host_")) {
        if (applyHostCommand(b, command, payload, now) === false) return board;
    } else if (command === "friction" || command === "friction_delete" || command.startsWith("improvement_")) {
        applyImprovementCommand(b, command, payload, now);
    } else if (command === "daily_not_now") {
        if (payload.confirmed !== true || Object.keys(payload).some((k) => k !== "confirmed")) throw new InputError("Confirm the on-demand choice.");
        if (b.host?.automation) throw new InputError("An existing schedule must be managed explicitly; Not now cannot alter it.", 409);
        b.core ??= emptyCore();
        b.core.dailyChoice = { status: "not-now", at: now, detail: "User explicitly chose on-demand mode. No schedule created." };
    } else if (command === "setup_progress") {
        if (Object.keys(payload).some((key) => !["step", "draft"].includes(key))) throw new InputError("Setup flow version is internal metadata; supply only step and draft.");
        if (!Number.isInteger(payload.step) || payload.step < 0 || payload.step > 3) throw new InputError("Choose a valid four-step setup index (0..3).");
        const draft = payload.draft ?? {};
        const allowed = ["role", "title", "preset", "jobs", "decisions", "skills", "connectionMode", "sourceTypes", "repository"];
        if (Object.keys(draft).some((k) => !allowed.includes(k))) throw new InputError("Setup draft contains an unsupported field.");
        if (JSON.stringify(draft).length > 5000) throw new InputError("Setup draft is too large.");
        credentialFree(draft);
        for (const key of ["role", "title", "preset", "decisions"]) if (draft[key] !== undefined && (typeof draft[key] !== "string" || draft[key].length > 500)) throw new InputError("Setup values must be short text.");
        if (draft.role !== undefined && draft.role !== "pm") throw new InputError("Only PM onboarding is supported.");
        if (draft.preset !== undefined && !pmPresets.includes(draft.preset)) throw new InputError("Choose a supported PM preset.");
        for (const key of ["jobs", "skills"]) if (draft[key] !== undefined && (!Array.isArray(draft[key]) || draft[key].length > (key === "jobs" ? 3 : 80) || draft[key].some((v) => typeof v !== "string" || v.length > 200))) throw new InputError("Setup selections must be short lists.");
        if (draft.connectionMode !== undefined && !["", "connect", "manual"].includes(draft.connectionMode)) throw new InputError("Choose a supported connection mode.");
        if (draft.sourceTypes !== undefined && (!Array.isArray(draft.sourceTypes) || draft.sourceTypes.length > 5 || draft.sourceTypes.some((s) => !sourceTypes.includes(s)))) throw new InputError("Choose supported source types.");
        if (draft.repository !== undefined && (typeof draft.repository !== "string" || draft.repository.length > 200)) throw new InputError("Repository must be a short user-local hint.");
        b.onboarding = { step: payload.step, draft, flowVersion: 2, updatedAt: now };
    } else if (command === "intake" || command === "onboard_complete") {
        if (!pmPresets.includes(payload.preset)) throw new InputError("Choose a supported PM preset.");
        const sources = payload.sources ?? [];
        if (!Array.isArray(sources) || sources.length > 20) throw new InputError("Choose at most twenty optional sources.");
        const ids = new Set();
        const normalized = sources.map((s) => {
            const id = workspaceId(s.id);
            if (ids.has(id)) throw new InputError("Source ids must be unique.");
            ids.add(id); credentialFree(s.settings);
            if (!Array.isArray(s.capabilities) || s.capabilities.some((c) => !["read", "files"].includes(c))) throw new InputError("v1 supports optional read/file capabilities only.");
            return { id, label: text(s.label, "Source label", 80), capabilities: s.capabilities,
                status: "unverified", settings: s.settings ?? {}, module: "", readApproved: false };
        });
        const previous = b.profile;
        const models = payload.models ?? previous?.models ?? {};
        if (Object.values(models).some((m) => typeof m !== "string" || m.length > 100)) throw new InputError("Model selections must be short identifiers or empty.");
        if (payload.role !== undefined && payload.role !== "pm") throw new InputError("Only PM onboarding is supported.");
        b.profile = { title: text(payload.title, "Workspace title", 80), preset: payload.preset, role: "pm", profileVersion: 2,
            jobs: stringList(payload.jobs, "recurring jobs"), decisions: stringList(payload.decisions, "daily decisions"),
            sources: normalized.map((s) => ({ ...s, ...(previous?.sources.find((p) => p.id === s.id) ?? {}), label: s.label, settings: s.settings,
                capabilities: s.capabilities, status: "unverified", readApproved: false })),
            models: { fast: models.fast ?? "", mid: models.mid ?? "", complex: models.complex ?? "" },
            projectId: payload.projectId ? text(payload.projectId, "Project id", 100) : previous?.projectId ?? "",
            updatedAt: now };
        if (command === "onboard_complete") {
            if (payload.exampleReviewed !== true) throw new InputError("Review and acknowledge the synthetic example before finishing setup.");
            if (!b.cards.some((c) => c.key === "onboarding-example")) {
                const workId = randomUUID(), evidenceId = randomUUID();
                b.work.push({ id: workId, title: "Example: prepare a review", status: "active", owner: "You", nextAction: "Choose the review path", synthetic: true, createdAt: now });
                b.evidence.push({ id: evidenceId, workId, sourceId: "manual", summary: "Synthetic example: two review paths are available. No external source was read.",
                    status: "verified", verificationMethod: "User acknowledged the labelled synthetic example", synthetic: true, url: "", recordedAt: now });
                b.cards.push({ id: randomUUID(), key: "onboarding-example", workId, evidenceId,
                    title: "Try your first decision", why: "Example only: choose how to review a proposed change.",
                    options: ["Review the evidence now", "Ask for more context"], recommendedIndex: 0,
                    afterDecision: "Save this example choice locally. Nothing is sent.", status: "open", synthetic: true, createdAt: now });
                b.tasks.push({ id: randomUUID(), workId, title: "Replace this example with your own work when ready", dueDate: "", status: "open", synthetic: true, createdAt: now });
            }
            b.onboarding = { complete: true, completedAt: now, step: 3, flowVersion: 2 };
        }
    } else if (command === "work") {
        b.work.push({ id: randomUUID(), title: text(payload.title, "Work title", 200), status: "planned",
            owner: payload.owner ? text(payload.owner, "Owner", 100) : "", origin: "user", nextAction: "", createdAt: now });
    } else if (command === "work_bind") {
        if (bindUserWorkContext(b, payload, now) === false) return board;
    } else if (command === "work_update") {
        const item = b.work.find((w) => w.id === payload.id);
        if (!item) throw new InputError("Choose an existing work item.");
        if (!["planned", "active", "blocked", "done"].includes(payload.status)) throw new InputError("Choose a supported work state.");
        item.status = payload.status;
        item.owner = payload.owner ? text(payload.owner, "Owner", 100) : "";
        item.nextAction = payload.nextAction ? text(payload.nextAction, "Next action", 300) : "";
        item.updatedAt = now;
    } else if (command === "task") {
        if (!b.work.some((w) => w.id === payload.workId)) throw new InputError("Choose an existing work item.");
        const dueDate = payload.dueDate ?? "";
        if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(`${dueDate}T12:00:00Z`)) || new Date(`${dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== dueDate)) throw new InputError("Choose a valid follow-up date.");
        b.tasks.push({ id: randomUUID(), workId: payload.workId, title: text(payload.title, "Follow-up", 200), dueDate, status: "open", createdAt: now,
            ...(payload.sourceUrl ? { sourceUrl: safeLink(payload.sourceUrl) } : {}) });
    } else if (command === "task_update") {
        const task = b.tasks.find((t) => t.id === payload.id);
        if (!task || !["open", "done"].includes(payload.status)) throw new InputError("Choose an existing follow-up and supported status.");
        task.status = payload.status; task.updatedAt = now;
    } else if (command === "evidence") {
        const item = b.work.find((w) => w.id === payload.workId);
        if (!item) throw new InputError("Choose an existing work item.");
        const source = b.profile?.sources.find((s) => s.id === payload.sourceId);
        if (!source && payload.sourceId !== "manual") throw new InputError("Choose an optional configured source or manual.");
        if (!["verified", "unverified", "blocked"].includes(payload.status)) throw new InputError("Evidence status must be explicit.");
        b.evidence.push({ id: randomUUID(), workId: item.id, sourceId: payload.sourceId,
            summary: text(payload.summary, "Evidence summary"), status: payload.status, url: safeLink(payload.url), recordedAt: now });
    } else if (command === "card") {
        const evidence = b.evidence.find((e) => e.id === payload.evidenceId);
        if (!evidence || evidence.status !== "verified") throw new InputError("A ready decision card requires verified evidence.");
        const workId = payload.workId ?? evidence.workId;
        if ((workId !== evidence.workId || b.work.find((w) => w.id === workId)?.sourceContext) &&
            !approvedContextEvidence(b, workId, evidence.id)) throw new InputError("Card evidence belongs to unrelated work without explicitly approved source context.", 403);
        if (!Array.isArray(payload.options) || payload.options.length < 2 || payload.options.length > 4) throw new InputError("A decision needs two to four concrete options.");
        const key = text(payload.key, "Stable card key", 100);
        if (b.cards.some((c) => c.key === key)) throw new InputError("This card key already exists, including resolved cards.", 409);
        const options = payload.options.map((o) => text(o, "Option", 200));
        if (!Number.isInteger(payload.recommendedIndex) || !options[payload.recommendedIndex]) throw new InputError("Recommendation must name an option.");
        if (payload.kind !== undefined && !["decision", "draft"].includes(payload.kind)) throw new InputError("Choose a decision or draft card.");
        let draft;
        if (payload.kind === "draft") {
            if (!payload.draft || Object.keys(payload.draft).some((k) => !["channel", "target", "text"].includes(k))) throw new InputError("Draft requires channel, target and text only.");
            draft = { channel: text(payload.draft.channel, "Draft channel", 100), target: text(payload.draft.target, "Draft target", 200), text: text(payload.draft.text, "Draft text", 8000) };
        } else if (payload.draft !== undefined) throw new InputError("Draft text requires a draft card.");
        b.cards.push({ id: randomUUID(), key, workId, evidenceId: evidence.id,
            title: text(payload.title, "Decision title", 160), why: text(payload.why, "Why this is your decision"),
            options, recommendedIndex: payload.recommendedIndex, afterDecision: text(payload.afterDecision, "What happens after the decision"),
            ...(payload.kind ? { kind: payload.kind } : {}), ...(payload.consequences ? { consequences: text(payload.consequences, "Consequences", 1000) } : {}),
            ...(draft ? { draft } : {}), ...(workId !== evidence.workId ? { contextWorkId: evidence.workId } : {}), status: "open", createdAt: now });
    } else if (command === "resolve") {
        const card = b.cards.find((c) => c.id === payload.id);
        if (!card || card.status !== "open") throw new InputError("Choose an option on an open card.");
        if (payload.response !== undefined) card.response = text(payload.response, "Your response", 4000);
        else {
            if (!Number.isInteger(payload.choice) || !card.options[payload.choice]) throw new InputError("Choose an option on an open card.");
            card.choice = payload.choice;
        }
        card.status = "resolved"; card.resolvedAt = now;
    } else throw new InputError("Unknown command.", 404);
    b.revision++;
    b.events.push({ at: now, command, revision: b.revision });
    return b;
}
export function todayState(board) {
    const cards = board.cards.filter((c) => c.status === "open");
    if (!board.profile) return { code: "setup", title: "Start with your purpose", cards };
    if (cards.length) return { code: "ready", title: "Decisions ready for you", cards };
    if (board.evidence.some((e) => e.status === "blocked")) return { code: "blocked", title: "Some sources or evidence are blocked", cards };
    if (board.evidence.some((e) => e.status === "verified" && !board.cards.some((c) => c.evidenceId === e.id))) return { code: "pending", title: "Evidence is ready; card preparation needs review", cards };
    if (board.profile.sources.some((s) => s.status !== "ready")) return { code: "sources", title: "Sources are not verified yet", cards };
    return { code: "empty", title: "No eligible decisions recorded yet", cards };
}
export async function replaceWorkspaceFile(pendingPath, destination, renameFile = rename) {
    for (let attempt = 0; ; attempt++) {
        try { await renameFile(pendingPath, destination); return; }
        catch (error) {
            if (attempt >= 11 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
            // Windows readers/indexers may briefly deny atomic replacement. Keep
            // the writer lock and same pending file; never fall back to in-place writes.
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        }
    }
}
export class WorkspaceStore {
    constructor({ root = defaultDataRoot(), id = "default", installationRoot = codeRoot } = {}) {
        this.id = workspaceId(id); this.root = resolve(root); this.installationRoot = resolve(installationRoot);
        const rel = relative(this.installationRoot, this.root);
        if (!rel || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)) throw new InputError("User data must be outside the code folder.");
        this.directory = join(this.root, "workspaces", this.id);
        this.path = join(this.directory, "board.json");
    }
    async read() {
        try {
            const board = JSON.parse(await readFile(this.path, "utf8"));
            if (board.schemaVersion !== 1 || board.workspaceId !== this.id || !Array.isArray(board.cards) || !Number.isInteger(board.revision)) throw new Error("Unsupported or damaged workspace data.");
            return normalizeSavedBoard(board);
        } catch (error) {
            if (error.code === "ENOENT") return blankBoard(this.id);
            throw error;
        }
    }
    async mutate(command, payload, expectedRevision) {
        if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new InputError("Supply the current workspace revision.");
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const actual = await realpath(this.directory), base = await realpath(this.root);
        if (!actual.startsWith(base + sep)) throw new InputError("Workspace must not redirect outside its data root.");
        const lock = join(this.directory, "write.lock");
        let handle;
        try { handle = await open(lock, "wx", 0o600); }
        catch (error) { if (error.code === "EEXIST") throw new InputError("Workspace is busy. No write occurred.", 409); throw error; }
        const temp = `${this.path}.${randomUUID()}.pending`;
        try {
            const before = await this.read();
            if (before.revision !== expectedRevision) throw new InputError("Workspace changed. Refresh before saving.", 409);
            let after;
            if (command === "apply_workspace_patch") {
                after = structuredClone(before);
                const now = new Date().toISOString();
                await applyWorkspacePatch(after, payload, this.directory, now);
                after.revision++;
                after.events.push({ at: now, command, revision: after.revision });
            } else after = applyCommand(before, command, payload);
            await writeFile(temp, JSON.stringify(after, null, 2) + "\n", { flag: "wx", mode: 0o600 });
            await replaceWorkspaceFile(temp, this.path);
            return after;
        } finally {
            await handle.close();
            await unlink(lock);
            await unlink(temp).catch((e) => { if (e.code !== "ENOENT") throw e; });
        }
    }
}
