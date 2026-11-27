# GitHub-native YARDHUB twin — phased delivery and release gates

**Status:** execution plan; PR #3 remains open and draft.  
**Scope:** DOWNTIMEUI only. The protected `aka30art/DOWNTIME` repository, its branches, workflows, Pages deployment, Supabase project, credentials and production records are explicitly out of scope.

## Delivery rule

Deliver in independently testable phases. Each phase must have implementation, automated tests, browser acceptance evidence and a recorded exit decision. Do not merge PR #3, deploy the twin as an operational system, copy production records, or switch primary authority until every production gate below is satisfied. A passing build or mocked GitHub API test is not a production gate.

## Current phase board

- **Phase 0 — PARTIAL, source census advanced:** the seven Edge service entrypoints, 96 action/read surfaces, 19 current service RPCs, all 39 live-inventory tables and five Storage buckets are catalogued. All 45 tracked migration files are SHA-pinned. The SQL scan identified 26 distinct functions, five triggers, RLS/policy/grant semantics and one missing tracked definition for live table `downtime_reports`. The 49 applied versus 45 tracked migration versions and complete export/relationship census remain unresolved.
- **Phase 1 — PARTIAL:** GitHub Git Data persistence, atomic multi-table commits, backup/restore, checksum validation, compare-and-swap retry and authority preflight/recheck exist with mock-backed tests. Real private-repository contention, rate limits, protected-branch behaviour, complete binary restore and crash recovery are unproven.
- **Phase 2 — BLOCKED:** the source code repository is public; no dedicated private YARDHUB data repository or protected broker credentials are available. Browser-held Contents access is not a staff security boundary.
- **Phase 3 — NOT STARTED:** a GitHub Actions issue-comment broker remains a candidate only. No trusted private request broker has been provisioned or tested end-to-end.
- **Phase 4 — NOT STARTED:** seven handlers build/register and local smoke tests exercise a small subset. The 96 action/read surfaces still lack exhaustive implementation, response, permission, audit and Storage parity evidence.
- **Phase 5 — NOT STARTED:** the independent USER/STAFF/ROOTS/YARD ROLE and module acceptance matrix has not been demonstrated against a trusted broker and two real users/devices.
- **Phase 6 — PARTIAL FOUNDATION ONLY:** backup runner and restore primitives exist, but no full source export, missing `downtime_reports` schema, live private data destination, clean-device restore or continuous checkpoint/reconciliation proof exists.
- **Phase 7 — NOT STARTED:** no real replication checkpoint, freeze/promotion, reverse transfer or rollback rehearsal.
- **Phase 8 — NOT STARTED:** release acceptance is blocked by open critical/high security findings and the missing private infrastructure.

A detailed source-backed finding register is maintained in [GITHUB_NATIVE_SECURITY_AUDIT.md](GITHUB_NATIVE_SECURITY_AUDIT.md). The action/RPC/table/Storage inventory is in [GITHUB_NATIVE_SERVICE_PARITY_MATRIX.md](GITHUB_NATIVE_SERVICE_PARITY_MATRIX.md), and the 45-file source migration and schema-drift inventory is in [GITHUB_NATIVE_MIGRATION_INVENTORY.md](GITHUB_NATIVE_MIGRATION_INVENTORY.md). Their unresolved security/schema findings block operational activation.

## Phase 0 — Baseline and scope lock

- Pin the source YARDHUB baseline and the DOWNTIMEUI target commit for every audit.
- Complete the inventory of all UI routes, user actions, Edge Function endpoints, RPCs, tables, triggers, RLS policies, storage buckets, Realtime consumers, scheduled jobs and exports.
- Build a traceable feature-to-handler-to-table-to-permission-to-test matrix.
- Keep `yardhub/reference/` immutable as the source snapshot; make all runtime changes only under DOWNTIMEUI's implementation paths.
- Exit: every source capability is accounted for, with unknowns explicitly listed.

## Phase 1 — GitHub-only data and authority contract

- Retain stable IDs, schema versioning, append-only audit/event history, bounded shards, idempotency, optimistic concurrency, checksums and snapshots.
- Exercise real Git refs and real private repository operations, including simultaneous writers, stale commits, retries, rate limits, branch protection and partial failure.
- Validate atomic multi-table semantics and crash recovery against GitHub itself, not only mocked fetch responses.
- Exit: real-repository concurrency and recovery tests pass, and no operational data has been written to a public repository.

