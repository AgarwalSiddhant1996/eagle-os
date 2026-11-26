import test from "node:test";
import assert from "node:assert/strict";
import { validateDomainManifest, applyDomainCommand, domainViewsState, validateDomainRows } from "../src/domain-views.mjs";
import { navigationViews, domainRows } from "../ui/domain-state.mjs";

const manifest = { id: "review-queue", title: "Review queue", description: "Track reviews that need a next step.",
    renderer: "table", dataset: "work", sourceIds: ["repo"], fields: [{ key: "title", label: "Work", type: "text" }, { key: "status", label: "State", type: "text" }] };
function fixture() {
    return {
        host: { sources: [{ id: "repo", type: "repository", toolId: "reader", repoId: "repo-one", status: "verified", receipt: { identity: "sample/repo" } }],
            selection: { selectedToolIds: ["reader"], selectedRepoIds: ["repo-one"] } },
        work: [{ id: "work-one", sourceId: "repo", title: "Read source", status: "active" }],
        evidence: [{ id: "evidence-one", sourceId: "repo", status: "verified" }],
    };
}
function propose(board, value = manifest) {
    applyDomainCommand(board, "view_propose", { title: value.title, why: "This source-backed job needs a review view.", manifest: value });
    return board.domainViews.proposals.at(-1);
}
function approve(board, proposal) {
    applyDomainCommand(board, "view_approve", { id: proposal.id, fingerprint: proposal.fingerprint, confirmed: true });
}
test("only user-approved visible domain views join the lean core navigation; proposals and hidden add-ons do not", () => {
    const b = fixture(), p = propose(b);
    assert.deepEqual(navigationViews({ views: domainViewsState(b) }).map((v) => v.id), ["today", "work", "improvements"]);
    approve(b, p);
    const state = domainViewsState(b);
    assert.deepEqual(navigationViews({ views: state }).map((v) => v.id), ["today", "work", "improvements", "addon:review-queue"]);
    applyDomainCommand(b, "view_remove", { id: manifest.id, fingerprint: p.fingerprint, confirmed: true });
    assert.equal(navigationViews({ views: domainViewsState(b) }).length, 3);
    assert.equal(b.work[0].title, "Read source");
    applyDomainCommand(b, "view_restore", { id: manifest.id, fingerprint: p.fingerprint, confirmed: true });
    assert.equal(navigationViews({ views: domainViewsState(b) }).length, 4);
});
test("an unversioned local manifest edit is not overwritten or hidden using an old fingerprint", () => {
    const b = fixture(), first = propose(b); approve(b, first);
    const p = propose(b, { ...manifest, title: "Updated review queue" });
    b.domainViews.active[0].manifest.title = "Locally customized title";
    assert.throws(() => approve(b, p), /changed/);
    assert.throws(() => applyDomainCommand(b, "view_remove", { id: manifest.id, fingerprint: first.fingerprint, confirmed: true }), /current view/);
    assert.equal(b.domainViews.active[0].manifest.title, "Locally customized title");
    assert.equal(b.domainViews.active[0].hiddenAt, null);
});
test("exact manifest approval is required and source exclusions cannot be bypassed during activation", () => {
    const b = fixture(), p = propose(b);
    assert.throws(() => applyDomainCommand(b, "view_approve", { id: p.id, fingerprint: "stale", confirmed: true }), /exact/);
    assert.throws(() => applyDomainCommand(b, "view_approve", { id: p.id, fingerprint: p.fingerprint }), /confirm/);
    b.host.selection.selectedToolIds = [];
    assert.throws(() => approve(b, p), /outside/);
    assert.equal(b.domainViews.active.length, 0);
});
test("declarative manifests reject executable content, path ids, arbitrary bindings, secrets and unconnected source ids", () => {
    const b = fixture();
    for (const extra of [{ script: "run code" }, { html: "<script>run()</script>" }, { permissions: ["write"] }, { command: "shell" }])
        assert.throws(() => validateDomainManifest({ ...manifest, ...extra }, b), /unsupported/);
    assert.throws(() => validateDomainManifest({ ...manifest, id: "../escape" }, b), /simple/);
    assert.throws(() => validateDomainManifest({ ...manifest, sourceIds: ["unknown"] }, b), /Connect/);
    assert.throws(() => validateDomainManifest({ ...manifest, sourceIds: [" repo "] }, b), /exact registered/);
    assert.throws(() => validateDomainManifest({ ...manifest, fields: [{ key: "unavailableMetric", label: "Metric", type: "number" }] }, b), /not available/);
    assert.throws(() => validateDomainManifest({ ...manifest, dataset: "records", fields: [{ key: "accessToken", label: "Secret", type: "text" }] }, b), /safe identifiers/);
});
test("domain proposals preserve existing customizations and reject a stale update without silently replacing an approved view", () => {
    const b = fixture(), first = propose(b); approve(b, first);
    const p = propose(b, { ...manifest, title: "Updated review queue" });
    b.domainViews.active[0].fingerprint = "changed-elsewhere";
    assert.throws(() => approve(b, p), /changed/);
    assert.equal(b.domainViews.active[0].manifest.title, manifest.title);
});
test("loss of source access blocks an approved domain without deleting its manifest or rows", () => {
    const b = fixture(), p = propose(b); approve(b, p);
    b.host.sources[0].status = "blocked";
    assert.equal(domainViewsState(b).active[0].availability, "blocked");
    assert.equal(b.domainViews.active[0].manifest.title, manifest.title);
});
test("source-bound view projections and declarative filters do not show another source or mutate work", () => {
    const b = fixture(), p = propose(b, { ...manifest, filters: [{ field: "status", operator: "equals", value: "active" }] }); approve(b, p);
    b.work.push({ id: "other", sourceId: "excluded", title: "Other source", status: "active" });
    const state = { board: b, views: domainViewsState(b) };
    const rows = domainRows(state, state.views.active[0]);
    assert.equal(rows.length, 1); rows[0].title = "Display copy";
    assert.equal(b.work[0].title, "Read source");
});
test("custom metric rows require approved typed schema, same source evidence and valid finite values", () => {
    const b = fixture();
    const value = { ...manifest, id: "metrics", dataset: "records",
        fields: [{ key: "measure", label: "Measure", type: "number" }, { key: "checked", label: "Checked", type: "boolean" }, { key: "date", label: "Date", type: "date" }] };
    const p = propose(b, value); approve(b, p);
    const row = { viewId: "metrics", sourceId: "repo", externalKey: "metric-one", evidenceId: "evidence-one", values: { measure: 3, checked: true, date: "2026-11-20" } };
    assert.equal(validateDomainRows([row], b)[0].values.measure, 3);
    assert.throws(() => validateDomainRows([{ ...row, evidenceId: "missing" }], b), /evidence/);
    assert.throws(() => validateDomainRows([{ ...row, values: { ...row.values, measure: Infinity } }], b), /declared type/);
    assert.throws(() => validateDomainRows([{ ...row, values: { ...row.values, date: "2026-02-31" } }], b), /declared type/);
    assert.throws(() => validateDomainRows([{ ...row, values: { ...row.values, script: "code" } }], b), /unsupported/);
    applyDomainCommand(b, "view_rows", { rows: [row] }); applyDomainCommand(b, "view_rows", { rows: [row] });
    assert.equal(b.domainViews.rows.length, 1);
});
test("URL fields cannot turn a declarative row into executable or credential-bearing links", () => {
    const b = fixture(), p = propose(b, { ...manifest, dataset: "records", fields: [{ key: "link", label: "Source", type: "url" }] }); approve(b, p);
    const row = { viewId: manifest.id, sourceId: "repo", externalKey: "row", evidenceId: "evidence-one", values: { link: "https://example.test/read" } };
    assert.equal(validateDomainRows([row], b).length, 1);
    const userInfo = new URL("https://example.test/read");
    userInfo.username = "fixture-user"; userInfo.password = "fixture-password";
    for (const link of ["javascript:alert(1)", userInfo.href, "https://example.test/?token=fixture-value"])
        assert.throws(() => validateDomainRows([{ ...row, values: { link } }], b), /declared type/);
});
test("grouped boards and timelines require available typed grouping fields", () => {
    const b = fixture();
    assert.throws(() => validateDomainManifest({ ...manifest, renderer: "board" }, b), /grouping field/);
    assert.equal(validateDomainManifest({ ...manifest, renderer: "board", groupBy: "status" }, b).groupBy, "status");
    assert.throws(() => validateDomainManifest({ ...manifest, renderer: "timeline", groupBy: "status" }, b), /date field/);
    const timeline = { ...manifest, renderer: "timeline", groupBy: "createdAt", fields: [...manifest.fields, { key: "createdAt", label: "Created", type: "date" }] };
    assert.equal(validateDomainManifest(timeline, b).renderer, "timeline");
});
test("view commands reject hidden extra permissions and unknown actions before changing state", () => {
    const b = fixture(), p = propose(b);
    assert.throws(() => applyDomainCommand(b, "view_approve", { id: p.id, fingerprint: p.fingerprint, confirmed: true, permissions: ["write"] }), /unsupported/);
    assert.throws(() => applyDomainCommand(b, "execute", {}), /Unknown/);
    assert.equal(p.status, "proposed");
    assert.equal(b.domainViews.active.length, 0);
});
