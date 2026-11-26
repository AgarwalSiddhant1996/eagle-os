export const coreTabs = Object.freeze(["today", "work", "improvements"]);
export function visibleDomainViews(state) {
    return (state.views?.active ?? []).filter((v) => !v.hiddenAt);
}
export function navigationViews(state) {
    return [...coreTabs.map((id) => ({ id, title: id[0].toUpperCase() + id.slice(1) })),
        ...visibleDomainViews(state).map((v) => ({ id: `addon:${v.manifest.id}`, title: v.manifest.title }))];
}
export function domainRows(state, view) {
    const m = view.manifest;
    let rows;
    if (m.dataset === "records") rows = (state.views.rows ?? []).filter((r) => r.viewId === m.id && m.sourceIds.includes(r.sourceId)).map((r) => ({ ...r.values, id: r.externalKey, evidenceId: r.evidenceId }));
    else {
        const list = m.dataset === "work" ? state.board.work : m.dataset === "evidence" ? state.board.evidence : state.board.tasks ?? [];
        rows = list.filter((r) => m.sourceIds.includes(r.sourceId || state.board.work.find((w) => w.id === r.workId)?.sourceId));
    }
    return rows.filter((row) => (m.filters ?? []).every((f) => {
        const value = row[f.field];
        return f.operator === "equals" ? value === f.value : f.operator === "not-equals" ? value !== f.value : String(value ?? "").toLowerCase().includes(String(f.value).toLowerCase());
    })).map((row) => ({ ...row }));
}
