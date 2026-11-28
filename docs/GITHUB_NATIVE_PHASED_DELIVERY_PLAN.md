# GitHub-native YARDHUB twin — phased delivery and release gates

**Status:** execution plan; PR #3 remains open and draft.  
**Scope:** DOWNTIMEUI only. The protected `aka30art/DOWNTIME` repository, its branches, workflows, Pages deployment, Supabase project, credentials and production records are explicitly out of scope.

## Delivery rule

Deliver in independently testable phases. Each phase must have implementation, automated tests, browser acceptance evidence and a recorded exit decision. Do not merge PR #3, deploy the twin as an operational system, copy production records, or switch primary authority until every production gate below is satisfied. A passing build or mocked GitHub API test is not a production gate.

## Current phase board

- **Phase 0 — PARTIAL, source census advanced:** the seven Edge service entrypoints, 96 action/read surfaces, 19 current service RPCs, all 39 live-inventory tables and five Storage buckets are catalogued. The preserved UI caller map is recorded, including unresolved direct-call gaps for GATELOG (`history`, `vehicle-save`), YARD HUB Settings (`remove-user-tier`), Photo Evidence (`cleanup`) and indirect Central Bank actions. All 45 tracked migration files are SHA-pinned. The SQL scan identified 26 distinct functions, five triggers, policy/grant/RLS semantics and one missing tracked DDL definition for live table `downtime_reports`. The 49-applied/45-tracked migration set and full schema/export/relationship census remain unresolved.
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

GitHub Pages is static and cannot hold a server secret or run request-time authorization. A GitHub Actions broker is asynchronous and is not automatically a secure API. A protocol core has been added at `src/infrastructure/github-actions-broker.js`; it parses authenticated issue-comment events, resolves numeric GitHub sender IDs to canonical active USER/STAFF identities, verifies a registered signing key, requires authority epoch and YARD ROLE authorization callbacks, rejects caller-supplied actor/role fields, and requires atomic idempotency plus encrypted response callbacks. Its crypto, key lifecycle, workflow, private data adapter, queueing and real GitHub integration are not implemented. This is protocol scaffolding, not a broker deployment. Before adopting it, prove all of the following in a disposable private test repository:

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

A GitHub Actions issue-comment broker remains a candidate, not an approved production design. The local client has switched from Device Flow to the GitHub App web authorization flow with PKCE; only a real App/repository proof can close Phase 3.

- GitHub documents that an `issue_comment` workflow runs from the default branch and only triggers if that workflow file exists on that default branch. A PR branch alone cannot complete this proof without putting the workflow on the broker repository's default branch.
- The authoritative actor must be taken from GitHub's authenticated event context (for example, the event sender/account ID), never from the parsed request body. The actor must then resolve to an enabled canonical USER before the broker reads or mutates operational state.
- Comment text and other event-controlled fields are untrusted input. Parse them as data, validate strict schemas and never interpolate them into shell/script source.
- A separate broker repository can contain workflow code and public encryption material only. It must not contain operational data. The data repository remains separate and private, with its token available only to the broker workflow.
- Because repository comments are visible to repository collaborators, request/response payloads must be encrypted end-to-end for the broker and intended user. Issue bodies, comments, logs, artifacts and caches must not contain plaintext operational data.
- Workflow concurrency can limit a workflow/job to one active run, but GitHub's default pending-run behaviour can replace earlier pending runs. The newer queue option permits up to 100 pending runs; this still needs latency/throughput tests and does not replace the data store's compare-and-swap, idempotency or replay protection.
- Do not use `workflow_dispatch` as an operator interface if it requires granting users write access to the broker repository. Verify the actual permission model in the disposable test repository.
- This proof is blocked until a disposable private broker repository, separate private data repository and protected test secrets/keys can be provisioned. None of these are currently available through the connected GitHub actions.

### Phase 3 candidate v0.2 — GitHub App request inbox + private Actions broker

The direct fine-grained PAT route should not be the default for staff request submission. GitHub documents current gaps for fine-grained PATs contributing to public repositories where the user is not a member and repositories where the user is an outside/repository collaborator. The issue-comment create endpoint does support GitHub App user access tokens and requires Issues: write. A GitHub App user token is bounded by both the app's granted permissions and the user's own access; tokens can also be restricted to a single repository ID.

**Candidate topology (not yet proven):**

