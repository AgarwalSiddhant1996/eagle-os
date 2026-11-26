---
name: experiment-planning
description: "Design a testable product experiment with a falsifiable hypothesis, success metric, guardrails, and decision rules. Use for experiment planning; not for launching tests, selecting winners from noisy data, or inventing traffic and power estimates."
version: 1.0.0
---

# Experiment planning

## Trigger and routing
Use for a requested controlled test or evaluation plan for a proposed intervention. Diagnose an unexplained baseline movement before prescribing a test. Route an undefined product problem to opportunity discovery. A written experiment plan does not configure or launch a test.

## Design
State the user problem, evidence, intervention, control, and falsifiable hypothesis. Define eligible participants, exclusions, exposure event, allocation unit, and randomization unit. Check for spillovers between participants and choose an appropriate unit for shared experiences. Describe variant differences without silently adding scope.

Define one primary success metric with numerator, denominator, observation window, and direction. Add guardrail metrics for plausible harm, such as reliability, abandonment, privacy, or accessibility. Separate exploratory measures from decision measures. Reuse verified instrumentation; mark missing contracts rather than inventing deployed events.

Specify the baseline, minimum meaningful effect, uncertainty threshold, traffic assumptions, and duration only where supported. When inputs are missing, list what is needed for a power or sample-size calculation instead of manufacturing numbers. Plan checks for allocation imbalance, logging integrity, contamination, and incomplete exposure.

Predeclare stopping conditions, analysis timing, treatment of multiple comparisons, and a decision rule covering success, harm, inconclusive results, and measurement failure. Do not repeatedly peek and stop at a favorable result. Include rollout and rollback considerations without assuming permission to deploy.

## Output and authority
Return a reviewable experiment brief with hypothesis, variants, population and unit, metric definitions, guardrails, instrumentation gaps, analysis plan, decision rule, risks, and approvals needed. Label unknowns. Obtain authorization for collection changes, user exposure, configuration, or launch; capability access is not approval. Minimize sensitive data and avoid manipulative or unsafe treatments.
