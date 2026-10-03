# Agent claim protocol v1

Scope: SF-A00-T07.1–8, SF-A00-T24 and SF-A00-T25. This is orchestration tooling for Node 22+ and GitHub CLI; it is not a runtime ABI and never qualifies a browser or native runtime.

## Authority and identity

An agent ID has 3–80 lowercase ASCII characters, starts with a letter, and contains at least one namespace separator (`-`, `_`, `.`). A session must use a unique ID, for example `codex-p4-planning`. GitHub authentication remains the caller's responsibility; this identifier is an audit identity, not a credential.

The atomic creation of `refs/heads/agent/<task-id>` is the claim's linearization point. The ref points to an immutable Git commit containing `claim.json` with owner, task, issue, implementation branch, generation UUID, sequence, precise expiry, heartbeat and lock keys. Claim refs contain coordination metadata, never implementation commits. Losing claimants may have created unreachable Git objects, but never write project fields, labels or comments. Duplicate-ref HTTP 422 is a conflict, not permission to overwrite. Ref updates are fast-forwards.

GitHub Projects is the visible projection of that record. **Agent**, **Branch** and **Lock keys** are text; **Lease expires** is a date, so it is not precise enough to enforce an hourly lease. The record's ISO timestamp is authoritative. **Status** has the live Project 4 options Backlog, Ready, Claimed, In progress, In review, Blocked and Done (inspected October 3, 2026). A legacy field-only claim remains reserved and requires manual migration; it is never silently replaced.

## State transitions

| Transition | Actor and preconditions | Project writes | Labels / evidence |
| --- | --- | --- | --- |
| Backlog → Ready | Planner after required merged contracts qualify; leaf has no active claim | Status=Ready | Clear status:blocked after resolving blocker |
| Ready → Claimed | Claimant; open leaf, no native sub-issues, no existing owner/ref, readiness check passes | Agent, Branch, Lease expires, clear Lock keys, Status=Claimed | Add agent:claimed; structured claim event |
| Claimed → In progress | Current owner, unexpired record | Status=In progress | Keep agent:claimed |
| In progress → In review | Current owner; implementation committed and PR available | Status=In review, Evidence=PR and test evidence | Keep owner until merge/release |
| Claimed/In progress/In review → Blocked | Current owner with named blocker | Status=Blocked | Add status:blocked; record blocker in handoff |
| Blocked → In progress | Current owner, blocker resolved and lease valid | Status=In progress | Remove status:blocked |
| In review → Done | Integrator after merged evidence and qualification | Status=Done, Evidence=merged commit + results | Release reservations; preserve merge evidence |
| Any owned non-Done state → Ready | Owner release, or explicit reconciler with reason and handoff | Clear Agent/Lease/Lock keys, optionally preserve Branch | Remove agent:claimed/lease:expired/status:blocked; release event identifies actor |
| Any owned state → same state, expired | Reaper; exact expiry passed | Ownership remains unchanged | Add lease:expired once; record heartbeat, branch head and held locks |

Claim/heartbeat/lock/release/reap are executable commands. Progress/review/block/Done transitions are project integration actions; this version does not infer merge completion. `release.js` returns unfinished work to Ready; do not use it to mark merged work Done. Never claim an Epic or a task with children. Dependency readiness is a separate hook supplied by the dependency tooling; setting Ready manually does not constitute evidence that a prerequisite merged.

## Concurrency and recovery

Task operations use `agent-ops/<task-id>` refs as mutexes. Lock acquisition also atomically creates `agent-locks/<key>` containing the claim generation, so locks are exclusive across all projects in this repository. The `planning/contracts/locks.json` registry lists valid names and path globs. The same owner may acquire a key repeatedly. Unknown keys and a second owner fail naming the holder. Expiry does not free keys. Different repositories do not share these locks.

A failed API call keeps the ownership ref reserved. Retry the owner operation, or explicitly release with `--reconcile --reason`. Release scans all registered lock refs, including keys whose field write failed; clears projections and labels; and deletes the claim ref last. Implementation branches are never deleted. If a process is killed while holding an operation mutex, an integrator must verify the process is stopped, inspect the mutex and claim generations, and explicitly remove only that operation ref before reconciliation. No TTL-based mutex theft is safe while a live process might still write.

Project updates are multiple API mutations, not a distributed transaction. A partial failure can leave stale visible fields; the claim record wins. Structured comments are an audit projection; immutable claim records survive comment-write failures until release. An incomplete comment history is reported as such by audit rather than invented. GitHub Projects does not expose general field history through this client; imported history can be supplied to `reconstructAudit`.

## Retry policy

`gh-retry.js` retries HTTP 429, secondary/abuse 403, and 500/502/503/504 with bounded exponential jitter (five attempts by default). Authentication/validation errors are permanent. Server Retry-After is honored; a requested delay beyond 30 seconds defers with exit code 75 instead of retrying too soon. Hard failures exit 1. Page queries are capped at 50 items, avoiding aggregate queries across every project. GraphQL node/resource overflow halves the outer page size down to one; irreducible overflow exits 65. Deterministic schema errors are not retried.

## Capability and examples

| Capability | Implementation | Evidence |
| --- | --- | --- |
| Atomic leaf ownership and expiry | Git refs + Projects client | 50 seeded concurrent fake API races |
| Shared hot-file reservations | Atomic lock refs | Two-task race and failed-field recovery |
| Heartbeat, explicit release, reaper | Commands in scripts/planning | Owner rejection, comment throttling, expired ownership retained |
| Audit and retry | Structured events, injectable transport | Timeline reconstruction, bounded secondary-limit faults |
| Production GitHub semantics | REST API version 2022-11-28 | Source contract; live mutation race is not run by tests |

Run `node scripts/planning/testing/walkthrough.js` for a claim-to-release example that performs no live network writes. Run `node --test planning/contracts/tests/claim-race.test.js` after the full task scope is implemented. The top-level test file also registers this suite with `npm test`.

See [Git refs REST API](https://docs.github.com/en/rest/git/refs?apiVersion=2022-11-28) and [Projects GraphQL API](https://docs.github.com/en/graphql/reference/objects#projectv2). Qualification must distinguish the in-memory fake transport from live GitHub service verification.