1. **Public broker/inbox repository — no operational records.** It contains only the broker workflow, public encryption key/configuration and encrypted request/response comments. It must contain no secrets, production data, customer/vehicle details, staff profile details, report contents or evidence bytes.
2. **GitHub App user access — broker repo only.** The browser client now uses the GitHub App web application flow with PKCE S256, state validation and a token-exchange `repository_id` restriction to the broker repository only. The App must have Issues: write and no Contents, Actions or administration permission for the user token. The App's client secret must be shipped as public-client configuration in the static client; it is explicitly not a secret boundary. PKCE, App permission intersection, repository restriction and the authenticated GitHub event actor are the security controls. The user token is kept in memory for at most 30 minutes; only the temporary OAuth state and PKCE verifier are held in tab session storage while redirecting to the callback. The client does not request `offline_access` or retain refresh tokens.
3. **Authenticated event actor.** The broker triggers from issue_comment on the public inbox. It uses the numeric GitHub user ID from the authenticated webhook event as the actor. The request body may not supply or override the actor. Unknown, unmapped or disabled USER IDs fail closed before private data is read.
4. **Private data repository — no user tokens.** A GitHub App installation is granted the minimum private-repository Contents permission. The Actions workflow creates a short-lived installation token explicitly restricted to the dedicated private YARDHUB data repository. Its App private key is an Actions secret and never reaches the browser or inbox repository content.
5. **End-to-end encrypted payloads.** The browser encrypts a strict request envelope using WebCrypto and a broker public key. The envelope contains a one-time request ID, timestamp/expiry, operation schema and an ephemeral client response key. The workflow decrypts only in memory, validates schema and replay ledger, performs the server-side YARD ROLE check and commits to the private data repo. It posts only encrypted response bytes plus non-sensitive correlation metadata to the public inbox. The browser decrypts responses locally. Public issue/comment visibility means metadata leakage (GitHub identity, timing, request frequency) must also be assessed.
6. **No code execution from untrusted content.** Comment content is parsed strictly as data. It is never interpolated into shell commands, workflow files, actions, expressions or scripts. Workflow source is checked out only from the broker's protected default branch; pull-request code is never executed with secrets.
7. **Serialisation and recovery.** Broker workflow concurrency, request idempotency, a private request ledger, compare-and-swap commits, stale authority rejection and explicit handling of overflow/cancelled runs are mandatory. Actions queue limits and p95 latency must be measured against operational requirements.

**Why this is a better candidate:** the human token is limited to submitting/reading encrypted inbox comments, not reading or writing the operational repository. The actual data credential exists only in a trusted GitHub Actions job and is scoped to the dedicated private data repository. GitHub App user access tokens are attributed to the authorising user, with app/user permission intersection; the web token exchange supports a repository-ID restriction. For a static browser client the App client secret is public and cannot be treated as secret. PKCE protects the authorization-code exchange, while the broker authenticates the actor from the GitHub event—not from the client.

**Outstanding proof requirements:** create a disposable broker repo and separate disposable private data repo, register/install the two least-privilege GitHub Apps, configure only test keys/secrets, and run a real second GitHub account through a full PKCE encrypted request/response cycle. Verify the user token cannot read the private data repo, the broker job does not accept caller actor fields, plaintext never appears in GitHub logs/comments/artifacts, and cancellation/replay/duplicate/parallel request handling is correct. Validate the public-client secret/PKCE assumptions and token expiry/revocation with GitHub itself. This proof cannot be run in PR #3 alone because issue_comment workflows must exist in the broker repository's default branch. Do not add a broker workflow to DOWNTIMEUI's production default branch or trigger Pages deployment as part of this proof.

## Current verified baseline (27 November 2026)

