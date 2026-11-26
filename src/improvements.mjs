import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, open, rename, unlink } from "node:fs/promises";
import { join, parse, sep } from "node:path";
import { validateSkillDocument } from "./skills.mjs";

export class ImprovementError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new ImprovementError(message, status); };
const short = (value, label, max = 500) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must contain 1 to ${max} characters.`);
    return value.trim();
};
export const hashText = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stableId = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 64;
const categories = ["missed-check", "wrong-output", "slow-flow", "ownership", "other"];
export function emptyImprovements() { return { feedback: [], candidates: [] }; }
function receipt(input, label) {
    if (input.confirmed !== true) fail(`Explicit confirmation is required to ${label}.`);
    return short(input.evidence, "Readback or test evidence", 2000);
}
export function patchDigest(patch) {
    return hashText(JSON.stringify({ kind: patch.kind, target: patch.target, before: patch.before, after: patch.after, scenario: patch.scenario }));
}
export function exactDiff(patch) {
    const before = patch.before.split("\n"), after = patch.after.split("\n");
    return [`--- before/${patch.target}`, `+++ after/${patch.target}`, `@@ -1,${before.length} +1,${after.length} @@`,
        ...before.map((line) => `-${line}`), ...after.map((line) => `+${line}`)].join("\n");
}
function validatePatch(input) {
    if (!input || !["workspace-skill", "review-only"].includes(input.kind)) fail("Choose a workspace skill or a review-only patch.");
    const target = short(input.target, "Patch target", 120);
    if (input.kind === "workspace-skill" && !stableId(target)) fail("Choose a simple installed workspace skill id, not a path.");
    for (const key of ["before", "after"]) if (typeof input[key] !== "string" || input[key].length > 16000) fail("Patch text must be at most 16000 characters per side.");
    if (!input.after.trim() || input.before === input.after) fail("A proposal must change the target text.");
    if (input.kind === "workspace-skill") {
        validateSkillDocument(input.before, target);
        validateSkillDocument(input.after, target);
    }
    return { kind: input.kind, target, before: input.before, after: input.after, scenario: short(input.scenario, "Original failure and verification scenario", 1000) };
}
export function detectPatterns(improvements) {
    const groups = new Map();
    for (const f of improvements.feedback) {
        if (f.deletedAt) continue;
        const key = `${f.category}:${normalize(f.workflow)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(f);
    }
    return [...groups.entries()].filter(([, rows]) => rows.length >= 2
        && !improvements.candidates.some((c) => rows.every((f) => c.feedbackIds.includes(f.id)))).map(([key, rows]) => ({
        key, count: rows.length, feedbackIds: rows.map((f) => f.id),
        title: `Review repeated ${rows[0].category} friction`,
        observed: `${rows.length} distinct reported occurrences in ${rows[0].workflow}. Reports are not independently verified.`,
        inference: "A shared cause is possible, not established. Review the selected evidence before proposing a patch.",
    }));
}
export function applyImprovementCommand(board, command, input, now) {
    const im = board.improvements ??= emptyImprovements();
    if (command === "friction") {
        if (!categories.includes(input.category)) fail("Choose a supported friction category.");
        const occurrence = short(input.occurrence, "Stable occurrence key", 160);
        const data = {
            category: input.category, workflow: short(input.workflow, "Workflow", 100),
            expected: short(input.expected, "Expected behavior", 1000), actual: short(input.actual, "Observed behavior", 1000),
            context: input.context ? short(input.context, "Context", 200) : "",
            sourceEvidence: input.sourceEvidence ? short(input.sourceEvidence, "Selected evidence", 2000) : "",
        };
        const prior = im.feedback.find((f) => f.occurrence === occurrence);
        if (prior) {
            if (prior.deletedAt || JSON.stringify(data) !== JSON.stringify(Object.fromEntries(Object.keys(data).map((k) => [k, prior[k]])))) fail("This occurrence key already has different content. Review it rather than counting a retry.", 409);
            return;
        }
        im.feedback.push({ id: randomUUID(), occurrence, ...data, status: "captured", at: now });
        return;
    }
    if (command === "friction_delete") {
        const f = im.feedback.find((x) => x.id === input.id);
        if (!f) fail("Choose an existing feedback record.");
        if (im.candidates.some((c) => c.feedbackIds.includes(f.id) && c.status === "approved")) fail("Defer or reject the approved proposal before deleting its evidence.");
        const { id, occurrence, at } = f;
        Object.keys(f).forEach((key) => delete f[key]);
        Object.assign(f, { id, occurrence, at, deletedAt: now, status: "deleted" });
        return;
    }
    if (command === "improvement_propose") {
        if (input.confirmed !== true) fail("Review the selected local feedback before proposing a change.");
        if (!Array.isArray(input.feedbackIds) || !input.feedbackIds.length || input.feedbackIds.length > 20 || new Set(input.feedbackIds).size !== input.feedbackIds.length) fail("Choose 1 to 20 distinct feedback records.");
        const rows = input.feedbackIds.map((id) => im.feedback.find((f) => f.id === id && !f.deletedAt));
        if (rows.some((r) => !r)) fail("Selected feedback is missing or deleted.");
        const patch = validatePatch(input.patch), digest = patchDigest(patch);
        if (im.candidates.some((c) => c.digest === digest && ["proposed", "approved", "applied", "verified", "rejected"].includes(c.status))) fail("This patch was already proposed. Reuse its lifecycle or change the proposal.", 409);
        im.candidates.push({
            id: randomUUID(), title: short(input.title, "Improvement title", 160), feedbackIds: [...input.feedbackIds],
            observed: short(input.observed, "Observed facts", 1500),
            inference: input.inference ? short(input.inference, "Possible cause", 1000) : "",
            patch, digest, status: "proposed", at: now, history: [{ status: "proposed", at: now }],
        });
        return;
    }
    const c = im.candidates.find((x) => x.id === input.id);
    if (!c) fail("Choose an existing improvement.");
    if (input.digest !== c.digest || patchDigest(c.patch) !== c.digest) fail("The reviewed patch changed. Refresh and review the exact patch again.", 409);
    if (command === "improvement_approve") {
        if (c.status !== "proposed") fail("Only a proposed patch can be approved.", 409);
        if (input.confirmed !== true) fail("Review both exact file versions and explicitly approve this patch.");
        if (c.feedbackIds.some((id) => !im.feedback.some((f) => f.id === id && !f.deletedAt))) fail("Proposal evidence was deleted. Prepare a new proposal.");
        c.status = "approved"; c.approvedAt = now;
    } else if (command === "improvement_reject" || command === "improvement_defer") {
        if (!["proposed", "approved"].includes(c.status)) fail("Only a pending proposal can be rejected or deferred.", 409);
        c.status = command === "improvement_reject" ? "rejected" : "deferred";
        c.reason = short(input.reason, "Decision reason", 500);
    } else if (command === "improvement_reopen") {
        if (c.status !== "deferred") fail("Only a deferred proposal can return for review.", 409);
        c.status = "proposed";
    } else if (command === "improvement_applied") {
        if (c.patch.kind !== "review-only") fail("Use the guarded workspace-skill apply action for this patch.");
        if (c.status !== "approved") fail("Approve the exact patch before recording application.", 409);
        const evidence = receipt(input, "record application");
        if (input.readbackHash !== hashText(c.patch.after)) fail("The reported readback hash does not match the approved after text.");
        c.status = "applied"; c.appliedAt = now;
        c.application = { evidence, readbackHash: input.readbackHash, method: "Manual assertion; external target not independently inspected" };
    } else if (command === "improvement_verify") {
        if (c.status !== "applied") fail("Apply the approved patch before verifying the original failure scenario.", 409);
        const evidence = receipt(input, "record scenario verification");
        if (typeof input.passed !== "boolean") fail("State whether the original scenario passed or failed.");
        (c.verificationAttempts ??= []).push({ at: now, passed: input.passed, evidence });
        if (!input.passed) return;
        c.status = "verified"; c.verifiedAt = now;
        c.verification = { scenario: c.patch.scenario, evidence, method: "User or authorized owner assertion" };
    } else fail("Unknown improvement command.", 404);
    c.history.push({ status: c.status, at: now });
}

