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
- `signInAnonymously()` with a fabricated `github-native-local-session` fallback;
- `signOut()` as a no-op.

The adapter does not verify the browser session with a trusted identity service. Its `functions.invoke()` constructs a local request to a handler; it is not an authenticated network boundary. The original Edge Functions' session checks cannot be treated as production authentication when the compatibility layer and data store are browser-resident.

**Required remediation:** remove synthetic sessions from production execution. Broker principal creation must be tied to verified GitHub actor identity; expired, disabled or unmapped users must be rejected before any data read or write.

### SEC-005 — Placeholder service secrets are injected into the Edge runtime
**Severity: HIGH · Status: OPEN**

`yardhub/runtime/github-edge-runtime.js` currently supplies fallback values including:
- `SUPABASE_SERVICE_ROLE_KEY = "github-native-service-adapter"`
- `DOWNTIME_IDENTITY_FINGERPRINT_SECRET = "github-native-fingerprint"`
- `GITHUB_STAFF_IMAGE_TOKEN = "github-native-storage"`
- `PHOTO_CLEANUP_SECRET = "github-native-cleanup"`
- `DOWNTIME_CANONICAL_AUTH_READY = "true"`

These are constants, not secret material or verified readiness signals. A configured-looking environment must not be allowed to imply that canonical authentication or trusted service access is active.

**Required remediation:** eliminate security-sensitive fallback strings. Required values must come from a protected runtime secret store and startup must fail closed when absent. The GitHub-native port should use explicit broker/storage interfaces rather than impersonating configured Supabase service credentials.

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
