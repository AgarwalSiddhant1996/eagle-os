# Data and release boundaries

Shared code contains no accounts, company endpoints, filled personal profiles, board data, source captures, private feedback, browser profiles or auth state. Keep them outside the checkout and installation.

Only invented examples belong in tests and documentation. Do not paste private text into a supposedly safe sample. Links and screenshots can leak identities too; documentation PNGs under `docs/assets/` are chunk-checked to forbid embedded text, EXIF or timestamp metadata, and arbitrary binary files fail the release tree check rather than being silently skipped.

## Sanitization

```sh
npm run check
node scripts/sanitize.mjs --release --history --rules=<external-private-rule-file>
git config core.hooksPath .githooks
```

The optional external rule file has `{"forbiddenTerms":["sample-corp","example-person"]}` using your actual private deny terms locally. Never commit that file. `EAGLE_PRIVATE_RULES` can point to it without putting private text on a command line.

The pre-commit hook requires the external rule pack and runs tests. CI runs structural URL, credential, email, path, opaque-id, runtime-state and file-type checks over the tree/history without embedding organization vocabulary or reversible token digests in public source. Release clearance additionally needs your complete external private term pack (`--rules` or `EAGLE_PRIVATE_RULES`) and human review. CI cannot certify unknown private names without that context. A missing private pack must never be reported as a full publication check.

Findings print only file, line and category, never the matched credential or private value. Review exact synthetic fixture exceptions in code; there is no broad ignore or corporate-domain allowlist. Public dependency origins and synthetic example hosts are the only default URL exceptions.

Use the complete reachable commit history and release tree, not just changed files. Inspect commit authorship and required attribution separately: an account owner and author metadata are not file contents and cannot be made invisible by a text scan.

Before any public release, rerun private rules, inspect all refs/assets/logs, verify rights/dependency terms and obtain explicit visibility approval. A private repository is not permission to upload sensitive material. If anything sensitive was pushed, stop distribution and use the appropriate incident/removal/credential process; deleting the current file does not erase its history.

## Threat boundaries

The server binds only to loopback, uses a high-entropy local capability path and requires same-origin tokened JSON for mutations. Treat anyone with local-machine access as able to access local files. Adapter modules are trusted user-approved executable code, not a sandbox. No secrets are requested or stored by the scaffold.

Selecting a decision option only writes local state. Entering the native connection step can dispatch one metadata-only inventory to the owning host agent; this can use a model turn but cannot ingest source content or inspect credentials. Source reads, connector offers and schedule configuration need their separate applicable consent. No external message sender or automatically enabled collector is included.

Improvements keeps selected feedback and exact patch proposals in external workspace state. It does not upload lessons or mine chat histories. Approval-gated application can edit an existing workspace-local skill; global skills, bundled templates and application code are never targets of that writer. External-file readback and scenario results are explicitly labelled assertions unless the app actually read the workspace skill. See [the improvement lifecycle](improvements.md) for recovery and concurrency limits.
