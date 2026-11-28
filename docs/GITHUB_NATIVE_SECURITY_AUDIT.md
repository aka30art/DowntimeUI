# GitHub-native YARDHUB twin — security and production-readiness audit

**Audit date:** 27 November 2026  
**Target:** `aka30art/DowntimeUI`, PR #3, branch `architecture/github-native-yardhub-twin`  
**Observed head at audit start:** `235ca7f379523e9d3a980f059e57ef6aaf8b365e`  
**Classification:** static source audit of the DOWNTIMEUI implementation and preserved YARDHUB reference. No operation was performed against `aka30art/DOWNTIME`.

## Executive decision

**NOT PRODUCTION READY. Do not activate the YARDHUB runtime for operational use.**

The GitHub storage adapter is a useful persistence experiment, but the current browser-direct architecture does not enforce the source application's USER/STAFF, ROOTS or YARD ROLE boundaries. A successful build or browser smoke test cannot compensate for this. The direct-token path must remain isolated development/test infrastructure until replaced by a trusted request broker.

## Findings

### SEC-001 — Browser-held repository credential bypasses application permissions
**Severity: CRITICAL · Status: OPEN**

`src/infrastructure/github-connection.js` accepts a GitHub token in the browser and passes it into the GitHub data-store client. The token is kept in module memory rather than browser storage, which reduces persistence but does not create a security boundary. Any holder of a token scoped for repository Contents read/write can read or modify the private repository directly, without going through application USER/STAFF validation or the seven service handlers.

**Impact:** the repository credential grants broader access than any individual YARD ROLE. UI visibility and session logout cannot revoke repository access already granted to the token.

**Required remediation:** remove all operational repository credentials from browser execution. Browser requests must reach a trusted broker that holds the private data credential server-side. The broker must derive the actor from an authenticated GitHub event/session and map that identity to the canonical USER record before every operation.

### SEC-002 — Table adapter has no row-level or action-level authorization
**Severity: CRITICAL · Status: OPEN**

In `src/infrastructure/github-table-client.js`:
- SELECT calls `store.readDatabase()` and filters/projects data locally. There is no per-actor or per-module row authorization in this adapter.
- INSERT/UPSERT/UPDATE/DELETE call `store.transactDatabase()` directly.
- RPC dispatch calls the registered handler and commits its result without authenticating an actor or evaluating YARD ROLE permissions.

The GitHub data store is a repository transaction engine, not an authorization engine. Its revision checks and atomic commit do not implement Supabase RLS.

**Impact:** any caller with access to the table client/data-store path can inspect records across departments or invoke writes without the canonical VIEW/ENTER/EDIT/MANAGE rules.

**Required remediation:** move all data reads and mutations behind the trusted broker. The broker must enforce default-deny authorization on table, record scope, module, action and current authority epoch. Do not add superficial client-side filters and call them RLS.

### SEC-003 — Audit actor fields are caller-controlled
**Severity: HIGH · Status: OPEN**

`src/infrastructure/github-rpc-handlers.js` accepts identity fields such as `p_actor`, `p_actor_username`, `p_actor_user_id` and `p_actor_display_name` from RPC arguments. Examples include GATELOG audit attribution, YARD ROLE assignment/reassignment and tier-setting audit records. The table client does not replace those values with a verified broker principal.

**Impact:** a caller may be able to misattribute an event or claim a privileged identity in audit fields. Business validation inside an RPC does not prove who sent the request.

**Required remediation:** broker-authenticated principal must be injected by trusted runtime context. Reject caller-supplied actor identity fields or ignore them; derive audit identity only from the validated principal and immutable USER ID.

### SEC-004 — Compatibility authentication is not a trusted identity provider
**Severity: HIGH · Status: OPEN**

`src/infrastructure/github-supabase-compat.js` implements:
- `getSession()` by returning `globalThis.DowntimeCentral?.session`;
- `signInAnonymously()` now returns no session and a 401 error; the fabricated `github-native-local-session` fallback has been removed;
- `signOut()` remains a no-op, and `getSession()` still reads a browser-global session object rather than verifying it with a trusted broker.

The adapter does not verify the browser session with a trusted identity service. Its `functions.invoke()` constructs a local request to a handler; it is not an authenticated network boundary. The original Edge Functions' session checks cannot be treated as production authentication when the compatibility layer and data store are browser-resident.

