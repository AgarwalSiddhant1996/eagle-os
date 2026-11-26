# Purpose-first onboarding

Eagle OS is for product managers. A new workspace opens four focused steps: purpose, connections, skills and first value. Each explains what it sets up and how it helps your PM work.

1. What are your top three recurring jobs?
2. Which daily decisions or ready-to-review outputs do you need?
3. Which optional sources hold the evidence, and which may this workspace read?

The guide asks purpose, a connection choice, skill opt-in and a result review. A compact settings drawer handles later name/model edits and skill packs. Progress checkpoints locally, so reloading resumes rather than erases it.

## Connect or try a demo

The connection step automatically asks the owning host chat for a lightweight availability inventory. It lists enabled/available MCPs, tool capabilities and configured repository names only. It does not read message, mail, file or spec content, inspect credentials, start authentication or install anything.

Available tools and repositories start checked. Uncheck any to exclude them, then approve **Connect selected tools** for the displayed read-only checks. The browser does not call private MCP endpoints directly. Each request is persisted before SDK dispatch, and only its matching typed callback can complete it.

Known missing, sign-in-needed or unknown entries are separate and unchecked. Sign-in help or Add from catalog asks the host to present the appropriate supported action. It cannot grant permissions or install a connector automatically. If the host cannot establish a status from safe metadata, it remains unknown.

The host inventories available/deferred tools, checks the selected repository or source identities and reports access evidence. Missing authentication is a needs-sign-in result, not an empty success. The host can offer a relevant missing connector through its supported catalog and approval flow; it must not install one or sign in automatically. Unknown or blocked sources remain visible.

Connected setup ends with the actual results. It does not create a synthetic first card or pretend the host's accepted message is a completed source read. Work owners prepare real review cards after source evidence is recorded.

**Explore with sample data** performs no source check. It creates one clearly labelled sample card before marking only that example verified. Old configured workspaces remain configured and are never silently reseeded.

Standalone has no connected chat bridge. Use the manual demo there, or open a native canvas to dispatch host requests. See [host integration](host-integration.md) for callback, retry and permission rules.

## Presets

| Preset | Typical jobs | Outputs |
| --- | --- | --- |
| Feature PM | Delivery planning, asks, release decisions | Work list, evidence, ready decision cards |
| Experiment & Metrics | Experiment inventory, guardrails, readouts | Metric evidence with explicit windows and decision cards |

Presets never bind a company, repository, account, endpoint or credential. Any external tool uses the same adapter contract. A local file reader is an adapter too, not a privileged back door.

## Project ids are not session ids

A project id identifies the configured source/execution project. A session id identifies one conversation/actor. Do not copy the current session id into project configuration. Leave project id empty when no project is required; a later runner must verify the actual project before creating work.

## Task-to-model roles

| Tier | Appropriate work |
| --- | --- |
| Fast | Approved mechanical fetching, file writing, small edits and readback |
| Mid | Standard preparation, everyday review and routing |
| Complex | Ambiguous product decisions, high-impact policy, architecture and new specs |

Choose actual available model ids in the local profile. There are no bundled model defaults. Existing explicit selections and user choices win; never silently switch a running owner or move complex judgment to a fetch runner. An unavailable model is a reported prerequisite, not permission to substitute it.

## Acceptance before real use

On an isolated workspace, add one synthetic work item and verified evidence, prepare one valid decision card, reload and resolve it. Then record a blocked source and confirm Today does not claim everything is clear.

For a real source, obtain access consent and inspect one authorized update end to end. Preserve true source identity and timestamp, deduplicate repeats, then prepare a card only if an actual user choice is needed. A source read, queued owner and ready card are different stages.

Connected setup offers a real isolated-owner pilot before finishing. It uses the approved source scope and opted-in skill guidance; directory existence or an accepted prompt does not complete the pilot. Workable readiness follows the validated returned result.

Today asks which source-backed workstream to route when there is more than one. To define your own work, add it in Work, then choose a real read source and relevant recorded facts in its detail. Approve that context binding before asking for an isolated owner. The original source evidence stays intact; your work metadata remains user-owned.

No schedule starts automatically. Finishing opens Today directly, where **Set up morning brief** opens the schedule drawer when you are ready, or you can keep refreshing on demand without disabling an existing schedule. Daily verification waits for provider scheduled-trigger proof and the changed-owner return. Remote accepts a separate read-only identity/capability check of an existing worker. Neither grants authority for external messages, worker reconfiguration or arbitrary new work.

Why: a scheduled read keeps Today current each morning without manual source checks. When: enable after at least one actual source read is verified and recurring triage is useful. How: the host reads approved sources, routes changed work to isolated owners and prepares review cards; nothing sends externally on its own. The host must remain online and support scheduling.

Setup cannot finish as readable/partly readable with an empty structured result. Missing records produce an actionable callback error before the request becomes terminal. A legacy empty result shows a warning and Re-run connection check on the final step. Retry creates a fresh request within the saved scope; known access denials stay blocked.

Today, Work and Improvements are the default navigation. Settings holds Connections, Automation and Skills. To add a specialized tab, describe the PM job, choose real read sources and review the AI's exact declarative manifest. Approval adds a local view, not new permissions or generated executable code. See [orchestration](orchestration.md) for owner and schedule proof contracts.
