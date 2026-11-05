# Runbook: <operation>

Status: Proposed
Owner: <responsible operational role>
Last verified: Not yet exercised
Scope: <environment and affected systems>

## Trigger

State observed conditions that justify this procedure and conditions requiring another runbook.

## Preconditions

Name access, target identity, tool versions, backup requirements and safety conditions. For destructive work, state affected data and required recovery evidence before any command.

## Diagnosis

Specify observations/commands proving the failure. Each runnable command block names working directory, shell, prerequisites and expected result. Label placeholders and avoid secrets.

## Procedure

Use numbered actions with an expected result and stop condition at each risky step. Distinguish reversible actions from effects requiring reconciliation.

## Verification

Prove service recovery and the affected user workflow. Record environment, revision, result and limitations after a disposable/staging exercise.

## Rollback

Describe reversal steps and limits. State what data or provider actions cannot be reversed automatically.

## Escalation

Name the responsible role and safe evidence to collect. Exclude tokens, credentials and personal records.
