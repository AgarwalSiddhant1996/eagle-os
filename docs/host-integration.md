# Connected host bridge

The stacked core runtime adds isolated owner routing, nonce-authenticated local
returns, honest scheduled proof and AI domain proposals. See
[Native owner orchestration](orchestration.md) for current contracts and executable
examples. The older preparation flow below remains supported for compatibility;
new isolated work uses `core-request`, not a child's foreign canvas callback.

## Narrow startup diagnostics

For the **individual Eagle extension process**, set
`EAGLE_STARTUP_DIAGNOSTICS=1` when investigating activation timeout. Do not change
other extensions, global settings or the host SDK. Default startup stays quiet.
Diagnostics write only fixed stage names and elapsed milliseconds to **stderr**,
never stdout (the SDK JSON-RPC transport), account/session identities, paths,
environment values, source data, capabilities or message bodies.

Stages distinguish local module evaluation, SDK import, synchronous canvas
declaration and the actual awaited `joinSession()`. An unresolved SDK import or
join emits one `*-pending` observation after five seconds; its unreferenced
diagnostic timer is cleared on resolution/rejection. It neither times out/retries
the handshake nor pretends that a pending join succeeded.

If logs reach `join-session-started`/`join-session-pending`, the wait is inside the
SDK parent-process startup/resume RPC, not workspace collection or owner routing.
If no `local-modules-loaded` marker appears with diagnostics enabled, inspect
bootstrap/resolution/local module evaluation before attributing it to joining.
These observations locate a wait only. Activation and a real owner return still
require separate live proof.

The native extension joins the owning Copilot session using the supported SDK.
It reads `session.sessionId` and submits **only**
`session.send({prompt, displayPrompt})`. A returned message id means submission,
not collection, source access, verification, or successful execution.

Standalone remains usable without the SDK. It reports `host.available=false`;
an attempted connection creates an explicit persisted blocked request and returns
HTTP 503. It never simulates a connector or queues work to a nonexistent host.
All mutable requests, source coverage, owner bindings, schedules and results live
in the external workspace user-data directory, not the extension installation.
No new dependency, bundled scheduler, credential storage, account installation,
global setting change or external sender is included.

## HTTP contract

Existing loopback capability-token, same-origin JSON, revision and atomic-write
protections apply. `GET state` additionally returns:

```js
{
  host: {
    available: true, sessionId: "owning-session",
    requests: [], sources: [], owners: [], inventory: null, selection: null,
    automation: null,
    remote: {status: "unverified", detail: "No remote capability has been checked."},
    brief: null
  }
}
```

Only availability/current session identity are derived from runtime; they are not
stored in `board.host`. All other host fields are persisted there. Existing
workspaces without `host` acquire it on their first host mutation, without
replacing existing work, notes, improvements or feedback.

`POST host-request`:

```js
{
  id: "caller-stable-random-id",
  kind: "setup",                 // inventory | connector | setup | collect | prepare | schedule | remote
  scope: {
    purpose: "Review repository changes",
    sources: ["repository"],     // repository | design | messages | documents | metrics
    repository: "sample/repo",   // optional short user-local hint
    cadence: "",                 // optional; required explicit consent for schedule
    worker: "",                  // optional selected remote identity
    inventoryRequestId: "inventory-one",
    selectedToolIds: ["repo-reader"],
    selectedRepoIds: ["repo-a"],
    excludedToolIds: ["optional-reader"], // optional persisted UI preference
    excludedRepoIds: []                  // optional persisted UI preference
  },
  consent: true,
  expectedRevision: 4,
  workId: "existing-work-id",    // optional; required for prepare
  sourceId: "existing-source"   // optional narrowing filter
}
```

Optional empty scope strings are normalized away. Source order is normalized;
at most five selected types are accepted. Purpose is bounded to 500 characters;
repository/cadence/worker to 200. Plain request/reference ids may be short ids or
UUIDs, at most 160 characters. Unsupported fields are rejected.

