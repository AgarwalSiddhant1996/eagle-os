# Native owner orchestration

Eagle OS persists one source-bounded assignment before messaging its owning
Copilot chat. The extension uses only SDK `session.sessionId` and
`session.send({prompt,displayPrompt})`. The **host agent** discovers and calls
actual App `create_session`, `get_session`, `send_session_message` tools.
There is no Node `createSession` service, timer, deployed model or outbound sender.

## Queue and ownership

Same-origin authenticated `POST core-request`:

```js
{
  id: "review-one", workId: "actual-work-id",
  goal: "Prepare one source-backed review",
  sourceIds: ["actual-registered-source-id"],
  tier: "mid", consent: true, autoPrepare: false,
  expectedRevision: 12
}
```

`workId` may be omitted only when exactly one eligible real workstream exists.
Each source requires an actual complete read receipt and current selected consent.
Manual/synthetic evidence cannot satisfy this check. A finished profile OR a
validated saved PM review index 3 with `flowVersion:2` is required. A review pilot
does not create a profile or mark onboarding complete.

The first core request binds the hub to the exact SDK session/instance that
already verified connected setup. Subsequent HTTP writes, host results, core
events, card actions and inbox drains require that binding. Opening the same
workspace in another session does not become its writer. Binding recovery is
not automatic. Direct local CLI/filesystem access is a **trusted user boundary**,
not an identity-protected multi-user service.

`GET state` adds `core` and `views`. Core jobs contain goal, tier, status, actual
owner identity/link, generation, assignment ID, scope/source versions and receipt
details. Callback capability hashes are omitted from HTTP/native read responses;
raw capabilities are never stored in board JSON. Model selection is the explicit
`profile.models[tier]` or `"inherited"`; actual used model remains `"unknown"`.
Explicit selections require actual configuration readback and never silently
downgrade. Existing owners/models/generations are reused, not replaced.

One assignment runs at a time. Changed-work manifests persist in `core.deltas`;
quiet receipt timestamps do not create work. An existing source-owned title or
evidence content can change, but personal notes, status, next action, completed
tasks, resolved cards and exclusions are retained.

### Explicit user-defined Work context

Add work creates a nonsynthetic `origin:"user"` row without claiming a source
read. Before routing that row, approve its exact real context through the existing
authenticated, revision-guarded `POST command` endpoint:

```js
{
  command: "work_bind",
  expectedRevision: 12,
  payload: {
    workId: "actual-user-work-id",
    sourceId: "actual-registered-source-id",
    evidenceIds: ["actual-host-ingested-evidence-id"],
    confirmed: true
  }
}
```

The target must be active, nonsynthetic, source-unbound user work—not a
source-owned record. The source needs current selected consent and a complete
actual read receipt. Explicitly select one to ten verified, nonsynthetic evidence
records from that exact source's original ingested work. Excluded sources,
manual assertions, unknown IDs and active/routed conflicting owner bindings
cannot satisfy the guard. Existing context cannot be reassigned; identical
confirmation is idempotent.

Host ingestion records `evidence.hostIngestion={requestId,sequence}` and the
accepted host request's `evidenceIds` ledger. Binding checks both against the
actual terminal setup/collect callback. Evidence without this provenance,
including older unmarked records, requires a genuine bounded collector read
before it can be selected; do not manufacture a ledger entry or synthetic receipt.
This additional guard does not change normal source-owned work/version semantics.

The saved user Work shape is:

```js
{
  id: "actual-user-work-id", origin: "user",
  title: "User's own purpose", status: "active", owner: "User",
  nextAction: "User's own next step",
  sourceId: "actual-registered-source-id",
  sourceContext: {
    kind: "approved-source-context",
    sourceId: "actual-registered-source-id",
    evidenceIds: ["actual-host-ingested-evidence-id"],
    scopeVersion: "actual-current-consent-fingerprint",
    boundAt: "2026-11-20T12:00:00Z"
  }
}
```

`work.sourceId` is the approved primary context source; `origin:"user"` and
`sourceContext` distinguish it from source-owned ingested work. `externalKey`
remains absent. Source evidence is referenced,
not duplicated or moved; its original `sourceId`, `workId`, receipts and stable
external key remain intact. Existing user title/owner/status/notes/next action
are preserved. The explicit user `workId` now qualifies for `core-request`.

An owner may return only the approved evidence IDs for this user work. Its card
uses the user `workId`, the original `evidenceId` and `contextWorkId` identifying
the original evidence work. Optional `record_card.payload.workId` uses the same
guard. Unrelated work cannot borrow evidence merely by knowing an ID.

Selected-context content/status changes affect the user's source version and
enter the existing scoped standing-consent delta queue alongside source-owned
work. Unselected records, read timestamps and user notes do not wake its owner.
Changed source consent, invalid evidence provenance or a stale assignment
prevents routing/late returns. A binding is context approval, not permission
expansion, a fabricated source read, or automatic external sending.

## Native actions

