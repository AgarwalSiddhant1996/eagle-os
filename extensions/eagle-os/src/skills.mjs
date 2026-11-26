import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, link, unlink, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledSkillIds } from './skill-packs.mjs';
export { skillPacks, rolePresets, resolveSkillSelection } from './skill-packs.mjs';

const bundledDirectory = fileURLToPath(new URL('../skills/', import.meta.url));
const bundledIds = bundledSkillIds;
const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function assertId(id) {
  if (typeof id !== 'string' || id.length > 64 || !validId.test(id)) {
    throw new TypeError('Invalid skill id');
  }
}

function directoryPath(directory) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0')
      || !path.isAbsolute(directory) || directory.split(/[\\/]/).includes('..')) {
    throw new TypeError('An explicit absolute workspace skills directory is required');
  }
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) {
    throw new TypeError('The filesystem root cannot be a skills directory');
  }
  return resolved;
}

async function statOrMissing(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function safeDirectory(directory, create = false) {
  const { root } = path.parse(directory);
  let current = root;
  for (const segment of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat = await statOrMissing(current);
    if (!stat && create) {
      try {
        await mkdir(current);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      stat = await statOrMissing(current);
    }
    if (!stat) return false;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Skills directory paths must contain only real directories, not symlinks');
    }
  }
  return true;
}

function scalar(value) {
  const text = value.trim();
  if (text.startsWith('"')) {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'string') throw new Error('Expected a string scalar');
    return parsed;
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new Error('Malformed quoted scalar');
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (!text || /^[-?:,[\]{}#&*!|>'"%@`]/.test(text)
      || /:\s|\s#|[\t\r\n]/.test(text) || /^(?:null|true|false|~)$/i.test(text)) {
    throw new Error('Expected a plain or quoted single-line string scalar');
  }
  return text;
}

function metadata(content, id) {
  try {
    const text = content.toString('utf8').replace(/^\uFEFF/, '');
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!match) throw new Error('Missing YAML front matter');
    const fields = Object.create(null);
    for (const line of match[1].split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const field = /^([a-z][a-z0-9_-]*):[ \t]*(.*)$/.exec(line);
      if (!field || Object.hasOwn(fields, field[1])) {
        throw new Error('Unsupported or duplicate metadata field');
      }
      fields[field[1]] = scalar(field[2]);
    }
    if (fields.name !== id || !fields.description?.trim()
        || fields.description.length > 1024 || !validVersion.test(fields.version ?? '')) {
      throw new Error('Expected matching name, description, and semantic version');
    }
    return { id, name: fields.name, description: fields.description, version: fields.version };
  } catch (error) {
    throw new Error(`Invalid SKILL.md metadata for "${id}": ${error.message}`, { cause: error });
  }
}

/** Validate an instruction document without reading or writing any files. */
export function validateSkillDocument(content, id) {
  assertId(id);
  if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
    throw new TypeError('Skill content must be a string or Buffer');
  }
  return metadata(content, id);
}

async function readSkill(directory, id) {
  assertId(id);
  const target = path.join(directory, id);
  await safeDirectory(target);
  const filename = path.join(target, 'SKILL.md');
  const stat = await statOrMissing(filename);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Skill "${id}" must contain a regular SKILL.md file, not a symlink`);
  }
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.ino !== stat.ino || openedStat.dev !== stat.dev) {
      throw new Error('Skill file changed during inspection');
    }
    const content = await handle.readFile();
    return { descriptor: validateSkillDocument(content, id), content };
  } finally {
    await handle.close();
  }
}

async function bundledSkills() {
  await safeDirectory(bundledDirectory);
  return Promise.all(bundledIds.map(id => readSkill(bundledDirectory, id)));
}

/** Return all bundled skills; invalid bundled metadata is an error. */
export async function skillCatalog() {
  return (await bundledSkills()).map(skill => skill.descriptor);
}

/** Inspect local files only. This does not query or register with a host. */
export async function discoverSkills(directory) {
  const root = directoryPath(directory);
  if (!await safeDirectory(root)) return [];
  const discovered = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(root, entry.name);
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in the skills directory');
    if (!stat.isDirectory()) continue;
    if (!await statOrMissing(path.join(target, 'SKILL.md'))) continue;
    const { descriptor } = await readSkill(root, entry.name);
    discovered.push({ ...descriptor, status: 'installed' });
  }
  return discovered;
}

/** Install only the requested absent skills, without replacing existing content. */
export async function installSkills({ directory, ids } = {}) {
  const root = directoryPath(directory);
  if (!Array.isArray(ids)) throw new TypeError('ids must be an explicit array');
  for (const id of ids) {
    assertId(id);
    if (!bundledIds.includes(id)) throw new Error(`Unknown skill id: "${id}"`);
  }
  const selected = [...new Set(ids)];
  const bundle = new Map((await bundledSkills()).map(skill => [skill.descriptor.id, skill]));
  const result = { installed: [], kept: [] };
  if (!selected.length) return result;
  await safeDirectory(root, true);

  // Validate every existing selection before publishing any new skill.
  for (const id of selected) {
    if (await statOrMissing(path.join(root, id))) await readSkill(root, id);
  }
  for (const id of selected) {
    await safeDirectory(root);
    const target = path.join(root, id);
    try {
      await mkdir(target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await readSkill(root, id);
      result.kept.push(id);
      continue;
    }

    const pending = path.join(target, `.skill-${randomUUID()}.pending`);
    try {
      await safeDirectory(target);
      const handle = await open(pending, 'wx', 0o600);
      try {
        await handle.writeFile(bundle.get(id).content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await safeDirectory(target);
      // Linking publishes the complete file atomically and cannot replace a winner.
      await link(pending, path.join(target, 'SKILL.md'));
      result.installed.push(id);
    } finally {
      await unlink(pending).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (!result.installed.includes(id)) {
        await rmdir(target).catch(error => {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        });
      }
    }
  }
  return result;
}
