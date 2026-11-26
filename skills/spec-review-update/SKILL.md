---
name: spec-review-update
description: "Review an existing requirements document or prepare a bounded update against its current source of record. Use for spec gaps, acceptance criteria, and approved amendments; not for silently creating a new initiative or overwriting concurrent edits."
version: 1.0.0
---

# Specification review and update

## Trigger and routing
Use when a requirements document already exists and the user requests review or a scoped amendment. Use product-specification guidance for a wholly new specification and kickoff-scoping for an undefined initiative. A request to review is read-only; it does not authorize applying every recommendation.

## Review
Read the current authorized source and record its revision when available. Compare the problem, evidence, scope, user journey, acceptance criteria, measurement, dependencies, rollout, and unresolved decisions. Look for contradictions, untestable criteria, missing denial or recovery states, and requirements that lack an evidenced user need.

Report findings with a source section, concrete impact, and proposed resolution. Distinguish a blocking inconsistency from a suggestion or missing information. Do not invent engineering feasibility, delivery dates, stakeholder approval, or a legal conclusion. Retain source attribution and minimize personal information in examples.

## Prepare an update
Show the smallest proposed amendment and explain any change to scope, behavior, measurement, or authority. Keep requirements separate from implementation guesses. Preserve unrelated sections, comments, links, and valid user edits.

Apply only a specifically authorized change to the authorized destination. Re-read the current source immediately before writing or use a revision check supported by the tool. If it changed, reconcile intentionally or stop with the conflict; do not overwrite concurrent edits using an old full-body draft. Do not move or duplicate the source of record without permission.

## Output
For review, return prioritized findings, proposed wording, and open decisions. For an authorized update, return the actual change, source revision or location, validation performed, and any remaining gap. A preview is not a saved update. Do not claim comments, publication, or downstream synchronization happened unless verified.