- PR #3 is open, draft and unmerged. Current source head at this update: `4981c768eb4f39a62da76519c1e462f7b148b15f`; its own CI run has not yet been verified.
- The client now uses GitHub App web authorization/PKCE S256 rather than Device Flow. This has only deterministic mocked HTTP tests; actual callback/token exchange, CORS and least-privilege App permissions remain unproven.
- - PR #3 is open, draft and unmerged. Latest verified PR head at this plan update: `a0f438ad48e21d17117261f471d46b1151625a4c`; any later commits require their own CI result.
- CI #486 (`46083145309`) passed on exact head `a0f438ad48e21d17117261f471d46b1151625a4c`: `npm run check`, Chromium installation, Playwright browser QA and screenshot artifact upload all passed. This run includes the source-parity test wired into both `npm test` and `npm run check`.
- CI #487 (`46083261647`) passed on exact head `19eae382113d5b5f0acd5a4251a61dc71d303964`: dependency installation, `npm run check`, Chromium installation, Playwright browser QA and screenshot artifact upload all passed. That run predates the broker protocol and latest runtime hardening commits.
- Earlier complete CI passes: #479 (`46082765580`) on `521a283534011aef346611facda2fbc39cf17534`; #481 (`46083001679`) on `20234bb505a2576da7d0115234ba5e75a6bb02a2`; #482 (`46083018447`) on `1b1520f4df4e2438d97872e8078c611786a728d9`; #485 (`46083134784`) on `2f23ba7ce32052209657049116c3e5f9a05f5233`. Earlier #476 (`46082619410`) on `a652e7828cc943ab01826ba429e6ff6614fcea9b` also passed.
- Runtime UI port: `yardhub/runtime/index.html` includes the two source-main STAFF layout changes from source commits `0cbda60f90ee45f8df866e7b36f532498a78ea49` and `939195a1fac26a9a632ab3938f17922985d8cd9d`. STAFF uses the YARD HUB administration heading, directory row layout and responsive toolbar as USERS/ACCESS AND RIGHTS, with a dedicated header return button. `yardhub/reference/` remains pinned to tree `ba99913d1eaff7d99785088fd0931b3815defd4c` and has not been altered.
- Runtime STAFF static-contract and source table/storage/RPC catalogue assertions are included in `npm test` and `npm run check`. The latter test checks catalogue names and counts only, not RPC semantics or authorization.
- The latest source main has two commits beyond the pinned reference; the observed delta is limited to the STAFF UI/layout and its related test contracts. No source repository commit or workflow was changed by this work.
- The migration inventory records a missing tracked `downtime_reports` table definition and the 49-applied/45-tracked migration discrepancy. No attempt has been made to guess the missing schema.
- `aka30art/DowntimeUI` is public and is source code only, not an operational data destination. The `data/yardhub` branch is not approved for operational records.
- The direct-browser GitHub token prototype is not approved for staff/multi-user production. The seven-service runtime remains an experimental compatibility harness.
- No live primary data has been migrated; no primary switch has occurred; YARDHUB remains primary.
- Critical/high findings remain open in `docs/GITHUB_NATIVE_SECURITY_AUDIT.md`. Build and browser success do not close them.

## Non-negotiable protection boundary

No commits, pull requests, workflow runs, settings changes, deployments, Supabase operations, data exports or credential operations may target `aka30art/DOWNTIME`. All work in this plan is confined to `aka30art/DowntimeUI` and explicitly provisioned disposable/private test infrastructure.


## Latest protocol and hardening work

- Runtime hardening: placeholder fingerprint/image/cleanup secrets were removed, canonical-auth readiness now defaults to false, and the compatibility layer no longer fabricates anonymous sessions.
- Client: `src/infrastructure/github-app-broker-client.js` uses GitHub App web authorization with PKCE S256, one-time OAuth state, callback URL validation and a `repository_id` restriction at token exchange. The user token is held in module memory for a maximum local 30-minute window; the state/verifier live in tab session storage only until callback. Its ECDH/HKDF/AES-GCM request/response keys are currently ephemeral and held in the returned in-memory request context; page-reload recovery of a pending response is not implemented. Client tests are mocked; actual App registration, browser callback, CORS/token exchange and token permissions are not yet validated with GitHub.
- Orchestration core: `src/infrastructure/github-actions-broker.js` validates GitHub issue-comment event identity, maps numeric sender IDs to canonical USER/STAFF, checks per-USER inbox ownership, decrypts via callback, checks action authorization and authority epoch, rejects caller identity injection, and uses injected idempotency and encrypted-response interfaces.
- The core is not connected to a real GitHub Actions workflow, broker/data repositories, Data App credentials, concrete USER/role lookup, cryptographic key custody or response publisher. Ephemeral client keys are memory-only; device recovery and two-device use are open.
- CI #487 on `19eae382` passed before the latest hardening and broker changes. Runs #506 passed `npm run check` and continued through Chromium/browser QA on earlier code. Run #508 is the first full validation attempt of the ECDH-envelope-aligned broker core; later changes add per-USER inbox ownership and need their own CI result.
- Phase 3 remains BLOCKED pending real browser OAuth callback/PKCE acceptance, private caller workflow installation on the broker repository default branch, private broker/data infrastructure, protected secrets, two-account proof, recovery and measured throughput.


## Broker runtime integration and primary-authority lock — 28 November 2026

The local broker work has advanced beyond the earlier callback-only scaffold:

