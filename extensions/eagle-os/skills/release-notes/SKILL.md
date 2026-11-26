---
name: release-notes
description: "Draft user-facing release notes from a verified release scope and authorized engineering summaries. Use for what changed in a named release; not for generic stakeholder reporting, promising unshipped work, or publishing without approval."
version: 1.0.0
---

# Release notes

## Trigger and routing
Use when asked for release notes or user-facing change text for a specified release. Use stakeholder-updates for project progress and reply-preparation for an answer in a conversation. Do not infer that every recently merged change shipped in the requested release.

## Verify scope
Identify the release, platform, audience, language, distribution surface, and source of truth. Use supplied release summaries, included changes, and rollout evidence. Distinguish shipped, staged, limited rollout, experimental, reverted, and planned changes. When inclusion or availability is unknown, flag it for confirmation rather than presenting it as universal.

Translate verified changes into user benefits and concrete behavior. Preserve important eligibility or platform limits. Do not invent performance improvements, fixes, availability dates, or numerical claims. A technical refactor is not automatically a user-facing feature.

Group related improvements, lead with the most meaningful supported change, and keep wording proportional to its actual impact. Avoid internal project names, private issue details, individual attribution without permission, and implementation trivia. Do not expose security-sensitive details from an unreleased fix; request the appropriate disclosure decision.

## Review
Check each statement against the included scope and the requested channel's length and formatting rules. Follow a supplied house template without copying third-party release prose. Mark unresolved inclusion questions separately. If sources contain no meaningful user-facing changes, say so instead of manufacturing a feature headline.

## Output and authority
Return a clearly labeled release-note draft and a compact verification list connecting claims to sources, plus any availability caveats or open questions. Drafting does not authorize store submission, publication, release configuration, or messaging users. Verify the exact approved destination and action before publishing through a real available tool.
