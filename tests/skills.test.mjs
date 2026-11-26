import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillCatalog, discoverSkills, installSkills, validateSkillDocument, resolveSkillSelection } from '../src/skills.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

async function fixture(t) {
  await mkdir(path.join(repository, '.test-output'), { recursive: true });
  const root = await mkdtemp(path.join(repository, '.test-output', 'skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory: path.join(root, 'workspace', 'skills') };
}

function instruction(id, description = 'A synthetic local skill.', version = '2.0.0') {
  return `---\nname: ${id}\ndescription: "${description}"\nversion: ${version}\n---\n\nLocal instructions.\n`;
}

async function localSkill(directory, id, content = instruction(id)) {
  const target = path.join(directory, id);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'SKILL.md'), content);
  return target;
}

test('catalogue has all 20 PM skills with valid matching YAML metadata', async () => {
  const catalog = await skillCatalog();
  assert.equal(catalog.length, 20);
  assert.equal(new Set(catalog.map(skill => skill.id)).size, 20);
  for (const skill of catalog) {
    assert.deepEqual(Object.keys(skill).sort(), ['description', 'id', 'name', 'version']);
    assert.equal(skill.name, skill.id);
    assert.match(skill.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(skill.description.length > 30 && skill.description.length <= 1024);
    assert.match(skill.version, /^\d+\.\d+\.\d+$/);
    const content = (await readFile(path.join(repository, 'skills', skill.id, 'SKILL.md'), 'utf8')).replaceAll('\r\n', '\n');
    assert.match(content, /^---\nname: [a-z-]+\ndescription: ".+"\nversion: \d+\.\d+\.\d+\n---\n/);
    assert.ok(content.split('\n---\n')[1].length > 1200, `${skill.id} needs substantive instructions`);
  }
});

test('validates string and Buffer documents without a workspace or file access', () => {
  const content = instruction('custom-review');
  const expected = {
    id: 'custom-review', name: 'custom-review',
    description: 'A synthetic local skill.', version: '2.0.0',
  };
  assert.deepEqual(validateSkillDocument(content, 'custom-review'), expected);
  assert.deepEqual(validateSkillDocument(Buffer.from(content), 'custom-review'), expected);
  assert.deepEqual(validateSkillDocument(`\uFEFF${content.replaceAll('\n', '\r\n')}`, 'custom-review'), expected);
  for (const value of [undefined, null, {}, 123, new Uint8Array()]) {
    assert.throws(() => validateSkillDocument(value, 'custom-review'), /string or Buffer/);
  }
  for (const id of ['../custom-review', 'BAD', null]) {
    assert.throws(() => validateSkillDocument(content, id), /Invalid skill id/);
  }
  for (const bad of [
    'No front matter',
    instruction('other-review'),
    instruction('custom-review', 'Bad version.', 'next'),
    '---\nname: custom-review\ndescription: "Missing version."\n---\n',
    '---\nname: custom-review\ndescription: "First"\ndescription: "Duplicate"\nversion: 1.0.0\n---\n',
  ]) {
    assert.throws(() => validateSkillDocument(bad, 'custom-review'), /Invalid SKILL.md metadata/);
  }
});

test('installs an eligible all selection and preserves edits when a pack is selected again', async t => {
  const { directory } = await fixture(t);
  const ids = resolveSkillSelection({ all: true });
  const result = await installSkills({ directory, ids });
  assert.deepEqual(result, { installed: ids, kept: [] });
  assert.equal((await discoverSkills(directory)).length, 19);
  const filename = path.join(directory, 'self-improvement', 'SKILL.md');
  const edited = `${instruction('self-improvement', 'Workspace-specific approved instructions.')}Keep these edits.\n`;
  await writeFile(filename, edited);
  const repeated = resolveSkillSelection({ packs: ['core-orchestration'], ids: ['self-improvement'] });
  assert.deepEqual(await installSkills({ directory, ids: repeated }), { installed: [], kept: repeated });
  assert.equal(await readFile(filename, 'utf8'), edited);
  await assert.rejects(readdir(path.join(directory, 'remote-operations')), { code: 'ENOENT' });
});

test('installs only opted-in skills and discovers valid local and custom skills', async t => {
  const { directory } = await fixture(t);
  assert.deepEqual(await discoverSkills(directory), []);
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
  assert.deepEqual(await installSkills({ directory, ids: [] }), { installed: [], kept: [] });
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
  assert.deepEqual(
    await installSkills({ directory, ids: ['plain-writing', 'flowcharts', 'plain-writing'] }),
    { installed: ['plain-writing', 'flowcharts'], kept: [] },
  );
  assert.deepEqual((await readdir(directory)).sort(), ['flowcharts', 'plain-writing']);
  await localSkill(directory, 'custom-review');
  await mkdir(path.join(directory, 'notes'));
  await writeFile(path.join(directory, 'unrelated.txt'), 'untouched');
  const found = await discoverSkills(directory);
  assert.deepEqual(found.map(skill => skill.id), ['custom-review', 'flowcharts', 'plain-writing']);
  assert.ok(found.every(skill => skill.status === 'installed'));
  assert.equal(found[0].version, '2.0.0');
  for (const id of ['plain-writing', 'flowcharts']) {
    assert.deepEqual(
      await readFile(path.join(directory, id, 'SKILL.md')),
      await readFile(path.join(repository, 'skills', id, 'SKILL.md')),
    );
    assert.deepEqual(await readdir(path.join(directory, id)), ['SKILL.md']);
  }
});

test('keeps edited existing skill and auxiliary files byte-identical', async t => {
  const { directory } = await fixture(t);
  const edited = Buffer.from(`${instruction('plain-writing', 'User-authored description.', '9.1.0')}\r\nUser edits: café.\r\n`);
  const target = await localSkill(directory, 'plain-writing', edited);
  const auxiliary = Buffer.from([0, 255, 13, 10, 87]);
  await writeFile(path.join(target, 'personal.bin'), auxiliary);
  assert.deepEqual(
    await installSkills({ directory, ids: ['plain-writing', 'telemetry'] }),
    { installed: ['telemetry'], kept: ['plain-writing'] },
  );
  assert.deepEqual(await readFile(path.join(target, 'SKILL.md')), edited);
  assert.deepEqual(await readFile(path.join(target, 'personal.bin')), auxiliary);
  assert.deepEqual(
    await installSkills({ directory, ids: ['plain-writing', 'telemetry'] }),
    { installed: [], kept: ['plain-writing', 'telemetry'] },
  );
});

test('rejects unknown ids, traversal, missing selections, and unsafe destination paths without writes', async t => {
  const { root, directory } = await fixture(t);
  for (const ids of [['unknown-skill'], ['../plain-writing'], ['..\\plain-writing'], ['plain-writing/extra'], ['PLAIN'], [null]]) {
    await assert.rejects(installSkills({ directory, ids }), /skill id/i);
  }
  await assert.rejects(installSkills({ directory }), /explicit array/);
  await assert.rejects(installSkills({ directory: '.', ids: [] }), /absolute/);
  await assert.rejects(installSkills({ directory: path.parse(root).root, ids: [] }), /filesystem root/);
  await assert.rejects(
    installSkills({ directory: `${root}${path.sep}workspace${path.sep}..${path.sep}escape`, ids: ['flowcharts'] }),
    /absolute workspace/,
  );
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
});

test('rejects malformed local metadata rather than returning successful descriptors or kept', async t => {
  const { directory } = await fixture(t);
  const bad = [
    'No front matter.',
    '---\nname: plain-writing\ndescription: "Missing version."\n---\n',
    '---\nname: plain-writing\ndescription: "First."\ndescription: "Second."\nversion: 1.0.0\n---\n',
    '---\nname: plain-writing\ndescription: |\n  Block syntax is unsupported.\nversion: 1.0.0\n---\n',
    instruction('different-name'),
    instruction('plain-writing', 'Invalid version.', 'not-a-version'),
  ];
  for (const content of bad) {
    const target = await localSkill(directory, 'plain-writing', content);
    await assert.rejects(discoverSkills(directory), /Invalid SKILL.md metadata/);
    await assert.rejects(
      installSkills({ directory, ids: ['flowcharts', 'plain-writing'] }),
      /Invalid SKILL.md metadata/,
    );
    assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), content);
    await assert.rejects(readdir(path.join(directory, 'flowcharts')), { code: 'ENOENT' });
  }
});