## Phase 2 — Private data repository and identity boundary

- Provision a dedicated private operational data repository. Never reuse `aka30art/DowntimeUI`, `aka30art/DOWNTIME` or `aka30art/DOP-website`.
- Define how an authenticated human identity is established, how it maps to a DOWNTIMEUI USER, and how USER is kept separate from STAFF.
- Define protected ROOTS authority and YARD ROLE rights (VIEW, ENTER, EDIT, MANAGE) for every department/module.
- Enforce authorization at the trusted write boundary for every read and mutation; UI hiding is not enforcement.
- Never distribute a repository-wide token to browser users. Memory-only token handling is not an authorization boundary.
- Exit: a user cannot read or mutate records outside their assigned permissions, even by calling the data endpoint directly; actor attribution is verified and auditable.

## Phase 3 — GitHub-native request broker feasibility

GitHub Pages is static and cannot hold a server secret or run request-time authorization. A GitHub Actions broker is asynchronous and is not automatically a secure API. Before adopting it, prove all of the following in a disposable private test repository:

1. Operators can submit requests without receiving repository Contents access or a reusable privileged credential.
2. The workflow derives the caller identity from a GitHub-authenticated event, not a caller-supplied actor field.
3. The workflow loads the authoritative user/role mapping from a protected source and rejects unknown, suspended and insufficiently privileged actors.
4. Every operation is validated server-side against module, action, record scope and current authority epoch.
5. Untrusted input cannot modify workflow code, secrets, permissions or the authoritative role map.
6. Results are delivered privately to the authenticated caller; public issues, logs, artifacts and caches never contain private operational data.
7. Replay, duplicate dispatch, forged payload, workflow cancellation, stale authority, rate-limit and concurrent-write cases are tested.
8. End-to-end latency and throughput meet explicitly measured operational requirements.

If the GitHub-only broker cannot meet these conditions, stop the multi-user production path. Do not weaken authorization to claim GitHub-only success. Record the technical limitation and keep the browser-direct adapter restricted to isolated development/testing. Any alternative runtime must be separately approved before implementation.

## Phase 4 — Runtime service parity

- Replace the compatibility harness with a tested service layer for all seven existing service surfaces: Central Bank, Central Config Admin, GATELOG, Photo Evidence, R&M, Spectator Read and YARD HUB Settings.
- Test every endpoint/action, success and error response, validation rule, audit event, permission check, transaction boundary and file reference.
- Keep original UI/reference assets separate from the GitHub-native runtime; activate modules only after their service contracts pass.
- Exit: every endpoint in the source inventory has a verified twin equivalent; no placeholder, no-op or unhandled action remains.

## Phase 5 — Module-by-module operational acceptance

1. Identity, USER/STAFF, ROOTS and ACCESS AND RIGHTS.
2. DOWNTIME operational workflows and reports.
3. R&M assets, models, faults, evidence and PDF/report archive.
4. GATELOG customers, vehicles, arrivals/departures, waste types, assignments and reports.
5. Central Data Bank and administrative configuration.
6. Spectator/read-only views and cross-module navigation.

For each module, test fresh installation, normal operation, permission-denied paths, reload, two-user concurrency, cross-device state, backup/restore and browser accessibility. DOWNTIMEUI must be tenant-neutral. Do not change the protected DOWNTIME source to make parity tests pass.

## Phase 6 — Replication and recovery

- Implement an explicit, resumable YARDHUB-primary-to-private-GitHub-data replication bridge.
- Export all required records with schema version, source sequence, counts and checksums; preserve audit history while never reusing live source sessions as twin sessions.
- Copy and verify actual file bytes for every storage bucket; metadata-only copies do not count.
- Prove clean-device restore, partial restore, corruption detection, duplicate replay, missing-object detection and rollback.
- Exit: a complete backup can be restored and independently verified without access to the original browser.

## Phase 7 — Controlled authority transfer

- Rehearse freeze, final checkpoint, count/checksum reconciliation, conflict resolution, epoch increment, primary promotion and former-primary read-only enforcement.
- Rehearse reverse transfer and rollback.
- No automatic promotion of a stale replica.
- Exit: a documented, repeatable cutover and reverse-cutover drill passes without lost or duplicated records.

## Phase 8 — Full regression and release acceptance