async function regularPath(file, directory = false) {
    const root = parse(file).root;
    let current = root;
    const parts = file.slice(root.length).split(sep);
    for (const [i, part] of parts.entries()) {
        current = join(current, part);
        const s = await lstat(current);
        if (s.isSymbolicLink() || (i < parts.length - 1 || directory ? !s.isDirectory() : !s.isFile())) fail("Patch targets must be existing real workspace files, never links.");
    }
}
export async function readWorkspaceSkill(directory, id) {
    if (typeof id !== "string" || !stableId(id)) fail("Choose an installed workspace skill id.");
    const target = join(directory, "skills", id, "SKILL.md");
    await regularPath(target);
    const content = await readFile(target, "utf8");
    validateSkillDocument(content, id);
    return content;
}
export async function applyWorkspacePatch(board, input, directory, now) {
    const c = board.improvements?.candidates.find((x) => x.id === input.id);
    if (!c || c.status !== "approved" || c.patch.kind !== "workspace-skill") fail("Choose an approved workspace-skill patch.", 409);
    if (input.confirmed !== true || input.digest !== c.digest || patchDigest(c.patch) !== c.digest) fail("Explicit approval of this exact patch is required.", 409);
    validatePatch(c.patch);
    const folder = join(directory, "skills", c.patch.target), target = join(folder, "SKILL.md");
    await regularPath(target);
    const before = await readFile(target, "utf8");
    if (before !== c.patch.before) fail("The workspace skill changed since review. Nothing was overwritten; prepare a new patch.", 409);
    const pending = join(folder, `.review-${randomUUID()}.pending`);
    try {
        const h = await open(pending, "wx", 0o600);
        try { await h.writeFile(c.patch.after); await h.sync(); } finally { await h.close(); }
        await regularPath(target);
        if (await readFile(target, "utf8") !== before) fail("The workspace skill changed during application. No patch was published.", 409);
        await rename(pending, target);
        const after = await readFile(target, "utf8");
        if (after !== c.patch.after) fail("Application readback differs from the approved patch. Inspect the workspace skill before retrying.", 409);
        c.status = "applied"; c.appliedAt = now;
        c.application = { readbackHash: hashText(after), method: "Workspace file readback", evidence: "Approved after text matched the workspace skill on disk." };
        c.history.push({ status: "applied", at: now });
    } finally {
        await unlink(pending).catch((e) => { if (e.code !== "ENOENT") throw e; });
    }
}