Call these through the bound hub canvas, not from a child:

* `get_core_request({jobId})`: fresh persisted assignment and executable tool
  instructions. No owner/source effects occur merely from reading it.
* `record_core_event`: typed actual tool/capability receipts.
* `record_work({})`: validate/drain local inbox and advance one queued delta.
* `record_scheduled_wake`: same-session provider-attested wake proof.
* `prepare_scheduled_check`: preregister a fresh isolated one-time owner check,
  described below. This action itself does not save or run a schedule.

Examples of `record_core_event` payloads:

```js
{jobId:"review-one",type:"routing",detail:"Starting actual owner routing."}

{
  jobId:"review-one",type:"owner_created",detail:"Created and read back owner.",
  owner:{sessionId:"actual-owner-id",name:"Review owner",
    appUrl:"https://example.test/actual-returned-owner-link",
    executionLocation:"local"},
  receipts:{
    create:{tool:"create_session",callId:"actual-call-reference",
      sessionId:"actual-owner-id",readAt:"2026-11-20T12:00:00Z",
      detail:"Actual create tool returned this identity."},
    inspect:{tool:"get_session",callId:"actual-readback-reference",
      sessionId:"actual-owner-id",readAt:"2026-11-20T12:00:01Z",
      detail:"Actual App metadata returned this identity and app_url."}
  }
}

{
  jobId:"review-one",type:"capabilities",detail:"Inspected actor access.",
  checks:{
    skills:{status:"verified",accessMode:"guidance-read",
      method:"Explicitly read approved workspace SKILL.md",
      detail:"File guidance, not native-loaded skills.",
      readAt:"2026-11-20T12:00:02Z"},
    sourceAccess:{status:"verified",method:"Actual actor tool/scope inspection",
      detail:"Actor can perform this exact bounded source read.",
      readAt:"2026-11-20T12:00:02Z"},
    model:{status:"verified",method:"Actual owner metadata/default check",
      detail:"Inherited existing host default; used model unknown.",
      readAt:"2026-11-20T12:00:02Z"}
  }
}

{
  jobId:"review-one",type:"message_accepted",
  detail:"Supported App message accepted; owner result still pending.",
  receipts:{message:{tool:"send_session_message",
    callId:"actual-message-call-reference",sessionId:"actual-owner-id",
    readAt:"2026-11-20T12:00:03Z",detail:"Actual internal acceptance receipt."}}
}
```

For reuse, use `type:"owner_reused"` with the exact existing owner/generation/
configured model and `receipts.inspect` (no create receipt). `configuredModel`
is required when an explicit chosen model must be proved. It is omitted/empty
only when metadata genuinely does not expose an inherited configuration.

`type:"blocked"` / `"cancelled"` take only jobId, type and detail. Interrupted
routing does not retry uncertain create/send effects. The host recovers from
actual receipts or records a blocker. SDK admission alone is not owner completion.

Tool receipts are **bound hub-agent attestations of actual tool readback**, not
cryptographic App provenance. Unsupported tools/readbacks must remain blocked.
An existing source tool advertisement alone does not establish child access.
Skills may be explicitly read opted-in guidance (`guidance-read`) or genuinely
registered/read back (`native-loaded`). Directory existence alone is neither;
behavioral skill-use proof remains separately unknown.

## Executable local return path

Each assignment installs a write-once helper and private per-assignment grant
under the external workspace `callbacks` directory, never in Git. Only the
registered owner receives its grant path through the bounded assignment.
The grant contains a random `callbackCapability`. It is an assignment nonce,
not OAuth. Do not print it, put it in artifacts, or include it in messages.

The owner pipes compact result JSON to the full paths supplied by
`get_core_request`. PowerShell example (replace paths/bindings from that action):

```powershell
@'
{"workspace":"sample","jobId":"review-one","assignmentId":"actual-assignment-id","workId":"actual-work-id","ownerSessionId":"actual-owner-id","ownerGeneration":1,"sourceVersion":"actual-bound-version","status":"completed","detail":"Source-backed review prepared.","evidenceIds":["actual-evidence-id"],"card":{"evidenceId":"actual-evidence-id","title":"Choose the review path","why":"Source evidence needs a decision.","options":["Review now","Ask for context"],"recommendedIndex":0,"afterDecision":"Save locally; nothing sent."}}
'@ | node "<external-workspace>\callbacks\owner-inbox.mjs" --grant "<external-workspace>\callbacks\<actual-assignment-id>.json"
```

The helper reads the private grant internally and writes one immutable inbox
envelope. It prints only submission status, never result/grant bodies. A repeated
identical submission is idempotent; changed content is rejected. The child never
writes `board.json` and need not invoke a foreign canvas. It can notify the hub
through actual internal App messaging to call `record_work`.

Result fields are workspace/job/assignment/work/owner IDs, ownerGeneration,
sourceVersion, status, detail, evidenceIds, optional card or
`artifact:{title,url,evidenceId}`, and at most five
`tasks:[{title,dueDate?,sourceUrl?}]`. Completed work needs a verified source-backed
card/artifact. Blocked output cannot claim ready cards/tasks. Drafts remain local.