test('rejects destination and skill-directory symlinks, including ancestor junctions', async t => {
  const { root, directory } = await fixture(t);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await mkdir(path.dirname(directory), { recursive: true });
  await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(discoverSkills(directory), /symlink/i);
  await assert.rejects(installSkills({ directory, ids: ['flowcharts'] }), /symlink/i);
  assert.deepEqual(await readdir(outside), []);
  await rm(directory);
  await mkdir(directory);
  const target = path.join(directory, 'flowcharts');
  await symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(discoverSkills(directory), /symlink/i);
  await assert.rejects(installSkills({ directory, ids: ['flowcharts'] }), /symlink/i);
  assert.deepEqual(await readdir(outside), []);
  const ancestor = path.join(root, 'ancestor');
  await symlink(outside, ancestor, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    installSkills({ directory: path.join(ancestor, 'nested', 'skills'), ids: ['telemetry'] }),
    /symlink/i,
  );
  assert.deepEqual(await readdir(outside), []);
});

test('rejects a selected SKILL.md symlink without modifying its source', async t => {
  const { root, directory } = await fixture(t);
  const source = path.join(root, 'source.md');
  const original = instruction('flowcharts');
  await writeFile(source, original);
  await mkdir(path.join(directory, 'flowcharts'), { recursive: true });
  try {
    await symlink(source, path.join(directory, 'flowcharts', 'SKILL.md'), 'file');
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    // A junction at the metadata path exercises the same no-follow boundary.
    const sourceDirectory = path.join(root, 'source-directory');
    await mkdir(sourceDirectory);
    await symlink(sourceDirectory, path.join(directory, 'flowcharts', 'SKILL.md'), 'junction');
  }
  await assert.rejects(discoverSkills(directory), /symlink/i);
  await assert.rejects(installSkills({ directory, ids: ['flowcharts'] }), /symlink/i);
  assert.equal(await readFile(source, 'utf8'), original);
});
