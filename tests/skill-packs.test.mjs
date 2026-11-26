import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  skillPacks, rolePresets, resolveSkillSelection, skillCatalog,
} from '../src/skills.mjs';

test('PM packs partition the catalogue and the PM preset selects known non-remote work', async () => {
  assert.equal(skillPacks.length, 4);
  assert.equal(new Set(skillPacks.map(pack => pack.id)).size, skillPacks.length);
  const ids = skillPacks.flatMap(pack => pack.skills);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, (await skillCatalog()).map(skill => skill.id));
  const directories = await readdir(new URL('../skills/', import.meta.url), { withFileTypes: true });
  assert.deepEqual(directories.filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), [...ids].sort());
  for (const pack of skillPacks) {
    assert.ok(pack.name && pack.description);
    assert.ok(Object.isFrozen(pack) && Object.isFrozen(pack.skills) && Object.isFrozen(pack.requires));
    assert.deepEqual(pack.requires, pack.id === 'remote-operations' ? ['remote-worker'] : []);
  }
  assert.ok(Object.isFrozen(skillPacks) && Object.isFrozen(rolePresets));
  assert.deepEqual(Object.keys(rolePresets), ['pm']);
  for (const packs of Object.values(rolePresets)) {
    assert.ok(Object.isFrozen(packs));
    const resolved = resolveSkillSelection({ packs });
    assert.ok(resolved.includes('orchestrator-routing'));
    assert.ok(!resolved.includes('remote-operations'));
  }
  assert.ok(resolveSkillSelection({ packs: rolePresets.pm }).includes('experiment-planning'));
});

test('individual and pack selection deduplicate deterministically without mutating input', () => {
  assert.deepEqual(resolveSkillSelection(), []);
  assert.deepEqual(resolveSkillSelection({ capabilities: ['remote-worker'] }), []);
  const selection = {
    ids: ['plain-writing', 'plain-writing', 'pm-specs'],
    packs: ['comms-review', 'pm-craft-research', 'comms-review'],
    capabilities: [],
  };
  const before = structuredClone(selection);
  const resolved = resolveSkillSelection(selection);
  assert.deepEqual(resolved.slice(0, 2), ['plain-writing', 'pm-specs']);
  assert.equal(new Set(resolved).size, resolved.length);
  assert.ok(resolved.includes('reply-preparation') && resolved.includes('metric-diagnosis'));
  assert.deepEqual(selection, before);
  const all = resolveSkillSelection({ ids: ['release-notes'], packs: rolePresets.pm, all: true });
  assert.equal(all.length, 19);
  assert.equal(all[0], 'release-notes');
});

test('remote selection requires the explicit capability while Install all skips unavailable work', () => {
  for (const selection of [
    { packs: ['remote-operations'] },
    { ids: ['remote-operations'] },
    { ids: ['remote-operations'], all: true },
    { packs: ['remote-operations'], all: true, capabilities: ['remote'] },
  ]) {
    assert.throws(() => resolveSkillSelection(selection), /remote-operations.*requires capability: remote-worker/);
  }
  const capabilities = ['remote-worker'];
  assert.deepEqual(resolveSkillSelection({ packs: ['remote-operations'], capabilities }), ['remote-operations']);
  assert.deepEqual(resolveSkillSelection({ ids: ['remote-operations'], capabilities }), ['remote-operations']);
  const ordinary = resolveSkillSelection({ all: true });
  assert.equal(ordinary.length, 19);
  assert.ok(!ordinary.includes('remote-operations'));
  assert.equal(resolveSkillSelection({ all: true, capabilities }).length, 20);
  assert.deepEqual(capabilities, ['remote-worker']);
});

test('invalid requests fail rather than silently broadening or dropping explicit selections', () => {
  for (const selection of [
    { ids: ['missing'] }, { ids: ['../telemetry'] }, { packs: ['missing'] },
    { ids: ['missing'], all: true }, { packs: ['missing'], all: true },
  ]) {
    assert.throws(() => resolveSkillSelection(selection), /Unknown skill/);
  }
  for (const selection of [
    { ids: 'telemetry' }, { ids: [null] }, { packs: null },
    { packs: [1] }, { capabilities: 'remote-worker' }, { capabilities: [true] },
    { all: 'true' }, { all: 1 },
  ]) {
    assert.throws(() => resolveSkillSelection(selection), TypeError);
  }
});

