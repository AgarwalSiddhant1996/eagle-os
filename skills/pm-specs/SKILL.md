---
name: pm-specs
description: "Write a product requirements specification or turn an agreed problem into scoped user stories and acceptance criteria. Use for a requested product spec; not for silently choosing roadmap priority or claiming stakeholder approval."
version: 1.0.0
---

# Product specifications

## Scope first
Capture the target user, problem, desired outcome, decision owner, known constraints, and current evidence. Distinguish an open problem from a chosen solution. If the user has approved scope, work within it instead of repeating discovery. If evidence is missing, label an assumption and explain how it can be checked.

## Build the specification
Use these sections, keeping each proportionate to the decision:
1. **Problem and evidence:** describe the unmet need, affected population, current workaround, and source-linked observations. Do not infer demand from a single anecdote without saying so.
2. **Outcome and measurement:** define a primary outcome, baseline if known, measurement window, and guardrails. Leave unsupported numerical targets explicitly undecided.
3. **Proposed experience:** explain the entry point, main path, completion state, failure states, and recovery. Include accessibility, permissions, empty states, and offline behavior where relevant.
4. **Scope and alternatives:** state what is included and excluded. Compare at least one credible alternative when the solution is not already locked. Explain trade-offs rather than presenting preferences as facts.
5. **User stories and acceptance criteria:** tie each story to a user need. Write observable criteria using given conditions, user action, and expected result. Include the most important denial and recovery cases.
6. **Delivery and open decisions:** identify dependencies, rollout controls, rollback conditions, unresolved questions, and owners when supplied. Separate product requirements from unverified implementation suggestions.

## Supporting work
Use telemetry guidance for event contracts and flowchart guidance for complex branches if those skills are available. Do not invent analytics events already deployed, API capabilities, estimates, or implementation details. Mark engineering feasibility and stakeholder agreement as unverified until supported.

## Boundaries and finish
Minimize personal data in examples and measurement proposals. Flag any new collection, retention, access, or consent requirement for review. A specification is a proposal, not authorization to build, publish, spend, or change policy. Obtain the appropriate approval before expanding scope or editing a shared source of record.

Deliver a readable draft with evidence links, clearly marked assumptions, testable acceptance criteria, and a short list of decisions actually needed.