- Canonical GitHub numeric actor mapping, reciprocal USER/STAFF validation, ROOTS resolution and a 96-action default-deny YARD ROLE/department policy now live in `github-broker-authority.js`.
- DEV-only GitHub identity link/revoke operations and audit records are implemented in `github-broker-identity-admin.js`.
- The broker creates a two-minute Central Bank-compatible service session from the trusted principal; only the token hash is persisted, and the session is revoked after the action.
- Durable idempotency claims, leases, COMMITTED/COMPLETED states and encrypted response replay are implemented in the private data-store adapter.
- The runtime composes the seven preserved service handlers, encrypted ECDH request/response channel, service session, authorization and response publishing.
- The accepted service action and its idempotency COMMITTED state are staged in one GitHub data transaction.
- A transaction-level authority-epoch precondition reads `control/authority.json` at the same Git commit SHA as the data snapshot. The commit is rejected unless the authority remains ACTIVE, the epoch is unchanged and `DOWNTIMEUI-GITHUB` is primary.
- The Actions entry-point script pins the event to a configured private broker repository, its numeric ID and default branch, rejects PR comments, and mints a Data App token restricted to a distinct private data repository ID.
- Browser pending-request CryptoKey context is now stored through an IndexedDB adapter. Browser reload, device loss, multi-device use and recovery still require real-browser acceptance.

**Non-negotiable state:** the broker cannot perform operational actions while `YARDHUB-PRIMARY` is the active primary. No cutover is implied or authorised by this code. No production migration or authority transfer has taken place.

**Remaining Phase 3 gates:** provision the dedicated private broker and data repositories, create/install the separate Inbox and Data Apps with verified least privilege, configure protected secrets and the default-branch `issue_comment` workflow, then run real two-user tests for actor isolation, role enforcement, replay, concurrency, queue limits, latency, privacy, key recovery and binary storage. The current source-only environment cannot provision those GitHub resources or secrets.

CI has had repeated failures while the broker runtime and tests were being integrated. Run #599 failed because the runtime omitted the authorityEpoch argument in its execute callback; that defect is corrected in the current branch, but a passing exact-head CI plus Playwright run is still required. Do not merge or deploy.


## Latest phase checkpoint — 28 November 2026

| Phase | Current state | Evidence / remaining gate |
|---|---|---|
| 0 — Source census | PARTIAL | Seven service entrypoints, 96 action/read surfaces, 19 RPCs, 39 source tables, five private buckets and 45 tracked migration files inventoried. Reconcile the 49 applied migration records with tracked files; finish policy/trigger/grant/frontend caller census and full export checksums. |
| 1 — GitHub data contract | PARTIAL | Atomic multi-table Git commit, revision/CAS checks, storage adapter and authority epoch guard exist. Three GitHub-only extension tables are separate from the 39-table source backup contract. Real private repository concurrency and clean restore are not proven. |
| 2 — Private identity boundary | CODE PATH IMPLEMENTED / PROVISIONING BLOCKED | Canonical GitHub actor mapping, per-user issue binding, immutable DEV-only link/revoke and append-only audit exist. A dedicated private data repository, Inbox/Data Apps and secrets are not provisioned. Initial immutable DEV seed remains an out-of-band setup gate. |
| 3 — Trusted broker | LOCAL INTEGRATION IMPLEMENTED / PRODUCTION PROOF BLOCKED | Encrypted ECDH inbox client, Actions runner, repository-restricted Data App token minting, short-lived Central Bank service sessions, YARD ROLE preflight, durable idempotency/replay and in-transaction authority epoch recheck exist. No private broker repository, default-branch workflow, real App installation/event, two-user isolation, queue/latency or secret recovery test exists. |
| 4 — Seven service parity | PARTIAL | Seven handlers register and build. Broker runtime integration exercises a representative GATELOG action; the full action matrix still needs per-action positive/negative role tests and source-contract comparison. |
| 5 — Module acceptance | NOT COMPLETE | DOWNTIME, R&M, GATELOG, Central Bank/ROOTS/YARD ROLE, STAFF/USER and Spectator still require full multi-role workflow acceptance against the private broker. |
| 6 — Replication and recovery | PARTIAL | Source backup authority checks and concurrent cutover stop are tested. Source replication now preserves GitHub-only broker tables. A separate private full-twin backup repository and recovery of broker identities/audit/idempotency/binary objects remain outstanding. |
| 7 — Authority transfer | NOT STARTED | No live replication checkpoint, write freeze, reconciliation, cutover or reverse-transfer rehearsal. |
| 8 — Release acceptance | NOT STARTED | No merge, production deployment, production data copy or authority transfer. All security and operational gates must pass on one exact final PR head. |

