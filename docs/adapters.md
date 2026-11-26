# Optional source adapters

All external tools are peers. The engine has no branch for one employer, tracking product, design product, analytics service or local file system.

Keep adapter modules and their endpoint configuration outside the code folder under the user-data root. Authentication belongs in your supported credential facility, never in the code repository or workspace JSON.

Create user-local `adapters.json` to make descriptors available in intake:

```json
[
  {
    "id": "sample-source",
    "label": "My optional source",
    "capabilities": ["read"],
    "module": "<absolute local connectors module path>"
  }
]
```

A descriptor only declares capability; it is not proof of access or safe execution. The web app lists it without loading code. v1 does not expose a browser route that executes adapters.

For an explicitly approved local runner:

```js
export const apiVersion = 1;
export async function read({ window }) {
  return {
    records: [],
    status: "partial",
    terminal: false,
    nextCursor: "opaque continuation",
    window
  };
}
```

`readAdapter` requires explicit approval, a declared read capability and realpath-contained code under `<data-root>/connectors/`. The module is trusted executable code, not sandboxed. Inspect and approve it before execution. No external connector implementation ships with the scaffold.

Record source identity, actual timestamps, true source links and precise coverage in adapter outputs. A nonterminal result cannot claim complete. Access denial, authentication failure, unsupported data shape or unavailable capability must remain visible, not become an empty successful feed. Never bypass source permissions or retry a denied effect through another adapter.

Files use the same permissioned boundary and should have their own allowed roots. The generic engine does not grant arbitrary local-file reads.

Adapter ingestion and automatic owner routing are future capabilities. Until explicitly implemented and approved, use local evidence records and the card preparation contract. Do not describe a descriptor as a working connection.
