function pack(id, name, description, skills, requires = []) {
  return Object.freeze({
    id, name, description,
    skills: Object.freeze(skills),
    requires: Object.freeze(requires),
  });
}

export const skillPacks = Object.freeze([
  pack('core-orchestration', 'Core Orchestration',
    'Scope, coordinate, resume, and review work without expanding authority.', [
      'orchestrator-routing', 'model-tiering', 'kickoff-scoping', 'checkpoint-resume',
      'evidence-approval-review', 'self-improvement',
    ]),
  pack('pm-craft-research', 'PM Craft & Research',
    'Turn qualified evidence into product options, requirements, and measurement plans.', [
      'pm-specs', 'competitive-research', 'telemetry', 'research-synthesis',
      'opportunity-discovery', 'metric-diagnosis', 'experiment-planning', 'spec-review-update',
    ]),
  pack('comms-review', 'Comms & Review',
    'Prepare clear drafts, updates, process explanations, and release notes.', [
      'plain-writing', 'flowcharts', 'stakeholder-updates', 'reply-preparation', 'release-notes',
    ]),
  pack('remote-operations', 'Remote Operations',
    'Plan authorized remote work only when a real remote-worker capability is available.',
    ['remote-operations'], ['remote-worker']),
]);

export const rolePresets = Object.freeze({
  pm: Object.freeze(['core-orchestration', 'pm-craft-research', 'comms-review']),
});

export const bundledSkillIds = Object.freeze([...new Set(skillPacks.flatMap(item => item.skills))]);

function strings(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${label} must be an array of strings`);
  }
}

/** Resolve explicit choices without enabling capabilities or performing installation. */
export function resolveSkillSelection({ ids = [], packs = [], all = false, capabilities = [] } = {}) {
  strings(ids, 'ids');
  strings(packs, 'packs');
  strings(capabilities, 'capabilities');
  if (typeof all !== 'boolean') throw new TypeError('all must be a boolean');
  const available = new Set(capabilities);
  const byPack = new Map(skillPacks.map(item => [item.id, item]));
  const bySkill = new Map(skillPacks.flatMap(item => item.skills.map(id => [id, item])));
  const eligible = item => item.requires.every(capability => available.has(capability));
  const requireEligible = item => {
    const missing = item.requires.filter(capability => !available.has(capability));
    if (missing.length) {
      throw new Error(`Skill pack "${item.id}" requires capability: ${missing.join(', ')}`);
    }
  };
  const selected = new Set();
  for (const id of ids) {
    const item = bySkill.get(id);
    if (!item) throw new Error(`Unknown skill id: "${id}"`);
    requireEligible(item);
    selected.add(id);
  }
  for (const id of packs) {
    const item = byPack.get(id);
    if (!item) throw new Error(`Unknown skill pack: "${id}"`);
    requireEligible(item);
    for (const skill of item.skills) selected.add(skill);
  }
  if (all) {
    for (const item of skillPacks.filter(eligible)) {
      for (const id of item.skills) selected.add(id);
    }
  }
  return [...selected];
}
