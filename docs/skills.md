# Portable workspace skills

The library contains **20 original PM instruction documents** in four selectable packs.

| Pack ID | Name | Skill IDs |
| --- | --- | --- |
| `core-orchestration` | Core Orchestration | `orchestrator-routing`, `model-tiering`, `kickoff-scoping`, `checkpoint-resume`, `evidence-approval-review`, `self-improvement` |
| `pm-craft-research` | PM Craft & Research | `pm-specs`, `competitive-research`, `telemetry`, `research-synthesis`, `opportunity-discovery`, `metric-diagnosis`, `experiment-planning`, `spec-review-update` |
| `comms-review` | Comms & Review | `plain-writing`, `flowcharts`, `stakeholder-updates`, `reply-preparation`, `release-notes` |
| `remote-operations` | Remote Operations | `remote-operations` (requires `remote-worker`) |

The PM preset selects Core Orchestration, PM Craft & Research and Comms & Review (19 skills). It excludes optional Remote Operations. Callers may add or remove individual choices.

No selection means no installation. Explicit **Install all** selects every currently eligible skill: 19 without capabilities, 20 with the explicit `remote-worker` capability. It does not activate that capability. An explicit request for the remote pack or its individual skill without that capability throws, even alongside Install all. A host should show the remote pack as unavailable unless its actual capability is present; these documents do not provide remote transport.

These are instructions, not runtime implementations, connectors, permissions, or credentials. Existing explicit model choices always win. No model or provider default is supplied. Every skill defines its trigger and evidence, privacy, and approval boundaries.

## Local API

`src/skills.mjs` uses only built-in runtime modules:

```js
import {
  skillCatalog, discoverSkills, installSkills,
  skillPacks, rolePresets, resolveSkillSelection, validateSkillDocument,
} from './src/skills.mjs';

const catalog = await skillCatalog();
const ids = resolveSkillSelection({
  packs: rolePresets.pm,
  ids: ['reply-preparation'],
  capabilities: [], // Supply only actual host capabilities, not user-requested flags.
});
const result = await installSkills({
  directory: workspaceSkillsDirectory,
  ids,
});
const local = await discoverSkills(workspaceSkillsDirectory);
```

The caller supplies an explicit absolute, workspace-specific local skills directory. There is no default installation location, global destination, network request, or host-registration action. The caller must select a directory belonging to the intended workspace, not a global host configuration directory. Do not pass an untrusted request's path directly without workspace authorization.

Exports and results:

- `skillCatalog()` resolves to all 20 `{ id, name, description, version }` descriptors in manifest order, including the gated skill. Listing is not installation or activation.
- `skillPacks` is an immutable array of `{ id, name, description, skills: [id], requires: [capability] }`. All packs except Remote Operations have no requirements.
- `rolePresets` maps `pm` to the PM pack IDs.
- `resolveSkillSelection({ ids = [], packs = [], all = false, capabilities = [] })` synchronously returns deduplicated IDs. Individual choices come first, then packs in requested order, then eligible manifest entries when `all` is true. Unknown IDs, unknown packs, malformed selections, and unmet explicit capability requirements throw. Capability presence does not select anything on its own. Inputs are not mutated.
- `validateSkillDocument(content, id)` synchronously validates a string or Buffer using the same ID and metadata rules as discovery, and returns `{ id, name, description, version }` or throws. It performs no file I/O and permits valid custom skill IDs. Validation establishes document format, not content safety, edit approval, or permission to write.
- `discoverSkills(directory)` resolves to local `{ id, name, description, version, status: 'installed' }` descriptors sorted by directory name. It includes valid custom skills, not only bundled IDs. An absent directory returns `[]` without creating anything. Ordinary files and directories without `SKILL.md` are ignored.
- `installSkills({ directory, ids })` resolves to `{ installed: [id], kept: [id] }`. Only explicitly selected bundled IDs can be installed. Duplicates are processed once in request order. An empty selection creates nothing.

`src/skill-packs.mjs` is the canonical selection manifest; the installer uses its deduplicated IDs. Always resolve untrusted pack or individual requests with actual host capabilities before calling the low-level filesystem installer. The installer deliberately retains its `{ directory, ids }` API: it copies inert instructions and neither detects host capability nor authorizes use. Directly copying the remote instruction document does not make remote execution available.

