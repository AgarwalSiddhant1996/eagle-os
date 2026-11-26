---
name: model-tiering
description: "Choose an appropriate reasoning or execution tier when the user requests routing advice or delegates a choice. Use for capability, cost, and latency trade-offs; never override an explicit model selection."
version: 1.0.0
---

# Model tiering

## Trigger and limit
Use when asked to recommend a tier, or when an authorized task genuinely requires a model-routing decision. Do not change runtime settings on the strength of this document. There are no bundled model names, providers, or default selections.

## Decision procedure
1. Preserve any explicit model choice, provider constraint, privacy restriction, budget, or latency target. If that choice cannot perform the task, explain the mismatch and request a decision; do not silently substitute.
2. Inspect only model options actually available to the current host. If options or pricing are unknown, give capability-based advice and label cost estimates unavailable.
3. Classify the work by uncertainty and consequence, not word count:
   - Routine extraction, formatting, and bounded checks: prefer an available efficient tier when no explicit choice exists.
   - Synthesis across conflicting evidence or moderate implementation work: consider a balanced reasoning tier.
   - Ambiguous architecture, difficult debugging, or high-consequence reasoning: consider a stronger reasoning tier, with independent validation of critical claims.
4. Keep deterministic checks in ordinary local tools where available. More reasoning is not a substitute for running a relevant test or checking a source.
5. State the selection, why it fits, expected limitations, and an escalation trigger. Escalate after an observed failure or missing capability, not merely because another tier exists.

## Evidence and boundaries
Use measured latency and published pricing only when sourced and current; otherwise mark them unknown. Never move private inputs to a different provider or retention regime without authorization. Obtain approval for a material cost increase or changed data boundary. Do not launch parallel models or repeated attempts to bypass a limit.

## Output
Provide a short recommendation: constraints honored; available tier selected; rationale; validation; escalation condition. Distinguish a recommendation from an actual setting change, and report a change only if the host confirms it.
