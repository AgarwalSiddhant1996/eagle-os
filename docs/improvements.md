# Learn from friction without silent rewrites

Improvements stores selected corrections, recurring friction and proposed patches in the current workspace's external data directory. No source feeds, chat histories or global skills are imported. No lesson or private feedback is published with the extension.

## Capture and review

Use **Report friction** from a decision card, the error message or Improvements. Record the expected behavior, observed behavior, workflow and optional selected evidence. Review the text before saving. Keep secrets and sensitive source content out of feedback.

An occurrence key identifies one incident. Retries with the same key and content count once; changed-content reuse is a conflict. The local detector groups distinct retained occurrences by normalized workflow and category. It proposes a pattern to inspect after two reports. It does not infer a proven cause, inspect private conversations or measure precision/recall. Two reports may share a cause or may be unrelated.

Prepare a proposal from selected feedback. Separate observed facts from a possible cause. Specify the exact before and after text and the original failure scenario to repeat. The review card appears in Improvements and, while proposed, in Today. An unchanged set of reviewed feedback does not keep resurfacing as a new pattern. A new occurrence can justify another review; identical previously proposed/rejected patches are not automatically recreated.

Feedback text can be deleted locally. Deletion leaves an occurrence tombstone so a retry does not resurrect it. Existing proposal text is a separate record and remains local; deleting feedback does not redact its prior proposal. An approved proposal must first be deferred or rejected before its evidence can be deleted.

## Separate stages

`captured -> proposed -> approved -> applied -> verified`

Captured describes a feedback record. Proposed through verified describe its linked patch review. These are separate records so multiple incidents can support one change.

| Stage | Required evidence |
| --- | --- |
| Proposed | Selected feedback, observed facts, exact before/after text and original failure scenario |
| Approved | Explicit review of that exact patch, bound to its content fingerprint |
| Applied | Workspace file readback or an explicitly labelled manual application receipt |
| Verified | A separate recorded test of the original scenario with a passing result |

Reject and defer are separate choices with reasons. Deferred proposals can return to review. A failed scenario result is recorded and leaves the patch applied, not verified. Nothing auto-promotes into a rule.

## What the app can edit

For an installed workspace skill, the app can replace only its `SKILL.md` after approval. It validates metadata, rejects path traversal and links, holds the workspace mutation lock, checks the current revision, compares the full before text again and reads back the result. If the user edited that skill since the proposal, application fails without overwriting their text. Bundled templates and global skills are untouched. Normal extension/pack updates continue to keep installed workspace copies unchanged.

External editors must not edit the same skill during application. The board lock coordinates app writers, not unrelated processes. The final before-text check detects ordinary concurrent changes, but is not an operating-system lock on every external editor.

Rules, extension code and other files are **review-only**. The app shows the patch but cannot apply it. Use the normal repository or editor review process, then provide application evidence and the SHA-256 of the exact after text read back from that target. The app checks the hash against the proposal; it does not independently inspect the external file. This is a manual assertion, not an external verification receipt.

Approval never grants source access, external sends, deployment, remote execution or code-merge authority. A source containing instructions or a local pattern count cannot approve its own patch.

## Failure and recovery

Patch publication and board persistence are separate filesystem operations. A process/storage failure between them can leave the file changed while the board still says approved. The error remains explicit; do not retry by weakening the before-text check. Inspect both exact versions and the saved proposal, then prepare a new reviewed recovery change if necessary. A leftover lock also requires inspection, not blind deletion.

The proposal retains the previous text for a reviewed reversal. There is no automatic rollback or arbitrary code updater. Do not equate a new skill file with a loaded host skill: refresh/rediscover it through the approved host before running the verification case.

## Portable guidance versus runtime

The `self-improvement` skill explains how to select evidence, identify a repeat, prepare a reviewable patch and verify the original scenario. The extension implements local storage, bounded grouping and stage checks. No model is invoked by the detector, and no scheduler or remote patch runner is bundled.

The loop starts with user-selected feedback and error reports. It does not automatically mine all evidence or error history. Unknown or unrecorded incidents remain unknown.