Before wizard completion, **setup only** may use the persisted
`onboarding.draft` purpose instead of `board.profile`. The draft must have reached
connections index 1 in `flowVersion:2` and contain PM role, title, one to three
jobs and decisions. The four indices are purpose 0, connections 1, skills 2,
review 3. Legacy saved indices 0..4 project once to 0,0,1,2,3; the server
returns normalized `flowVersion:2` and persists it on the next guarded write.
Legacy profiles normalize to PM and a supported PM preset without deleting
work, notes, model selections or installed user files. New invalid role/preset
inputs and client-supplied flow-version overrides are rejected.
New setup scopes lock actual selected inventory ids; draft source checkboxes are
not additional authority. Legacy setup without inventory still requires saved
source types and matching repository hint. This does not create a profile,
complete the wizard or seed synthetic cards; reload still resumes onboarding.
Collect, prepare, schedule and remote requests continue to require a configured
profile. Metadata inventory needs neither profile nor source selection; a
connector offer needs current inventory but does not require a finished profile.

Successful response: `{board, host, request, duplicate}`. An absent/failed host
submission returns the same saved state with HTTP 503 and `error`; UI should
refresh/poll safely rather than hide the failure. A source access denial is a
later typed callback, not an HTTP submission success claim.

A request is atomically persisted **before** `session.send`. Same id plus the
same normalized content returns the saved request without another send, even
with an old expected revision. Changed-content reuse returns 409. A new request
with a stale revision returns 409. A crash between persistence and SDK admission
does not cause automatic redispatch on restart or replay.

Request fields include:

```js
{
  id, kind, status, scope, workId, sourceId, at, updatedAt, detail,
  hostSessionId, ownerSessionId, ownerVerifiedAt, instanceId,
  sequence, callbacks, fingerprint, dispatchState, dispatchReceipt
}
```

### Setup terminal validation and exact-scope recovery

Setup `verified`/`partial` callbacks require real structured `sources`, with
current receipt-backed `evidence` for every actual read source and a valid
`workId` or `workExternalKey` relation. The native callback schema/prompt includes
a concrete minimal sources/work/evidence template populated with the selected
tool/repository bindings. Templates and prose counts are never read proof.
Invalid/empty terminal input does not commit the next sequence or any data;
correct that same next sequence from already observed results.

Actual failures use `result.blockedSources` entries:

```js
{toolId:"SELECTED_SOURCE_TOOL_ID",type:"repository",
 repoId:"SELECTED_REPO_ID",repo:"ACTUAL_CONFIGURED_REPO_NAME",
 status:"blocked",detail:"ACTUAL_RECORDED_DENIAL",httpStatus:403}
```

`toolId,type,status,detail` are required. Repository outcomes require exact
selected `repoId,repo`; other types omit both. Optional `httpStatus` is observed
401/403 only. No receipt or fake source ID is permitted. Every selected
source-capable tool/type and repository must be accounted for; metadata-only
tools do not count. Mixed genuine reads/failures can be `partial`; all-failed
selected setup must be `blocked`/`needs-sign-in` with populated typed failures.

Normalized descriptors appear in both `host.blockedSources` and
`host.requests[].blockedSources`:
`{id,toolId,type,name,label,status,detail,httpStatus?,repoId?,repo?,inventoryRequestId,requestId,recordedAt}`.
Name/label come from the selected inventory metadata, not source-read claims.
Known denial dispositions remain visible and cannot qualify as core sources.
Genuine partial setup can bind the hub only through its actual complete source
receipts and recorded current evidence; an empty rejected partial never qualifies.

For already-terminal broken requests, submit a different fresh setup ID with
`scope.recoveryOf` referencing that terminal setup and the **exact original**
locked scope/work/source/host binding. No scope expansion or terminal reopening
is allowed. `request.recovery={requestId,status,detail,blockedSources,deniedRegistrySources}`
is untrusted context, not instructions or read proof. Recovery preserves known
401/403/sign-in denials and rejects turning those bindings into read success;
it must not re-probe or sign in. Access resolution requires separate user action
and ordinary fresh scoped setup. Readable bindings alone can be repaired under
the explicit recovery consent.

Optional fields are omitted when not applicable. `status` starts `queued`, then
`running`, then one of `verified`, `partial`, `needs-sign-in`, `blocked`.
`partial` is terminal for that bounded read, not complete verification.
`dispatchState` is `unavailable`, `pending`, `accepted`, `inline`, `executing`,
`completed`, or `unknown`. A `pending` request has no admission acknowledgement;
do not infer it was never sent. `accepted` records the SDK message id when
available, but is not execution success. Scheduled inline requests execute in
the current host turn, without another SDK send.