**Partial remediation on PR head `5918ef7`:** the anonymous fallback session is removed and anonymous sign-in now fails closed with HTTP 401. **Still open:** browser-global `getSession()` is not a trusted identity proof, sign-out does not revoke a server-side session, and no production broker has been connected. Broker principal creation must be tied to verified GitHub actor identity; expired, disabled or unmapped users must be rejected before any data read or write.

### SEC-005 — Placeholder service secrets are injected into the Edge runtime
**Severity: HIGH · Status: OPEN**

`yardhub/runtime/github-edge-runtime.js` previously supplied fallback values including:
- `SUPABASE_SERVICE_ROLE_KEY = "github-native-service-adapter"`
- `DOWNTIME_IDENTITY_FINGERPRINT_SECRET = "github-native-fingerprint"`
- `GITHUB_STAFF_IMAGE_TOKEN = "github-native-storage"`
- `PHOTO_CLEANUP_SECRET = "github-native-cleanup"`
- `DOWNTIME_CANONICAL_AUTH_READY = "true"`

Those earlier constants were not secret material or verified readiness signals. On PR head `5918ef7`, the fingerprint, staff-image and cleanup secret fallbacks have been removed; canonical authentication now defaults to `false`; the only service-role-shaped value is the explicit non-secret compatibility marker `GITHUB_NATIVE_COMPAT_ADAPTER`, used solely because preserved source handlers require a non-empty constructor argument while the Supabase client shim intercepts the call. It is not accepted by Supabase and is not a credential. The runtime now returns `undefined` for absent secret values, including explicitly null values.

**Partial remediation on PR head `5918ef7`:** the fabricated fingerprint/image/cleanup secrets are removed and canonical-auth readiness defaults to false. **Still open:** there is no protected runtime secret store or trusted broker, and the compatibility marker is only suitable for the local shim. Production startup must fail closed until an actual broker/storage interface and protected secrets are configured.

### SEC-006 — Storage and realtime adapters bypass authorization
**Severity: HIGH · Status: OPEN**

`src/infrastructure/github-storage-client.js` performs object reads, writes, listing and deletion directly against the store without a verified actor/permission context. `createSignedUploadUrl()` issues an in-memory process-local ticket; that ticket is not an authenticated, durable broker authorization grant.

`src/infrastructure/github-supabase-compat.js` polls `store.readTable()` and passes the current table contents to subscribers. It has no subscriber-specific permission filtering.

**Impact:** media and table subscriptions can escape the module/record boundaries that the source application's services enforce.

**Required remediation:** broker-authorized object operations with per-object scope checks; short-lived, one-use upload capabilities bound to actor, object path, size, MIME type and authority epoch; filtered change feeds that never expose a table the actor cannot read.

### SEC-007 — Service registration tests are not service parity tests
**Severity: HIGH · Status: OPEN**

`scripts/build-yardhub-github-runtime.mjs` bundles the seven preserved reference Edge Functions through `src/infrastructure/supabase-client-shim.js`. `tests/github-edge-runtime.test.js` verifies registration and local preflight routing. Those checks do not prove that all endpoint actions work against the GitHub store, that every permission-denied branch is preserved, or that storage, audit and transaction semantics match the source.

**Required remediation:** build an endpoint/action contract inventory and exercise every action with positive, negative, cross-role, malformed-input, retry and concurrent-writer cases. The real GitHub broker and private repository must be used for acceptance, not only the in-memory store.

### SEC-008 — GitHub-only broker feasibility is not yet demonstrated
**Severity: HIGH · Status: OPEN**

GitHub Pages is static. The current repository credential cannot remain in the browser. A GitHub Actions broker is only a candidate until it proves authenticated actor attribution, private request/response handling, secret isolation, replay protection, serialised writes, acceptable latency and recovery. No such end-to-end broker test has been recorded.

**Required remediation:** run a disposable-private-repository proof with no production records. Reject the design if users must receive private data-repository Contents access, if private data appears in public logs/issues/artifacts, or if user-specific authorization cannot be enforced.

**Updated candidate:** a GitHub App user access token restricted to a public request-inbox repository (Issues: write only), combined with an Actions installation token restricted to a separate private data repository. The static browser client now uses the web application flow with PKCE S256 and a token-exchange repository-ID restriction. GitHub's App client secret is public client configuration in the Pages bundle and is not treated as a secret boundary; the authenticated issue-comment event supplies the user actor. The user token is held in memory for at most 30 minutes and no refresh token is requested. GitHub's current documentation states that fine-grained PATs have a gap for contributing to public repos where the user is not a member and for outside/repository collaborators, so a PAT-based issue inbox is not assumed to work. GitHub App user tokens are a distinct supported token type for issue comments, but their effective permissions are the intersection of app permissions and the user's repository access. A repository-ID restriction can further limit a user token to the broker inbox only.

