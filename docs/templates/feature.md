# Feature: <capability>

Status: Proposed
Owner: <responsible team>
Last verified: Not yet verified
Scope: <included behavior>

## User outcome

Name the actor, action and observable success. Explain why this behavior is needed.

## Scope

List included behavior, explicit exclusions and dependencies. Distinguish existing behavior from this proposal.

## Rules and ownership

State invariants, permissions, record scope and the module owning each write. Explain what breaks if callers bypass that owner.

## States and transitions

Name legal states, triggers, guards and rejected transitions. Add a focused Mermaid state diagram for lifecycle-heavy behavior and a decision table for condition combinations.

## Contracts

Link the authoritative input/output source. State units, missing-record behavior, errors and compatibility requirements. Label examples runnable or illustrative and use fictitious data.

## Persistence and concurrency

Specify indexes, conditional updates, transaction/session boundaries, idempotency identity and concurrent-loser behavior. Identify external effects outside the transaction.

## Failure behavior

Cover invalid input, denied scope, missing records, duplicate requests, races, timeout, ambiguous provider success and crash recovery.

## Verification

List acceptance cases and appropriate unit/HTTP/database/provider/device layers. Record commands, prerequisites, expected results and unverified dependencies.

## Delivery

State migration, rollout and rollback, including data/external effects that code rollback cannot reverse.

## Open questions

Assign each unresolved decision an owner and explain which work it blocks.