If send throws without an execution callback, the request becomes blocked with
`dispatchState="unknown"` and a persisted uncertainty receipt. **Do not rotate
the id, retry, or submit the same schedule/worker operation under a fresh id.**
Recovery requires explicit inspection/decision outside this automatic bridge.
A later correctly bound callback can settle uncertain admission. Exact request
replay never redispatches. `needs-sign-in` and ordinary blocked callbacks also
do not automatically authorize a fresh operation or credential interaction.

## Detect-first metadata inventory

The lightweight automatic request is:

```json
{
  "id": "inventory-one",
  "kind": "inventory",
  "scope": {"purpose": "List tools and configured repository names", "sources": []},
  "consent": false,
  "expectedRevision": 0
}
```

`consent:false` is mandatory: registry availability listing is **not** source-read
consent. Inventory rejects source types, repository/worker/cadence scopes and
work/source references. It may run before source selection or profile creation,
using the saved wizard purpose when present or a generic workspace purpose.

The SDK inventory message is separate and short. Its **first action is
`get_host_request`**, which returns fresh state and a small inventory-only
prompt/schema. Terminal/replayed requests stop there. A fresh request then
acknowledges running and inspects supported available/deferred MCP/tool/server
metadata and optional configured repository **names only**. Safe tool-version
metadata and supported repository-name listing are permitted; account-wide
repository enumeration, project files, PR/issue bodies, mail/chat/spec/document
contents, auth/config bodies, tokens, auth probes, installs and sign-in are not.
No full external tool schemas or old source/work/evidence dumps are sent in the
inventory prompt. Missing inventory capability reports blocked, never a guess.
No connector catalog search or offer is authorized by inventory.

After sequence 1/running, the terminal input shape is:

```js
{
  workspace: "sample", requestId: "inventory-one",
  ownerSessionId: "owning-session", sequence: 2, status: "verified",
  detail: "Bounded metadata listing completed; source access was not checked.",
  result: {
    inventory: {
      tools: [{
        id: "repo-reader", name: "Repository metadata reader", provider: "host",
        sourceTypes: ["repository"], capabilities: ["read metadata"],
        status: "available", detail: "Registered; source authorization not checked."
      }],
      repositories: [{
        id: "repo-a", name: "sample/repo", status: "available",
        detail: "Configured repository name only."
      }],
      receipt: actualMetadataReceipt
    }
  }
}
```

The shared receipt shape applies; its `identity` is the actual owning host
session id, its method/readback describe only actual metadata inspection, and
its timestamp is fresh. Backend derives `requestId,status,at` and persists
`host.inventory={requestId,status,at,tools,repositories,receipt}`.

Maximum 80 tools and 30 repositories; tool ids/names and repository ids/names
are unique. Tool source types are the five known types or `[]` for pure host
capabilities. Capability strings are descriptive metadata, **not authority**.
Tool status is `available|needs-sign-in|missing|unknown`; repository status is
`available|needs-sign-in|unknown`. Available means registered/advertised, not
authenticated. Known sign-in/missing and uncertain entries remain separate
unchecked optional choices. Metadata inventory cannot produce a source read
receipt, activate `remote-worker`, or emit any source/work/evidence/owner/card/
task/schedule/remote/brief result. Truncation is terminal partial, not complete
inventory verification; partial inventory cannot authorize setup selection.

A newer inventory request supersedes older inventory callbacks and prevents
new setup using an older inventory id. Identical callback replay remains a
no-op. Setup selection requires the latest verified inventory from the same
owning session and canvas instance.

### Locked selected tools and repositories

New setup adds:

```json
{
  "purpose": "Review selected repositories",
  "sources": ["repository"],
  "inventoryRequestId": "inventory-one",
  "selectedToolIds": ["repo-reader"],
  "selectedRepoIds": ["repo-a", "repo-b"],
  "excludedToolIds": ["optional-reader"],
  "excludedRepoIds": ["repo-not-selected"]
}
```