Existing selected skill directories are validated and reported as kept, never updated or merged. Their files remain byte-identical, including valid user edits and version differences. A malformed existing selected skill is an error, not a successful installation. Installation is not an upgrade or repair operation.

## Metadata format

Each bundled skill consists of one `SKILL.md`; its front matter includes the version. The selection manifest groups IDs but does not duplicate document descriptions or versions:

```yaml
---
name: example-skill
description: "Explain the exact task and when this skill should be used."
version: 1.0.0
---
```

For dependency-free, predictable discovery, metadata supports a deliberately narrow YAML subset: a flat mapping of single-line string scalars, plain or quoted, with optional blank lines and whole-line comments. Double-quoted values use JSON-compatible escapes; single-quoted values escape an apostrophe by doubling it. Additional flat scalar fields are allowed. Lists, nested mappings, block scalars, inline comments, duplicate keys, and missing required fields are rejected, not silently guessed. The name must match the directory's lowercase hyphen-separated ID, the description must contain 1–1024 characters, and the version must use a three-part semantic version with optional prerelease or build suffix.

Discovery reports filesystem installation only. It does **not** show whether a host has read, registered, enabled, or invoked a skill. Consult the intended host's actual supported workspace-loading mechanism and trust controls separately. Copying these files alone must not be presented as making them automatically available to a host.

## Filesystem guarantees and limits

IDs, directory paths, and metadata are validated. Unknown IDs, traversal IDs, parent traversal in the destination, filesystem roots, symlinks in existing path components, and selected skill-file symlinks are rejected. Discovery rejects symlink entries rather than following them. Existing selections are checked before any selected new skill is published.

Each absent skill directory is exclusively reserved. A complete, synced instruction file is published atomically with a non-replacing hard link; existing files are never opened for writing. The temporary file is removed after publication or failure. A filesystem without hard-link support produces an error, not a copy fallback. A reserved directory may briefly be visible without `SKILL.md`, and a crash may leave an incomplete directory requiring explicit inspection. There is no whole-batch transaction: a later I/O failure can leave earlier selections installed, and the call rejects instead of returning a success-shaped fallback.

Use a trusted local workspace directory whose ancestors are not being maliciously replaced. Portable path checks are not a security sandbox against concurrent hostile filesystem mutation. Concurrent installation into a reserved but incomplete directory may reject; inspect and retry after the first operation completes. Never delete or overwrite user content to recover automatically.

## Owner preparation and validation

Before using a skill, give its owner the outcome, authorized workspace and sources, excluded areas, desired artifact, acceptance check, dependencies, and approval boundary. Use only tools actually exposed by the host. Missing connectors or permissions remain missing even if a document describes a related workflow.

## Routing and authority examples

- A new initiative uses `kickoff-scoping`; an approved task does not repeat intake. A paused task uses `checkpoint-resume` and rechecks uncertain external effects before retrying.
- Combining feedback uses `research-synthesis`; exploring possible solutions uses `opportunity-discovery`; explaining a metric movement uses `metric-diagnosis`; planning a controlled test uses `experiment-planning`. None grants analytics access or launches a test.
- An existing requirements document uses `spec-review-update`; a new specification uses `pm-specs`. An update preserves concurrent edits and applies only authorized changes.
- A progress summary uses `stakeholder-updates`; an answer to a thread uses `reply-preparation`; verified user-facing changes use `release-notes`. Drafting any of these is not sending or publishing.
- `evidence-approval-review` checks support and authority without granting approval. `self-improvement` produces reviewable proposals, never automatic promotion into policy, installed skills, or durable behavior.
- `remote-operations` requires both a real capability and action-specific authorization. It provides no connector, credentials, provisioning, security changes, or permission to transfer private material.

All new instruction prose is original and neutral. No external skill text or assets are bundled by these additions. When applying the instructions to third-party material, preserve source attribution and license obligations; permission to inspect does not imply redistribution rights.

Run the focused checks from the repository root with `node --test tests/skills.test.mjs tests/skill-packs.test.mjs`. The tests use synthetic directories inside the repository, remove them afterward, and do not read or write global skill locations. Scenario checks verify routing, output, and authority contracts in the documents; they are not claims of live model or transport execution.