**Proof still open:** no App is registered, no broker/data repositories are provisioned, and no real second-account request has been tested. Do not treat this candidate as production authentication until the token's actual repository/endpoint permissions and encrypted response path have been proven end-to-end.


### SEC-009 — Operational data destination and real-repository tests are outstanding
**Severity: HIGH · Status: OPEN**

`aka30art/DowntimeUI` is public and is source code only. It is not an operational data destination. No dedicated private YARDHUB data repository, broker identity, or real-repository multi-user acceptance environment is recorded. Existing store tests use mock fetch/store implementations and do not establish real Git ref contention, branch protection, API rate-limit behaviour, crash recovery or storage-object restoration at operational scale.

**Required remediation:** provision a dedicated private test/data repository, restrict its credentials to the broker, and execute the real-repository integration matrix before any operational data is copied.

## Verified source/service inventory

The preserved reference snapshot contains these seven service entrypoints:

| Service | Source entrypoint | Main responsibilities |
|---|---|---|
| Central Bank | `yardhub/reference/supabase/functions/central-bank/index.ts` | Login/session, users, STAFF, ROOTS, YARD ROLE lookup, DOWNTIME state, configuration, daily operators, evidence context and bootstrap |
| Central Config Admin | `yardhub/reference/supabase/functions/central-config-admin/index.ts` | Configuration state, validation, impact, draft, publish, restore, audit and menu controls |
| GATELOG | `yardhub/reference/supabase/functions/gatelog-api/index.ts` | Customers, vehicles, arrivals/departures, visit changes, waste types, duty assignments, reports and archive |
| Photo Evidence | `yardhub/reference/supabase/functions/photo-evidence/index.ts` | Upload authorization, evidence view, delete and cleanup |
| R&M | `yardhub/reference/supabase/functions/repair-maintenance-api/index.ts` | Access, machines/assets/models/presets, faults, notes, evidence, settings and PDF/report archive |
| Spectator Read | `yardhub/reference/supabase/functions/spectator-read/index.ts` | Access-code-gated read-only snapshot |
| YARD HUB Settings | `yardhub/reference/supabase/functions/yard-hub-settings-api/index.ts` | USER access, YARD ROLE definitions/assignments, ROOTS and tier settings |

The source port audit records 39 public operational tables, five private storage buckets and the associated identity, authorization, audit, R&M, GATELOG and DOWNTIME domains. Each source action still needs an individually traceable twin contract and test.

## Phase exit assessment

| Phase | Assessment | Evidence required to close |
|---|---|---|
| 0 — Source baseline/inventory | PARTIAL | Complete route/action/RPC/table/trigger/policy/storage/realtime/export matrix with immutable source hashes |
| 1 — Data/authority contract | PARTIAL | Real private-repository atomicity, concurrency, rate-limit and crash-recovery evidence |
| 2 — Private repo/identity boundary | BLOCKED | Dedicated private repository and removal of browser-held Contents credentials |
| 3 — Broker feasibility | NOT STARTED | Disposable private broker proof satisfying SEC-008 |
| 4 — Runtime parity | NOT STARTED | Every endpoint/action and permission branch covered by executable contracts |
| 5 — Module acceptance | NOT STARTED | Fresh install, two-user/cross-device and permission acceptance for each module |
| 6 — Replication/recovery | NOT STARTED | Complete record and binary-object export, restore and checksum evidence |
| 7 — Authority transfer | NOT STARTED | Freeze, final checkpoint, promotion, reverse transfer and rollback rehearsal |
| 8 — Release acceptance | NOT STARTED | All gates green on exact final PR head with no open critical/high findings |

## Immediate engineering sequence

1. Keep the current browser-direct store as isolated test scaffolding only; do not describe it as a multi-user production backend.
2. Define and implement a broker protocol whose principal is derived from a verified GitHub event, never from request JSON.
3. Enforce USER/STAFF mapping, ROOTS and canonical YARD ROLE (VIEW/ENTER/EDIT/MANAGE) inside the trusted broker before any table, RPC or storage operation.
4. Make the request/response privacy model, replay handling, concurrency and latency measurable in a disposable private repository.
5. Only after the broker proof passes, port service actions one by one and run the module acceptance matrix.