Use actual returned ids; all selected entries must be available. Every requested
source type must be supported by a selected tool. `sourceTypes:[]` grants no
account access. Checking a write-capable tool never authorizes write execution.
Repository source scope requires selected configured repository ids. Optional
`repository` must be a selected name; omit it for multiple selected repositories.
No default repository or account-wide search is inferred.

`excludedToolIds`/`excludedRepoIds` are optional, known-id, unique and disjoint
UI preferences, bounded to 80/30. They persist on the setup request in external
user-data, so UI can restore committed exclusions when browser origin/storage
changes. They are **never read authority**; access depends only on the locked
selected ids. Pre-Connect browser edits are not persisted by this backend.

Setup records a locked selection snapshot. Source callbacks in that scope add
the exact selected `toolId`, and repository sources also add `repoId` with its
actual configured `repo` name:

```js
{
  id: "repo-source-a", toolId: "repo-reader", repoId: "repo-a",
  type: "repository", label: "Selected repository", repo: "sample/repo",
  status: "verified", detail: "Actual scoped metadata read.",
  coverage: {complete: true, detail: "Selected scope inspected."},
  receipt: actualRepositoryReadback
}
```

Backend derives each source's `inventoryRequestId` and `lastReadAt`. Current read
receipts for **every** selected in-scope repository are required before
setup/collect can report verified. A source id cannot be rebound to a different
tool/repository. Inventory availability never substitutes for these readbacks.

Collect, prepare and schedule inherit the exact locked selected ids when omitted.
Provided ids must match exactly; expanded/excluded ids, repository names or
source types are rejected. Registry entries from unchecked tools/repositories
cannot re-enter via broad source types, nor can their work/evidence be included
in the generated scoped prompt. Refreshing inventory alone does not broaden
existing consent: existing collection remains pinned to the original snapshot.
A new explicit setup changes consent and invalidates older in-flight source
callbacks and saved collector bindings.

Legacy source setup without inventory is allowed **only** on boards with no
inventory, selection or selected source bindings. Once detect-first inventory
exists, omitting ids cannot fall back to legacy setup/collection/scheduling.
An inventory-bound setup selecting only pure host capabilities may have
`sources:[]`; it creates no source read receipts or data authority.

### Optional native sign-in/catalog offer

Only an explicit selected required missing/sign-in capability can dispatch:

```js
{
  id: "connector-one", kind: "connector", consent: true, expectedRevision: 4,
  scope: {
    purpose: "Offer this selected required integration", sources: [],
    inventoryRequestId: "inventory-one",
    selectedToolIds: ["missing-reader"], selectedRepoIds: []
  }
}
```

The one selected descriptor must currently be `missing` or `needs-sign-in`.
Available/unknown descriptors, source scope, multiple tools and repository
selection are rejected. Consent authorizes **only** an appropriate existing
native host sign-in/catalog **offer**, after available/deferred metadata and
reasonable alternatives are checked. No automatic sign-in, install, credential
access, source read, broad catalog crawl or external send is authorized.

Terminal `result.connector` is:

```js
{
  toolId: "missing-reader", status: "offered",
  detail: "The matching native approval UI was actually presented.",
  instruction: "Review that host approval card; nothing was installed.",
  receipt: actualHostOfferReceipt
}
```

Request status verified means offered **only**, not authenticated/connected.
Receipt identity must equal the selected tool id. Without an actual UI offer,
return connector/request status `needs-sign-in` or `blocked`, exact plain
instructions, and no receipt. The result persists on `request.connector`.
It does not change inventory availability, source status or locked selection.
An inventory refresh is needed to observe subsequent availability changes.

## Native canvas actions

These are instance-scoped actions, not globally installed tools:

* `get_host_request({requestId})` returns `{request,prompt}`, including the exact
  selected scope, known references, required callback binding and JSON schema.
* `record_host_result(input)` validates and persists a compact typed result.
  Returns `{revision,request,counts:{sources,work,evidence,cards}}`.
* `request_collection({workspace,id,scope})` is the schedule-wake entry point
  described below. It returns a fresh persisted request and executable prompt.

Invoke with the existing supported `invoke_canvas_action` tool:

