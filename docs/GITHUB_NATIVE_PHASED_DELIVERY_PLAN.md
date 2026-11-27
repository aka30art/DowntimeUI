# GitHub-native YARDHUB twin — phased delivery and release gates

**Status:** execution plan; PR #3 remains open and draft.  
**Scope:** DOWNTIMEUI only. The protected `aka30art/DOWNTIME` repository, its branches, workflows, Pages deployment, Supabase project, credentials and production records are explicitly out of scope.

## Delivery rule

Deliver in independently testable phases. Each phase must have implementation, automated tests, browser acceptance evidence and a recorded exit decision. Do not merge PR #3, deploy the twin as an operational system, copy production records, or switch primary authority until every production gate below is satisfied. A passing build or mocked GitHub API test is not a production gate.

## Current phase board

- **Phase 0 — PARTIAL:** the seven source service entrypoints, principal action families, USER/STAFF/ROOTS/YARD ROLE domains and 39-table/five-bucket inventory are documented. A complete route/action/RPC/trigger/RLS/storage/realtime/export-to-test matrix is still outstanding.
- **Phase 1 — PARTIAL:** GitHub store, atomic JSON transactions, authority metadata and mocked transaction tests exist. Real private-repository contention, rate-limit, branch-protection and crash-recovery evidence does not.
- **Phase 2 — BLOCKED:** the source repository is public, no dedicated private operational data repository is recorded, and the browser-direct credential path remains privileged.
- **Phase 3 — NOT STARTED:** no acceptable broker proof exists.
- **Phase 4 — NOT STARTED:** seven handlers build/register, but exhaustive endpoint and permission parity is unproven.
- **Phases 5–8 — NOT STARTED:** module acceptance, full replication/recovery, authority-transfer rehearsal and release acceptance remain open.

A detailed source-backed finding register is maintained in [GITHUB_NATIVE_SECURITY_AUDIT.md](GITHUB_NATIVE_SECURITY_AUDIT.md). Its open critical/high findings block operational activation.

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

- PR #3 is open, draft and unmerged.
- Current verified implementation head: `39f46c0c47d8407c9b2091f0583c759ef113bbd5`.
- CI run `46081812603` (run #466) on that exact head completed successfully: `npm run check`, Chromium installation, Playwright browser QA and screenshot artifact upload all passed.
- Earlier intermediate runs failed while the backup bridge and restore test fixtures were being corrected. Their failing fixtures have been corrected; run #466 validates the current backup authority guard and the deterministic restore/checksum fixtures.
- Browser QA confirms the existing installer, daily operations, plant overview, task-lock persistence, reports, settings edits, backup/restore, 390px mobile layout, WIPE OUT reset, YARDHUB private setup gate, standalone R&M lock and mobile layout. It does not validate secure multi-user YARDHUB operations or full Edge action parity.
- The repository `aka30art/DowntimeUI` is public and is source code only. It is not an operational data destination. The `data/yardhub` branch is not approved for operational records.
- The direct-browser GitHub token prototype is not approved for staff/multi-user production.
- The seven-service runtime is an experimental compatibility harness; the preserved YARDHUB UI remains behind its activation gate.
- No live primary data has been migrated; no primary switch has occurred; YARDHUB remains primary.
- A static security audit has recorded open critical/high findings in `docs/GITHUB_NATIVE_SECURITY_AUDIT.md`. Build/browser success does not close them.

## Non-negotiable protection boundary

No commits, pull requests, workflow runs, settings changes, deployments, Supabase operations, data exports or credential operations may target `aka30art/DOWNTIME`. All work in this plan is confined to `aka30art/DowntimeUI` and explicitly provisioned disposable/private test infrastructure.