The hub validates capability, exact assignment/owner generation, current source
scope/version and evidence before committing under the existing board lock.
Wrong capabilities, stale/cancelled assignments, changed replay and out-of-scope
writes are rejected. A senderSessionId string or notification is not authority.
Read polling only drains validated inbox entries; it does not run source reads or
dispatch new LLM work. `record_work` advances pending consented deltas.

Write-once files and permission modes prevent accidental replacement; they do
not defend against a malicious same-account filesystem administrator. The CLI
is explicitly a trusted local boundary. No cloud callback/shared-path assumption
is implemented: nonlocal owners remain blocked.

## Daily mode and an isolated timed check

Existing `POST host-request` kind `schedule` accepts exact narrowed
`scope.sourceIds` and explicitly checked `scope.autoPrepare`. The same-session
collector locks both fields. Saving/readback is `daily-configured`, not verified.
Actual `nextRunAt` can be null when the provider exposes none; it is never invented.

For a completed same-session collect, `record_scheduled_wake` takes:

```js
{
  scheduleId:"actual-saved-id",requestId:"fresh-completed-collect-id",
  runId:"actual-provider-run-id",trigger:"schedule",
  receipt:{tool:"get_session_automation",callId:"actual-tool-reference",
    sessionId:"actual-hub-id",readAt:"2026-11-20T12:05:01Z",
    detail:"Provider exposed scheduled trigger for this run.",
    scheduleId:"actual-saved-id",runId:"actual-provider-run-id",
    trigger:"schedule",startedAt:"2026-11-20T12:05:00Z"}
}
```

Daily verification also requires the scoped changed-owner result return. A
manual Run now, local clock, schedule save or last-run timestamp alone is not
scheduled-trigger proof. Missing provider trigger/run metadata stays unverified.
Local app/session must remain online; no independent always-on service is claimed.

After a real owner pilot, `prepare_scheduled_check` accepts the same core request
fields (without autoPrepare) and current revision. It creates a **fresh**
assignment/grant without an SDK send. Its prompt uses the existing isolated owner.
After owner reuse and capability checks, the host discovers actual child
`get_session_automation`/`save_session_automation`; requires no prior automation;
saves one local `interval:"once"` check within one hour; reads it back; then emits:

```js
{
  jobId:"fresh-timed-job",type:"owner_schedule",detail:"Exact test read back.",
  schedule:{id:"actual-child-schedule-id",sessionId:"actual-owner-id",
    provider:"session-automation",interval:"once",runAt:"2026-11-20T12:10:00Z",
    status:"enabled",executionLocation:"local",previousAutomation:"none"},
  receipts:{save:{tool:"save_session_automation",callId:"actual-save-reference",
    sessionId:"actual-owner-id",readAt:"2026-11-20T12:06:00Z",detail:"Actual save."},
    inspect:{tool:"get_session_automation",callId:"actual-inspect-reference",
      sessionId:"actual-owner-id",readAt:"2026-11-20T12:06:01Z",detail:"Exact readback."}}
}
```

Send the child only a registration/acceptance notice now, not a manual work
instruction. Record actual message acceptance. The saved timed prompt performs
the bounded reads on wake and returns through this fresh local grant.

Its completed result additionally includes
`sourceReads:[{sourceId,receipt:{identity,readback,readAt,method},coverage:{complete:true,detail}}]`
for every exact approved source and, **only when actual provider metadata exposes
it**, `scheduledWake:{scheduleId,runId,trigger:"schedule",startedAt,receipt}`.
That receipt uses the same fields as above but the owner session identity.
The backend verifies matching schedule/run/trigger/time/source bindings.

`core.scheduledCheck.status` reports configured/verified separately. A verified
one-time child test does not enable a daily collector or change on-demand mode.
If the child scheduler lacks run-trigger readback, its source-backed return can
complete while the timed-check proof remains configured/unverified. Never reuse
terminal assignments or capabilities. Remove the exact disposable automation
through actual host tools after the test; do not alter unrelated schedules.

`daily_not_now({confirmed:true})` records an on-demand choice only when no
existing schedule exists. It cannot pause/remove/replace a live schedule.

## Domain boundary

`host-request` kind `domain` uses current locked inventory/selection plus
`scope.domainPurpose` and narrowed verified `scope.sourceIds`. Consent authorizes
schema proposal only, not new reads or broader permissions. A terminal bound
callback can return `result.domainProposal:{title,why,manifest}`. The backend
validates the manifest and exact source subset before `view_propose`.

HTTP allows guarded approval/rejection/removal/restoration only. It rejects
`view_propose` and `view_rows`, as well as every `host_*`/`core_*` spoof.
Custom view activation is separate from source consent. Collecting custom
`domainRows` is not enabled in this adapter; missing live records remain explicit.