```js
{
  instanceId: "review-panel",
  actionName: "record_host_result",
  input: {
    workspace: "sample",
    requestId: "setup-one",
    ownerSessionId: "owning-session",
    sequence: 1,
    status: "running",
    detail: "Starting scoped capability discovery.",
    result: {}
  }
}
```

The **first callback must be sequence 1/running with empty result**. Subsequent
sequences must be consecutive positive integers. Replaying the same sequence and
identical JSON content is a no-op, including after completion; changed replay,
skips, stale callback, wrong workspace/request/host/instance or stale owner
binding returns 409. A completed request cannot be reused for another run.
HTTP `command` rejects all `host_*` commands; a browser cannot claim ownership
or bypass typed callbacks.

Every prompt names the exact action, instance id, request id, expected owner,
JSON schema and limits. It asks the host to inventory available **and deferred**
capabilities before source reads. Only purpose-relevant selected sources are
authorized. Repository discovery uses bounded read-only gh/git metadata.
Access blocks remain explicit; sign-in, authorization bypass, account/connector
installation, credential persistence and unrelated source reads are forbidden.
A missing connector may only be offered through supported host catalog/approval,
after checking existing capabilities and reasonable read-only alternatives.
Offering a connector is not installation or read permission.

## Typed terminal result

Input always has the envelope above, with `sequence:2`, terminal `status`,
honest `detail`, and a `result` object containing only the allowed fields below.
The exported `hostResultSchema` is the machine-readable canvas input schema.
Runtime validation applies tighter field, cross-reference and status checks.
Each object rejects extra keys. No arbitrary board replacement is accepted.

Shared structures:

```js
receipt = {
  identity: "actual inspected identity",
  readback: "compact result actually read back",
  readAt: "ISO timestamp from this read",
  method: "supported tool or read-only command used"
}
coverage = {
  complete: true,
  detail: "All consented scoped pages were read",
  cursor: "optional opaque non-secret continuation marker"
}
```

Receipt timestamps must be real and not future-dated; fresh source/evidence/
owner/schedule/remote reads cannot predate the request beyond five seconds of
clock tolerance. A source being configured or stored is never a read receipt.
Source access blocked during a later run may retain its previous `lastReadAt`,
but loses any current verified receipt/status.

| Result field | Shape and constraints |
|---|---|
| `sources` | Up to 40 `{id,type,label,status,detail,coverage,repo?,receipt?,toolId?,repoId?}`. Type must be selected. Inventory-bound sources require selected `toolId`, and repository sources require selected `repoId`/name. Status: `verified`, `partial`, `blocked`, `needs-sign-in`. Verified requires a receipt and complete coverage; partial requires a receipt and incomplete coverage. Blocked/sign-in requires incomplete coverage and no receipt. Repository `repo` and receipt identity must match the selected configured name (and optional narrower repository hint). `lastReadAt` and inventory binding are derived by backend, never browser time. |
| `work` | Up to 40 `{sourceId,externalKey,title,nextAction?}`. Requires a source read in this callback. Creates a stable item once per `(sourceId,externalKey)`; subsequent reads preserve local status, next step, notes and owner display. A work-scoped request cannot introduce unrelated workstreams. |
| `evidence` | Up to 40 `{sourceId,externalKey,workId? ,workExternalKey?,summary,url?,receipt}`. Requires actual current source and item read evidence. Choose `workId` **or** `workExternalKey`; external references are scoped by `sourceId`. Existing ids and unmentioned fields survive updates. Evidence cannot move workstreams. The compact read receipt supplies verification, not overall page-completeness claims. |
| `owners` | Up to 40 `{sourceId,workId?,workExternalKey?,sessionId,name,url?,receipt}`. Actual read-only session metadata and workstream binding readback is required; receipt identity equals `sessionId`. Produces `{workId,sessionId,name,url,status:"verified",verifiedAt,receipt}`. Owner URL may be HTTPS or the exact returned native `app_url` matching `ghapp://sessions/<uuid>` or `ghapp://chats/<uuid>` only, without credentials, port, query, fragment or extra path. Never construct a fallback app URL. UI `work.owner` is only display text, never an owner registration. |
| `cards` | Up to 20 `{sourceId,externalKey,evidenceId?,evidenceExternalKey?,title,why,options,recommendedIndex,afterDecision,kind?,consequences?,draft?}`. Only `prepare`. Evidence must be actual existing verified source evidence for the requested workstream, not a synthetic/manual claim. Two to four options; recommendation names one. Optional kind `decision` or `draft`; draft requires `{channel,target,text}` and is **never sent**. Stable source/external-key cards, including resolved cards, are not recreated or overwritten. |
| `tasks` | Up to 40 `{sourceId,externalKey,workId?,workExternalKey?,title,sourceUrl?,dueDate?}`. Stable ids and local completion survive reruns. Optional date is a valid calendar date; URLs must be secure and credential-free. |
| `brief` | `{headline,lines}` with at most five compact lines. The server supplies `at` on successful persistence. Requires current read evidence, or an evidence-backed owner preparation request. |
| `automation` | Exact verified schedule readback described below. Never invented from cadence alone. |
| `remote` | Capability-gated remote verification described below. |