- Run all unit, contract, integration, security, concurrency, recovery and Chromium/Playwright tests on the exact final PR head.
- Run cross-module multi-user scenarios using the real private test repository and approved broker.
- Confirm no public artifacts, logs, Pages bundles or source branches contain secrets or operational records.
- Confirm every release gate has named evidence and no unresolved critical/high security issue.
- Only then may PR #3 be considered merge-ready. Merge and deployment remain separate explicit release actions.

## Phase 3 broker feasibility notes

A GitHub Actions issue-comment broker remains a candidate, not an approved production design.

- GitHub documents that an `issue_comment` workflow runs from the default branch and only triggers if that workflow file exists on that default branch. A PR branch alone cannot complete this proof without putting the workflow on the broker repository's default branch.
- The authoritative actor must be taken from GitHub's authenticated event context (for example, the event sender/account ID), never from the parsed request body. The actor must then resolve to an enabled canonical USER before the broker reads or mutates operational state.
- Comment text and other event-controlled fields are untrusted input. Parse them as data, validate strict schemas and never interpolate them into shell/script source.
- A separate broker repository can contain workflow code and public encryption material only. It must not contain operational data. The data repository remains separate and private, with its token available only to the broker workflow.
- Because repository comments are visible to repository collaborators, request/response payloads must be encrypted end-to-end for the broker and intended user. Issue bodies, comments, logs, artifacts and caches must not contain plaintext operational data.
- Workflow concurrency can limit a workflow/job to one active run, but GitHub's default pending-run behaviour can replace earlier pending runs. The newer queue option permits up to 100 pending runs; this still needs latency/throughput tests and does not replace the data store's compare-and-swap, idempotency or replay protection.
- Do not use `workflow_dispatch` as an operator interface if it requires granting users write access to the broker repository. Verify the actual permission model in the disposable test repository.
- This proof is blocked until a disposable private broker repository, separate private data repository and protected test secrets/keys can be provisioned. None of these are currently available through the connected GitHub actions.

## Current verified baseline (27 November 2026)

- PR #3 is open, draft and unmerged. Current observed documentation head: `20234bb505a2576da7d0115234ba5e75a6bb02a2`.
- CI run #471 (`46082186779`) on implementation commit `6d5240c58fcd0a30b93e707edc0aa2ee44a9848b` passed build/checks, Chromium installation, Playwright browser QA and screenshot artifact upload.
- Runtime UI port: `yardhub/runtime/index.html` now includes the two latest source-main STAFF layout changes from source commits `0cbda60f90ee45f8df866e7b36f532498a78ea49` and `939195a1fac26a9a632ab3938f17922985d8cd9d`. STAFF uses the same YARD HUB page heading, directory row layout and responsive toolbar as USERS/ACCESS AND RIGHTS, with a dedicated header return button. `yardhub/reference/` remains unchanged and pinned to tree `ba99913d1eaff7d99785088fd0931b3815defd4c`.
- A runtime STAFF static-contract test was added to `npm test` and `npm run check`. Workflow #479 (`46082765580`) on commit `521a283534011aef346611facda2fbc39cf17534` had passed `npm run check`; Chromium installation/browser QA was still running at the last check. The subsequent documentation head has not yet received its own CI result.
- The latest source main has two commits beyond the pinned reference; the observed delta is limited to the STAFF UI/layout and its related test contracts. No source repository commit or workflow was changed by this work.
- The migration inventory now records a missing tracked `downtime_reports` table definition, plus the 49-applied/45-tracked migration discrepancy. No attempt has been made to guess its schema.
- The repository `aka30art/DowntimeUI` is public and is source code only. It is not an operational data destination. The `data/yardhub` branch is not approved for operational records.
- The direct-browser GitHub token prototype is not approved for staff/multi-user production. The seven-service runtime remains an experimental compatibility harness.
- No live primary data has been migrated; no primary switch has occurred; YARDHUB remains primary.
- Critical/high security findings remain open in `docs/GITHUB_NATIVE_SECURITY_AUDIT.md`. Build and browser success do not close them.

## Non-negotiable protection boundary

No commits, pull requests, workflow runs, settings changes, deployments, Supabase operations, data exports or credential operations may target `aka30art/DOWNTIME`. All work in this plan is confined to `aka30art/DowntimeUI` and explicitly provisioned disposable/private test infrastructure.