### Latest CI checkpoint

- Run #613 passed `npm run check` on `603c15ac873cf850fd12ba9040df8e9ef8100b8c`.
- Run #614 passed `npm run check` and Chromium installation on `6fdb71257b931d74559c5c1ed5c8d803277ce761`; Playwright browser QA and screenshot upload were still running.
- Documentation and code have advanced after those tested commits. The newest PR head must complete its own full CI and browser QA before being considered validated.

**Release rule unchanged:** PR #3 stays open and draft. YARDHUB remains primary. No production migration, merge or deployment is permitted until all Phase 0–8 acceptance gates are evidenced on the exact final head. The protected `aka30art/DOWNTIME` repository remains untouched.


## Reusable workflow and identity-onboarding additions — 28 November 2026

- Added `.github/workflows/yardhub-github-broker.yml`, a reusable `workflow_call` runtime that fetches the immutable source commit by SHA and runs only for a newly created encrypted issue comment in the private caller repository. It uses caller `GITHUB_TOKEN` permissions `contents: read` and `issues: write`; the Data App token remains restricted to the separate data repository.
- Added `.github/workflows/yardhub-github-identity-admin.yml` and `scripts/manage-github-broker-identity.mjs`. The separate `workflow_dispatch` path validates the authenticated GitHub actor, requires immutable DEV authority, verifies the target inbox issue is open/non-PR and assigned to the target account, and audits link/revoke operations.
- Added private caller workflow templates for both the encrypted inbox and identity administration. They require immutable source-SHA pinning. They are not installed in a dedicated private broker repository.
- Local CI run #629 passed the complete check suite, Chromium install, Playwright browser QA and screenshot upload on commit `06c58ab6ea50144ed5a2f4148c05d927c5c3a012`. The PR subsequently advanced to `0f5c63ed0aad9e0015c9222a12d2e5a27f76ec8a` for a documentation-only pinning clarification; no exact-head run was present at this checkpoint.
- A release-control incident occurred: commit `7561df62dacf05c52c9b8b1ac857f577fba93cd6` was unintentionally pushed to `main`, adding only a workflow template under `docs/templates`. The Pages workflow run #26 completed successfully. The main ref was immediately restored to its recorded pre-push/base SHA `58955b13f6a70f9da44d6ead9e409639086989a7`; corrective Pages run #27 completed successfully. The branch now matches the PR base. This accidental Pages deployment is recorded as an incident; no operational data or authority was changed.


## Binary evidence transport is a production blocker — 28 November 2026

The GitHub repository/object adapter can store and retrieve bytes inside the Actions runtime, but the browser-to-broker and broker-to-browser file transport is not implemented. This is not full storage parity.

- The encrypted issue-comment envelope is capped at approximately 11 KiB by the browser client; the broker parser caps the comment at 16 KiB.
- The preserved source services accept evidence uploads up to multiple megabytes, and R&M PDF exports can be much larger. These payloads cannot be carried through the current comment envelope.
- The old storage adapter's runner-local `blob:` URLs are not accessible from the user's browser or another workflow run. Signed upload URLs also depended on in-memory tickets that do not survive a separate Actions invocation.
- The storage adapter now fails closed for browser signed upload/download URL requests. It no longer returns a misleading runner-local blob URL or upload ticket as though it were a usable browser endpoint.
- The broker action policy now denies unsupported binary paths: Central Bank staff photo upload/read, Photo Evidence create/view/cleanup, R&M upload/export-create/export-url. Deletion and metadata operations that are server-side and supported remain separately permissioned.
- The GitHub edge runtime independently blocks Central Bank `identity-reset` and `staff-original-upload`. Those copied source actions contain paths that read/write/delete staff originals in `aka30art/DOWNTIME`; the GitHub twin must never invoke them. This defense-in-depth guard is in DowntimeUI only. The protected DOWNTIME repository has not been changed.

**Phase 4 remains BLOCKED.** A production decision is required between (a) a measured, secure chunked broker transport with durable staging, replay handling, and acceptable GitHub Actions/API throughput, or (b) a separate private object-storage transport. No external provider has been selected and no production files have been migrated. Do not claim photo-evidence, staff-photo or R&M binary parity until end-to-end browser upload/download and recovery tests pass.