Use actual observed ids, timestamps and readbacks; examples here are shapes,
not real collection evidence. Native URL/ref fields must be secure links;
credentials and known credential strings/secret keys are rejected recursively.
Keep results under 60,000 serialized characters. Summaries are bounded (generally
500–1,000 characters); ids/labels/titles use smaller limits. A validation failure
does not write any of the callback's updates.

Allowed result fields per request:

* `inventory`: `inventory` metadata only, never source content.
* `connector`: `connector` offer/instruction only, never source content.
* `setup`/`collect`: `sources,work,evidence,owners,tasks,brief`.
  Collect uses **existing** registered source ids and cannot invent sources.
  A scheduled collect may also refresh `automation` by actual schedule readback.
* `prepare`: `cards,tasks,brief`, restricted to the currently registered owner,
  selected sources and requested workstream.
* `schedule`: `automation`.
* `remote`: `remote`.

Blocked/sign-in callbacks cannot carry collected work, evidence, owners, cards,
tasks, automation or brief. They may describe blocked source access or the exact
remote capability failure. Partial source reads can preserve individually read
evidence, but the request/source remain partial; complete verification requires
current complete receipts for every selected source.

### Example: source read and owner registration

After the running acknowledgement, call `record_host_result` with:

```js
{
  workspace: "sample", requestId: "setup-one", ownerSessionId: "owning-session",
  sequence: 2, status: "verified", detail: "Selected metadata and update read back.",
  result: {
    sources: [{
      id: "repo", type: "repository", label: "Selected repository",
      repo: "sample/repo", status: "verified", detail: "Identity and update inspected.",
      coverage, receipt: repositoryReceipt
    }],
    work: [{sourceId: "repo", externalKey: "review-a", title: "Review changed item"}],
    evidence: [{
      sourceId: "repo", externalKey: "change-a", workExternalKey: "review-a",
      summary: "The read update needs a review decision.", receipt: changeReceipt
    }],
    owners: [{
      sourceId: "repo", workExternalKey: "review-a", sessionId: "owning-session",
      name: "Review owner", receipt: ownerSessionReceipt
    }]
  }
}
```

Evidence/source URLs remain HTTPS-only; the narrow native app-link exception
applies only to registered owner URLs.

Each named receipt above is a distinct actual readback using the shared shape;
`ownerSessionReceipt.identity` is `owning-session`.
Then submit `kind:"prepare"` for the persisted work id. The owning host prepares
locally only when its session matches the registered owner. Otherwise it must
discover supported internal session messaging and route to that exact owner.
The owner may send a compact result back to the original host, which records it
through this bound instance; do not assume another session can invoke a foreign
canvas instance. Missing routing capability is blocked, never reassignment.
Changing/removing a registered owner invalidates an in-flight preparation.

## Saved collector: executable future runs

Only **same-session conversation automation** is supported. The host must
discover supported `save_session_automation` and `get_session_automation`
capabilities, save the approved cadence in the owning session, and read it back.
Ambiguous cadence, unavailable native canvas reopening, missing automation/
readback capability or absent actual next-run metadata must return blocked.
`save_workflow`/new-session scheduling is deliberately blocked: there is no
cross-session callback registration mechanism to pretend is connected.

Verified callback:

