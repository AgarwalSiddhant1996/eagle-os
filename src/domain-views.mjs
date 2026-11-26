import { createHash, randomUUID } from "node:crypto";

export class DomainError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new DomainError(message, status); };
const word = (value, label, max = 500) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must be short nonempty text.`);
    return value.trim();
};
const object = (value, keys, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k))) fail(`${label} contains unsupported fields.`);
    return value;
};
const bindings = {
    work: { title: "text", status: "text", owner: "text", nextAction: "text", createdAt: "date", updatedAt: "date" },
    evidence: { summary: "text", status: "text", sourceId: "text", recordedAt: "date", url: "url" },
    tasks: { title: "text", status: "text", dueDate: "date", createdAt: "date" },
};
export const domainFieldBindings = Object.freeze(bindings);
const fieldTypes = ["text", "number", "date", "boolean", "url"];
const blockedFields = /^(?:__proto__|prototype|constructor|.*token|password|secret|clientsecret|apikey|authorization|cookie|credentials)$/i;
export const domainFingerprint = (manifest) => createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
function connectedSource(board, id) {
    const s = board.host?.sources.find((source) => source.id === id);
    if (!s || !["verified", "partial"].includes(s.status) || !s.receipt) fail("Connect and read each selected source before building this view.");
    const selected = board.host?.selection;
    if (selected && (!selected.selectedToolIds.includes(s.toolId)
        || s.type === "repository" && !selected.selectedRepoIds.includes(s.repoId))) fail("View source is outside the current selected tool/repository scope.", 403);
    return s;
}
export function validateDomainManifest(input, board) {
    object(input, ["id", "title", "description", "renderer", "dataset", "sourceIds", "fields", "groupBy", "filters"], "View manifest");
    if (!/^[a-z][a-z0-9-]{0,49}$/.test(input.id ?? "")) fail("Use a simple lowercase view id, not a path.");
    if (!["table", "board", "timeline"].includes(input.renderer)) fail("Choose a supported declarative renderer.");
    if (!["work", "evidence", "tasks", "records"].includes(input.dataset)) fail("Choose a supported typed dataset.");
    if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.length > 20 || new Set(input.sourceIds).size !== input.sourceIds.length) fail("Choose one to twenty unique source ids.");
    input.sourceIds.forEach((id) => {
        if (word(id, "Source id", 160) !== id) fail("Use exact registered source ids without surrounding whitespace.");
        connectedSource(board, id);
    });
    if (!Array.isArray(input.fields) || !input.fields.length || input.fields.length > 12) fail("Choose one to twelve typed view fields.");
    const keys = new Set();
    const fields = input.fields.map((field) => {
        object(field, ["key", "label", "type"], "View field");
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field.key ?? "") || blockedFields.test(field.key) || keys.has(field.key)) fail("View field keys must be unique safe identifiers.");
        if (!fieldTypes.includes(field.type)) fail("Unsupported view field type.");
        if (input.dataset !== "records" && bindings[input.dataset][field.key] !== field.type) fail("The chosen field is not available in that dataset. Request a real adapter or use supported fields.");
        keys.add(field.key);
        return { key: field.key, label: word(field.label, "Field label", 80), type: field.type };
    });
    if (input.groupBy !== undefined && !keys.has(input.groupBy)) fail("Group/sort field must be declared in the view.");
    if (input.renderer === "board" && !input.groupBy) fail("Board needs a declared grouping field.");
    if (input.renderer === "timeline" && !fields.some((f) => f.key === input.groupBy && f.type === "date")) fail("Timeline needs a declared date field as groupBy.");
    const filters = input.filters ?? [];
    if (!Array.isArray(filters) || filters.length > 8) fail("Use at most eight safe declarative filters.");
    const normalizedFilters = filters.map((filter) => {
        object(filter, ["field", "operator", "value"], "View filter");
        if (!keys.has(filter.field) || !["equals", "not-equals", "includes"].includes(filter.operator)
            || !["string", "number", "boolean"].includes(typeof filter.value)) fail("Filter must use a declared field and a supported operation.");
        if (typeof filter.value === "string" && filter.value.length > 200) fail("Filter value is too long.");
        if (typeof filter.value === "number" && !Number.isFinite(filter.value)) fail("Filter value must be finite.");
        return { field: filter.field, operator: filter.operator, value: filter.value };
    });
    return {
        id: input.id, title: word(input.title, "View title", 80), description: word(input.description, "View purpose", 500),
        renderer: input.renderer, dataset: input.dataset, sourceIds: [...input.sourceIds], fields,
        ...(input.groupBy ? { groupBy: input.groupBy } : {}), ...(normalizedFilters.length ? { filters: normalizedFilters } : {}),
    };
}
function valueMatches(value, type) {
    if (value === null) return true;
    if (type === "text") return typeof value === "string" && value.length <= 2000;
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "boolean") return typeof value === "boolean";
    if (type === "date") {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
        return new Date(`${value.slice(0, 10)}T12:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);
    }
    if (type === "url") {
        try { const u = new URL(value); return typeof value === "string" && value.length <= 1000 && u.protocol === "https:" && !u.username && !u.password && !/[?&](?:token|sig|auth|code)=/i.test(value); }
        catch { return false; }
    }
    return false;
}
export function validateDomainRows(input, board) {
    if (!Array.isArray(input) || input.length > 40) fail("Domain rows must be a bounded array.");
    const views = board.domainViews?.active ?? [];
    return input.map((row) => {
        object(row, ["viewId", "sourceId", "externalKey", "values", "evidenceId"], "Domain row");
        const view = views.find((v) => v.manifest.id === row.viewId && !v.hiddenAt);
        if (!view || view.manifest.dataset !== "records") fail("Custom rows require an approved visible records view.");
        validateDomainManifest(view.manifest, board);
        if (!view.manifest.sourceIds.includes(row.sourceId)) fail("Row source is outside the approved view.");
        const evidence = board.evidence.find((e) => e.id === row.evidenceId && e.sourceId === row.sourceId && e.status === "verified" && !e.synthetic);
        if (!evidence) fail("Custom view values require real recorded evidence from that source.");
        object(row.values, view.manifest.fields.map((f) => f.key), "Typed row values");
        for (const field of view.manifest.fields) {
            if (!Object.hasOwn(row.values, field.key) || !valueMatches(row.values[field.key], field.type)) fail(`Row field ${field.key} does not match its declared type.`);
        }
        return { viewId: row.viewId, sourceId: row.sourceId, externalKey: word(row.externalKey, "Row identity", 160),
            values: structuredClone(row.values), evidenceId: evidence.id };
    });
}
export function applyDomainCommand(board, command, input, now = new Date().toISOString()) {
    if (!["view_propose", "view_rows", "view_remove", "view_restore", "view_approve", "view_reject"].includes(command)) fail("Unknown domain view command.", 404);
    object(input, command === "view_propose" ? ["title", "why", "manifest"] : command === "view_rows" ? ["rows"] : ["id", "fingerprint", "confirmed"], "Domain command");
    const views = board.domainViews ??= { proposals: [], active: [], rows: [] };
    if (command === "view_propose") {
        object(input, ["title", "why", "manifest"], "Domain proposal");
        const manifest = validateDomainManifest(input.manifest, board), fingerprint = domainFingerprint(manifest);
        if (views.proposals.some((p) => p.fingerprint === fingerprint && ["proposed", "rejected", "approved"].includes(p.status))) fail("This exact view was already proposed. Review its existing outcome.", 409);
        const before = views.active.find((v) => v.manifest.id === manifest.id);
        views.proposals.push({ id: randomUUID(), title: word(input.title, "Proposal title", 160), why: word(input.why, "Proposal reason", 1000),
            manifest, fingerprint, before: before?.manifest ?? null, beforeFingerprint: before?.fingerprint ?? null, status: "proposed", at: now });
        return;
    }
    if (command === "view_rows") {
        const rows = validateDomainRows(input.rows, board);
        for (const row of rows) {
            const existing = views.rows.find((r) => r.viewId === row.viewId && r.sourceId === row.sourceId && r.externalKey === row.externalKey);
            if (existing) Object.assign(existing, row, { at: now }); else views.rows.push({ ...row, at: now });
        }
        return;
    }
    if (["view_remove", "view_restore"].includes(command)) {
        const view = views.active.find((v) => v.manifest.id === input.id);
        if (!view || view.fingerprint !== input.fingerprint || domainFingerprint(view.manifest) !== view.fingerprint || input.confirmed !== true) fail("Review the current view before hiding or restoring it.", 409);
        if (command === "view_restore") validateDomainManifest(view.manifest, board);
        view.hiddenAt = command === "view_remove" ? now : null;
        return;
    }
    const proposal = views.proposals.find((p) => p.id === input.id);
    if (!proposal || proposal.status !== "proposed" || input.fingerprint !== proposal.fingerprint
        || domainFingerprint(proposal.manifest) !== proposal.fingerprint || input.confirmed !== true) fail("Review and confirm this exact pending view proposal.", 409);
    if (command === "view_reject") { proposal.status = "rejected"; proposal.decidedAt = now; return; }
    if (command !== "view_approve") fail("Unknown domain view command.", 404);
    const manifest = validateDomainManifest(proposal.manifest, board);
    const current = views.active.find((v) => v.manifest.id === manifest.id);
    if ((current?.fingerprint ?? null) !== proposal.beforeFingerprint || current && domainFingerprint(current.manifest) !== current.fingerprint) fail("This view changed since the proposal. Prepare a new preview.", 409);
    const saved = { manifest, fingerprint: proposal.fingerprint, approvedAt: now, hiddenAt: null,
        history: [...(current?.history ?? []), ...(current ? [{ manifest: current.manifest, fingerprint: current.fingerprint, at: current.approvedAt }] : [])].slice(-10) };
    if (current) Object.assign(current, saved); else views.active.push(saved);
    proposal.status = "approved"; proposal.decidedAt = now;
}
export function domainViewsState(board) {
    const views = board.domainViews ?? { proposals: [], active: [], rows: [] };
    return {
        proposals: views.proposals,
        active: views.active.map((v) => {
            let availability = "ready", detail = "";
            try { validateDomainManifest(v.manifest, board); } catch (e) { availability = "blocked"; detail = e.message; }
            return { ...v, availability, detail };
        }),
        rows: views.rows,
    };
}