## Validation note

- CI run `46081306857` on commit `7c313a6a1c98070f97b0d5b524ff7bad8452a0fb` passed build/checks, Chromium installation and Playwright browser QA.
- Intermediate run `46081441856` on `235ca7f` failed because the backup bridge test mock did not handle the now-approved YARDHUB source hostname. Run `46081590756` on `fcef0b8` then exposed invalid escaped newline literals in a generated backup manifest fixture.
- Both fixture defects were corrected. The backup bridge also gained an authority recheck against the latest Git commit before each write attempt, plus tests for a pre-existing twin-primary manifest and a primary switch occurring during export.
- CI run `46081812603` (run #466) on commit `39f46c0c47d8407c9b2091f0583c759ef113bbd5` completed successfully: `npm run check`, Chromium installation, Playwright browser QA and screenshot artifact upload all passed.
- These checks are code/regression evidence only. They do not prove a private GitHub data repository, secure multi-user broker, server-side YARD ROLE/RLS parity, exhaustive endpoint/action parity, real private-repository recovery or production readiness. All SEC-001 to SEC-009 findings remain open until independently remediated and tested.

## Protection boundary

No commits, API calls, workflow runs, secrets, deployments, backups, exports or production data operations may target `aka30art/DOWNTIME`. The unrelated `aka30art/DOP-website` repository is not a data destination. No operational data has been migrated and YARDHUB remains primary.


## Newer CI evidence (27 November 2026)

- CI run `46081812603` (run #466) on `39f46c0c47d8407c9b2091f0583c759ef113bbd5` passed build/checks, Chromium installation, Playwright browser QA and screenshot artifact upload.
- CI run `46082765580` (run #479) on `521a283534011aef346611facda2fbc39cf17534` passed with the new STAFF runtime layout contract and full Chromium browser QA.
- CI run `46083145309` (run #486) on exact implementation head `a0f438ad48e21d17117261f471d46b1151625a4c` passed `npm run check`, Chromium installation, Playwright browser QA and screenshot artifact upload. This run includes the 39-table/five-bucket/19-RPC inventory contract.
- All of these are code and regression results. They do not close any SEC-001 to SEC-009 finding or any private-infrastructure, real-repository, full-recovery or authority-transfer gate.


## GitHub Actions broker client and orchestration core (27 November 2026)

A local client and callback-driven orchestration core now exist. They are not a deployed or accepted broker.

`src/infrastructure/github-app-broker-client.js`:
- implements GitHub App Device Flow and includes the `repository_id` restriction during token exchange;
- verifies the returned GitHub numeric account ID and keeps the short-lived user token in module memory;
- encrypts request/response payloads using ephemeral P-256 ECDH, HKDF-SHA-256 and AES-256-GCM;
- rejects expired/tampered envelopes and ensures the tested issue comment contains ciphertext rather than plaintext operational fields.

`src/infrastructure/github-actions-broker.js`:
- accepts only newly created issue comments from the configured repository ID, rejects pull requests/bots/author mismatches and validates the ECDH envelope;
- derives the transport actor only from the authenticated event's numeric `sender.id`;
- resolves an active canonical USER/STAFF principal and requires the inbox issue to be assigned to that USER;
- decrypts through an injected callback, rejects caller-supplied actor/privilege fields, checks a positive current authority epoch and calls a separate YARD ROLE authorization function;
- requires an atomic idempotency store and encrypted-response publisher.

Local tests cover the ECDH client, Device Flow polling, repository restriction, event identity, inbox ownership, canonical USER mapping, decryption/permission denial, caller identity injection, replay and missing authority epoch.

**Still not implemented or proven:** the final browser sign-in flow (Device Flow is intended for headless clients; GitHub recommends the web application flow for browser apps and strongly recommends PKCE), real broker cryptographic key custody, USER/inbox mapping against the private data repository, concrete YARD ROLE authorization, Data App installation-token minting, actual `issue_comment` workflow on a dedicated broker repository's default branch, durable atomic idempotency, encrypted response publication, key/device recovery, two-device support, real GitHub permission isolation, queue/concurrency/latency tests and two-account end-to-end acceptance.

The broker core is callback-driven and does not itself provide any of these missing trust boundaries. It remains a testable integration scaffold. Phase 3 and SEC-001 to SEC-009 remain open.


## Browser authentication decision update (27 November 2026)

The GitHub App browser client was changed from Device Flow to the web authorization flow with PKCE S256. This follows GitHub's current guidance for browser clients and avoids Device Flow's documented phishing risk. The public client must include the App client secret in its shipped code; GitHub explicitly treats this as a public-client case and recommends PKCE. The client secret is therefore not relied on as a security control.

The current local implementation:
- generates a random OAuth state and PKCE verifier;
- stores only state/verifier/callback/creation time in tab session storage for the redirect round-trip;
- checks callback URL, exact state and ten-minute validity before exchanging the code;
- sends the client ID, public-client secret, authorization code, callback URL, PKCE verifier and broker repository ID to the token endpoint;
- verifies the returned user with `GET /user`;
- keeps the user token in module memory for at most 30 minutes, and does not request `offline_access` or persist refresh tokens;
- has unit tests using mocked GitHub responses only.

GitHub documents `repository_id` as a token-exchange parameter for the web authorization flow. The real GitHub App registration, returned permissions, callback configuration, two-account test and private-data-repository denial test remain outstanding. This update does not close SEC-008 or authorise production use.


## Broker implementation and authority-gate correction — 28 November 2026

The earlier sections describing the broker as callback-only are superseded by the following current code inventory. This is still a local implementation; it is not a deployed broker or a production acceptance result.

- `src/infrastructure/github-broker-authority.js` resolves GitHub numeric account IDs against canonical USER/STAFF data and an explicit YARD ROLE/department capability matrix. Unknown service/action pairs are default-deny. The policy catalogue is checked against 96 source service action/read surfaces. It also restricts bootstrap to the out-of-band immutable DEV account and its designated issue.
- `src/infrastructure/github-broker-identity-admin.js` provides DEV-only identity link/revocation, one-to-one USER/GitHub/inbox binding, and audit records.
- `src/infrastructure/github-central-service-session.js` creates a short-lived Central Bank-compatible session for the verified principal, persists only its SHA-256 hash, and revokes it after the service action. Browser-supplied session/access tokens are rejected.
- `src/infrastructure/github-actions-broker-store.js` stores idempotency claims in the private data-store schema and handles PROCESSING/COMMITTED/COMPLETED/FAILED states, leases and encrypted-response replay.
- `src/infrastructure/github-actions-broker-runtime.js` composes the authority adapter, encrypted client protocol, seven preserved service handlers, broker session, idempotency store and encrypted response publisher.
- `yardhub/runtime/github-edge-runtime.js` executes each accepted action in one staged GitHub database transaction and marks its idempotency record COMMITTED in that same commit.
- `src/infrastructure/github-data-store.js` now supports an expected-authority-epoch precondition on the transaction. It reads the authority manifest at the same Git commit SHA used for the data transaction and rejects the commit unless the authority is ACTIVE, the epoch matches and `DOWNTIMEUI-GITHUB` is the primary system.
- `scripts/run-github-actions-broker.mjs` is the local Actions entry point. It mints a Data App installation token restricted to the configured data-repository ID, checks that the event is a newly created non-PR issue comment from the configured private broker repository/default branch, requires broker/data repository separation, and passes optional one-time DEV bootstrap identifiers into the runtime.
- The browser client now has an IndexedDB-backed pending-request store for recoverable ECDH CryptoKey contexts. Its real browser persistence and cross-device recovery still require browser/device acceptance testing.

**Authority boundary:** the broker deliberately refuses operational actions while `YARDHUB-PRIMARY` remains primary. This is not an authority transfer. The transaction-level epoch check prevents a stale preflight authorization from committing after a primary/epoch change.

**Still blocked:** dedicated private broker/inbox and data repositories have not been provisioned; neither GitHub App has been registered/installed; protected secrets are not present; reusable inbox and identity-admin workflows plus private caller templates now exist in the PR branch, but they are not installed on a dedicated broker repository's default branch; actual GitHub App permissions, real event identity, two-user isolation, queue/backpressure, latency, five-bucket binary evidence transport, backup/restore and two-device recovery remain unproven.

Latest validation evidence:
- CI #613 passed `npm run check` on `603c15ac873cf850fd12ba9040df8e9ef8100b8c`, including broker identity/idempotency, atomic backup preservation and runtime tests. Chromium/browser QA was still in progress.
- CI #614 passed `npm run check` on `6fdb71257b931d74559c5c1ed5c8d803277ce761`, including stricter reciprocal USER/STAFF validation for identity linking. Chromium/browser QA was still in progress.
- The current PR head advanced after those runs; its own full CI and browser result is still required. Do not infer latest-head validation from an earlier commit.

Code-level broker controls now include canonical USER/STAFF resolution, immutable DEV-only identity administration with append-only audit, service/action YARD ROLE preflight, short-lived hashed Central Bank sessions, encrypted per-user inbox transport, durable idempotency/replay, and primary/epoch revalidation inside the atomic action transaction. The source backup runner now preserves the three GitHub-only broker extension tables.

These code paths remain locally tested with memory stores and mocked GitHub calls. They do not close production findings: no dedicated private broker/data/backup repositories, GitHub Apps, protected secrets, default-branch broker workflow, real event identity, two-user isolation, real five-bucket private storage, or full independent backup/restore rehearsal has been proven. The GitHub-only extension tables still need a separate full-twin backup and recovery plan.

No production data was migrated, no authority switch occurred, PR #3 remains open/draft, and `aka30art/DOWNTIME` remains untouched.


## Workflow packaging and release-control incident — 28 November 2026

Two reusable workflows now exist in the PR branch:
- `.github/workflows/yardhub-github-broker.yml` — caller `issue_comment` workflow path, encrypted-prefix filter, immutable source-SHA fetch, minimal caller-repository permissions and Data App token separation.
- `.github/workflows/yardhub-github-identity-admin.yml` — DEV-only `workflow_dispatch` path with read-only issue metadata access and Data App token separation.

The dedicated private broker repository must install the caller templates from `docs/templates/yardhub-private-broker.workflow.yml` and `docs/GITHUB_NATIVE_IDENTITY_ADMIN_WORKFLOW_TEMPLATE.yml` on its default branch, pinning the reviewed reusable workflow SHA. Neither private repository nor its Apps/secrets/workflows has been provisioned. The reusable workflows are not production activation.

**Release-control incident:** an unintended push placed commit `7561df62dacf05c52c9b8b1ac857f577fba93cd6` on `DowntimeUI/main`. It added only a caller workflow template under `docs/templates`, but it triggered Pages run #26, which completed successfully. Main was restored with a compare-and-swap ref update to `58955b13f6a70f9da44d6ead9e409639086989a7`; corrective Pages run #27 completed successfully. Main was verified equal to the PR base afterward. This is recorded as an unauthorised Pages deployment followed by a successful rollback deployment. No production data, secrets, authority or protected DOWNTIME resources were changed.

The current PR remains open/draft. No merge, operational deployment, data migration or authority transfer is authorised.


## Binary evidence transport is a production blocker — 28 November 2026

The GitHub repository/object adapter can store and retrieve bytes inside the Actions runtime, but the browser-to-broker and broker-to-browser file transport is not implemented. This is not full storage parity.

- The encrypted issue-comment envelope is capped at approximately 11 KiB by the browser client; the broker parser caps the comment at 16 KiB.
- The preserved source services accept evidence uploads up to multiple megabytes, and R&M PDF exports can be much larger. These payloads cannot be carried through the current comment envelope.
- The old storage adapter's runner-local `blob:` URLs are not accessible from the user's browser or another workflow run. Signed upload URLs also depended on in-memory tickets that do not survive a separate Actions invocation.
- The storage adapter now fails closed for browser signed upload/download URL requests. It no longer returns a misleading runner-local blob URL or upload ticket as though it were a usable browser endpoint.
- The broker action policy now denies unsupported binary paths: Central Bank staff photo upload/read, Photo Evidence create/view/cleanup, R&M upload/export-create/export-url. Deletion and metadata operations that are server-side and supported remain separately permissioned.
- The GitHub edge runtime independently blocks Central Bank `identity-reset` and `staff-original-upload`. Those copied source actions contain paths that read/write/delete staff originals in `aka30art/DOWNTIME`; the GitHub twin must never invoke them. This defense-in-depth guard is in DowntimeUI only. The protected DOWNTIME repository has not been changed.

**Phase 4 remains BLOCKED.** A production decision is required between (a) a measured, secure chunked broker transport with durable staging, replay handling, and acceptable GitHub Actions/API throughput, or (b) a separate private object-storage transport. No external provider has been selected and no production files have been migrated. Do not claim photo-evidence, staff-photo or R&M binary parity until end-to-end browser upload/download and recovery tests pass.