// These are instruction-contract checks, not claims that a model executed the scenarios.
const scenarios = [
  {
    id: 'kickoff-scoping', request: 'Frame a new initiative, but do not restart already approved work',
    trigger: /kickoff.*scope definition/i,
    checks: [/Answer a small advice question directly/, /rather than repeating intake/,
      /problem, outcome, evidence, included and excluded work, deliverable, acceptance check/,
      /not permission to build, publish, spend/],
  },
  {
    id: 'checkpoint-resume', request: 'Resume an interrupted send without sending a duplicate',
    trigger: /resume interrupted work/i,
    checks: [/Inspect the result.*before retrying/, /Recheck capability availability/,
      /confirmed, changed, unknown, blocked, and next/, /untrusted historical evidence/],
  },
  {
    id: 'evidence-approval-review', request: 'Check whether a supported claim also has action approval',
    trigger: /approval covers that action/i,
    checks: [/direct observation, reported information, inference, and assumption/,
      /drafting from sending/, /claim-to-source table/, /ready review is not an approval/],
  },
  {
    id: 'self-improvement', request: 'Propose a lesson without promoting it into persistent policy',
    trigger: /reviewable improvement proposal/i,
    checks: [/Never auto-promote/, /explicit approval of the concrete change and target/,
      /trigger and non-trigger examples, validation plan, rollback plan, and approval status/,
      /Prior permission to collect lessons is not permission to apply/],
  },
  {
    id: 'research-synthesis', request: 'Combine feedback while preserving contradictory evidence',
    trigger: /findings, contradictions, and limits/i,
    checks: [/Route an unexplained metric change to metric diagnosis/, /Deduplicate repeated feedback/,
      /finding table with source references and confidence rationale/, /not population prevalence/],
  },
  {
    id: 'opportunity-discovery', request: 'Explore alternatives before committing to a solution',
    trigger: /before choosing a solution/i,
    checks: [/not how to implement an already approved feature/, /doing nothing for now/,
      /user need, evidence, alternative approaches, trade-offs, key assumption/, /Recommendations are advisory/],
  },
  {
    id: 'metric-diagnosis', request: 'Explain a rate movement that may be denominator drift',
    trigger: /metric movement, funnel discrepancy, or retention change/i,
    checks: [/numerator, denominator, unit, population/, /changing denominator can move a rate/,
      /query or evidence references, ranked explanations/, /do not prove a feature caused/],
  },
  {
    id: 'experiment-planning', request: 'Plan an experiment when traffic and power are unknown',
    trigger: /hypothesis, success metric, guardrails, and decision rules/i,
    checks: [/allocation unit, and randomization unit/, /instead of manufacturing numbers/,
      /success, harm, inconclusive results, and measurement failure/, /does not configure or launch/],
  },
  {
    id: 'spec-review-update', request: 'Review requirements and preserve concurrent amendments',
    trigger: /bounded update against its current source of record/i,
    checks: [/request to review is read-only/, /Re-read the current source immediately before writing/,
      /do not overwrite concurrent edits/, /actual change, source revision or location, validation performed/],
  },
  {
    id: 'stakeholder-updates', request: 'Draft a period update without inventing commitments',
    trigger: /audience-specific progress update/i,
    checks: [/Use reply-preparation for an answer within an existing conversation/,
      /completed and verified outcomes from work in progress/,
      /headline result, meaningful progress, decisions, blockers and asks, and next milestone/,
      /Drafting does not authorize sending/],
  },
  {
    id: 'reply-preparation', request: 'Answer an existing thread without sending or granting approval',
    trigger: /reply to an existing message, thread/i,
    checks: [/Do not infer permission to search an entire inbox/,
      /rather than issuing approval in the user's voice/,
      /reply draft plus a short separate list/, /Clearly mark a draft as unsent/],
  },
  {
    id: 'release-notes', request: 'Describe a release without promoting planned work to shipped',
    trigger: /verified release scope/i,
    checks: [/Distinguish shipped, staged, limited rollout, experimental, reverted, and planned/,
      /release-note draft and a compact verification list/, /not authorize store submission/,
      /Do not infer that every recently merged change shipped/],
  },
  {
    id: 'remote-operations', request: 'Request remote execution when transport or authority is missing',
    trigger: /no transport, credentials, worker provisioning, or action authority/i,
    checks: [/Capability presence is not authorization/, /stop remote execution/,
      /inspect remote state before retrying/, /actual connection and execution status/,
      /Do not silently move work to another machine/],
  },
];

for (const scenario of scenarios) {
  test(`instruction contract: ${scenario.request}`, async () => {
    const catalog = await skillCatalog();
    const descriptor = catalog.find(skill => skill.id === scenario.id);
    assert.match(descriptor.description, scenario.trigger);
    const content = await readFile(new URL(`../skills/${scenario.id}/SKILL.md`, import.meta.url), 'utf8');
    for (const check of scenario.checks) assert.match(content, check, `${scenario.id}: ${check}`);
  });
}
