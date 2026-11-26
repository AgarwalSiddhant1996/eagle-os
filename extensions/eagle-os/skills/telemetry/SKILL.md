---
name: telemetry
description: "Define a product telemetry contract with events, firing rules, safe properties, and validation. Use when asked what to measure or log for a feature; not to claim instrumentation exists or authorize data collection."
version: 1.0.0
---

# Telemetry

## Start with the decision
Identify the product question, intended analysis, population, funnel or outcome, and privacy constraints. Inspect an authorized event inventory or code when supplied. Reuse an existing event only when its semantics and firing rules match; label every unverified candidate explicitly.

## Specify a small contract
For each necessary event, provide a table with:
- Event name and whether it is existing, proposed, or unverified.
- User or system action and the exact firing boundary.
- Conditions that must not fire it, including canceled and failed actions.
- Event owner or emitting surface, if known.
- Properties with types, allowed values, nullability, and meaning.
- Deduplication rule or the reason duplicate delivery is harmless.
- Purpose, validation method, and privacy or retention review needed.

Use the project's verified naming convention. If none exists, propose a consistent convention and label it proposed. Distinguish an attempt, confirmed success, and failure rather than treating a tap as a completed outcome. Describe how retries, repeated views, background execution, and cross-surface delivery affect counts when relevant.

## Data boundaries
Collect only properties needed for the stated decision. Do not log message text, names, email addresses, secrets, precise locations, or raw user-entered content. Do not invent identifiers to join datasets. Any proposed identifier, retention period, consent change, or cross-service join requires the appropriate privacy and security review. A hashing suggestion alone does not make personal data anonymous.

## Measurement and validation
Define numerator, denominator, eligibility, time window, and exclusion rules. Separate descriptive adoption from causal impact; an event trend is not proof of incrementality. Document missing baseline or consent-related coverage rather than assigning a numerical target.

Validate one successful flow, a cancellation, a failure, and a retry or duplicate path against the contract. Check types, allowed values, absence of sensitive payloads, and agreement across emitting surfaces.

Deliver the event table and measurement definitions as a proposal. Do not edit tracking settings, transmit sample personal data, or describe events as deployed without authorization and runtime evidence.