```js
result: {
  automation: {
    id: "actual-saved-id", name: "Scoped collector",
    cadence: "approved exact cadence", status: "enabled",
    lastRunAt: null,             // or actual observed last-run timestamp
    nextRunAt: "actual read-back next-run ISO timestamp",
    coverage, receipt: scheduleReadback,
    sessionId: "owning-session", provider: "session-automation"
  }
}
```

`receipt.identity` must equal the exact saved id; cadence must equal the approved
scope string and coverage must be complete. Server records `verifiedAt` from
the actual receipt plus the originating host/instance, consent scope and optional
work/source narrowing filters. Schedule verification does **not** invent a
successful collector run; `lastRunAt:null` stays null until an actual readback.

The generated host prompt requires saving this executable durable wake sequence:

1. In the **same owning session**, use supported `open_canvas` with
   `canvasId:"eagle-os"`, the original `instanceId`, and
   `input:{workspace:"sample"}`. This reopens a closed panel and recovers its
   persisted external workspace. Never assume a closed instance is still live.
2. Invoke `request_collection` on that instance:
   `{workspace:"sample",id:"fresh-random-id-for-this-wake",scope:{purpose,sources,repository?}}`.
   The action checks current saved schedule identity, host/instance and exact
   consent scope; it automatically retains any saved work/source filters.
3. Execute the returned bounded collect prompt **in this turn**. It first
   records sequence 1/running, discovers allowed tools, performs actual
   incremental reads from registry cursors/`lastReadAt`, then records the
   matching typed terminal callback. No second `session.send` is issued.
4. If supported, read back that exact schedule again and include `automation`
   to refresh actual `lastRunAt`, `nextRunAt`, coverage and `verifiedAt`.
   If readback is unavailable, retain the previous metadata with its old
   verification timestamp and report the gap; never substitute current time.

A wake cannot broaden sources/purpose/repository or callback to the terminal
setup/schedule request. Duplicate wake ids do not enqueue/send again; an already
terminal wake returns instructions not to rerun it. Changed host identity,
missing/disabled schedule, wrong instance or unavailable reopening blocks the
wake. Extension/session restarts are not proof that a schedule still exists:
same-session readback and callback binding remain required.

## Remote status

A remote request first discovers an actual supported adapter/capability, then
performs a read-only identity/status check for the selected worker:

```js
result: {
  remote: {
    status: "verified",
    detail: "Selected worker identity/status actually read back.",
    capability: "actual supported identity/status capability",
    identity: "selected-worker",
    receipt: actualRemoteReadback
  }
}
```

Receipt identity must match the worker and selected `scope.worker`.
Without a real read use terminal request status `blocked` and remote status
`missing-capability`, `disconnected` or `blocked`, with exact missing capability
and detail, **without** receipt/verifiedAt. A later disconnect replaces stale
verified remote state rather than leaving a green connection badge. No worker
security changes, unpause, replay or command execution is authorized here.

## Local command compatibility

* `setup_progress.draft` also accepts `connectionMode` (`connect`, `manual`, or
  empty), up to five selected `sourceTypes`, and a short `repository` hint.
  Connected setup can use `intake`; the acknowledged synthetic example remains
  exclusive to manual `onboard_complete`.
* `card` optionally accepts `kind`, `consequences`, and a local-only `draft`.
* `resolve` accepts `response` instead of a numeric choice and records it
  locally. It never dispatches, approves an external send, or sends a draft.
* `task` optionally accepts a secure `sourceUrl`.

## Validation and limits

`node --test tests/host-integration.test.mjs tests/host-sdk.test.mjs` exercises
HTTP → atomic request persistence → supported SDK adapter invocation → typed
source read → owner registration/preparation → ready card, denial/partial pages,
request/callback replay, stale owners, unknown admission, exact schedule
readback, reopened-panel scheduled collection, remote disconnect and independent
workspaces. These are **deterministic adapter/SDK-contract tests**, not live MCP
collection, sign-in or a real scheduled job.

The host remains the source-access and tool-permission boundary. Receipts are
validated host attestations, not cryptographic proof that a tool ran. No external
source is queried by this backend itself; missing capabilities stay blocked.
There is no automatic recovery of ambiguous SDK admission, cross-session
scheduler, new-account installation, credential management or remote executor.
