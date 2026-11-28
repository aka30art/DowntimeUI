# GitHub-native YARDHUB broker — Phase 3 proof specification

**Status:** DESIGN CANDIDATE — CLIENT AND LOCAL BROKER CORE PARTIALLY IMPLEMENTED; NOT DEPLOYED OR ACCEPTED  
**Target PR:** `aka30art/DowntimeUI` #3  
**Scope:** GitHub-only request transport, identity boundary, private data repository gateway  
**Protection:** No operation in this specification may target or modify `aka30art/DOWNTIME`.

## 1. Decision

The current browser-direct GitHub Contents-token design is rejected for multi-user operations. A token that can read/write the data repository bypasses application USER/STAFF, ROOTS and YARD ROLE controls.

The GitHub-native candidate is a **GitHub Actions request broker**, triggered by `issue_comment.created` in a dedicated broker/inbox repository. Two inbox deployment modes remain under comparison:

- **Private inbox (preferred for confidentiality):** users need access to the private broker repository to comment. The broker code and request metadata are not public; ciphertext still protects payloads from other repository collaborators.
- **Public inbox (accessibility alternative):** staff do not need private-repository membership, but GitHub usernames, request timing/frequency and ciphertext metadata become public. This mode must pass an explicit metadata/privacy and abuse/denial-of-service review before use.

The public DOWNTIMEUI Pages app remains a static client. It submits encrypted request envelopes; the Actions workflow derives the actor from GitHub's authenticated event, resolves the canonical USER/ROOTS/YARD ROLE records, performs a transaction against a separate private data repository, and returns an encrypted result.

This is an asynchronous message broker, not a synchronous HTTP API. It must be rejected if measured latency, throughput, queue limits or availability cannot support the actual YARDHUB operational workflows. The request-channel authentication flow and binary evidence transport are not yet selected or proven.

## 2. Repository and credential boundaries

Three distinct repositories are required:

| Repository | Visibility | Purpose | Who receives access |
|---|---|---|---|
| `DowntimeUI` | Public source/Pages | Static UI, source code, public broker encryption key, no operational records or secrets | Public |
| `YARDHUB-BROKER` | Private preferred; public variant requires separate approval | Default-branch workflow, protocol implementation, broker config and encrypted request/response channel; no operational records | Staff receive request-channel permission only; broker maintainers own workflow code |
| `YARDHUB-DATA` | Private | Operational JSON tables, audit history, authority manifest, idempotency ledger, binary storage objects, recovery checkpoints | Separate Data GitHub App only; no staff Contents access |

The broker and data repositories must be newly provisioned for this purpose. Do not reuse `DOWNTIME`, `DOP-website` or any public repository as the operational data store.

### Browser credential

The UI must not receive a token with `Contents` access to `YARDHUB-DATA`. Use **two separate GitHub Apps** so inbox and data permissions cannot be combined in one user token:

1. **Inbox App:** only Issues: write on the broker repository. A GitHub App user access token authorizes the request comment. The app must not have Contents, Actions, Administration or data-repository permissions. A user access token is limited by the intersection of App permissions and the user's own repository access. In the web authorization exchange, the optional `repository_id` parameter can further restrict it to the one broker repository ID.
2. **Data App:** installed only on `YARDHUB-DATA`. Its private key exists only as a protected broker Actions secret. The workflow mints an installation token restricted to the single data repository ID and the minimum required Contents permission. No user token is issued from this App.

GitHub recommends the web application authorization flow with PKCE for browser applications. Its code exchange requires the App client secret, but GitHub explicitly recognises that a single-page application is a public client and that the secret cannot be kept confidential; PKCE must therefore be used, and the client secret is configuration rather than a security boundary. The local client now implements the web application flow with state validation, PKCE S256 and a `repository_id` restriction on the token-exchange request. It does not request refresh tokens; the access token remains in memory with a maximum local use window of 30 minutes. Actual GitHub App registration, token permission inspection and real callback operation remain unproven.

A fine-grained token with Actions: write is **not** the default request transport: that permission also allows actions such as cancelling/rerunning runs, deleting artifacts/logs and disabling workflows. This broader authority needs a separate justification and is not accepted merely because it can dispatch a workflow.

The create-issue-comment API requires Issues: write for a fine-grained GitHub App user token. The proof must establish the least-privilege permission set, whether private-inbox users require repository membership, and whether that membership enables unwanted issue/repository operations. Treat these as test gates, not assumptions.

## 3. Request flow

1. The local proof client now authorizes the Inbox GitHub App through the web application flow. It validates OAuth state and PKCE S256, exchanges the authorization code with the App's public-client configuration and sends the broker repository ID restriction at token exchange. The resulting user access token is kept in memory only for up to 30 minutes; no refresh token is requested or persisted. The Inbox App must have Issues: write only and no Contents, Actions, Administration or data-repository permission. This is a deterministic client contract only; real GitHub callback, actual token permissions and token scope have not yet been verified.
2. User's GitHub account is mapped by immutable numeric account ID to the canonical USER record. If a private inbox is selected, that account must also have the intended minimum access to the broker repository.
3. The UI builds a strict, versioned request envelope. Its payload is encrypted to the broker's public encryption key before it is submitted as an issue comment. Plaintext operational fields, record names, customer data, fault descriptions, images, PINs and tokens must not appear in the issue title/body or comment.
4. The comment is posted to the pre-registered request issue assigned to that user. The issue number is not selected from arbitrary client input.
5. GitHub emits an `issue_comment.created` event. The private broker workflow is loaded from the broker repository's default branch. It rejects pull-request comments and events for unknown issue IDs.
6. The broker derives the transport actor exclusively from `github.event.sender.id` and the event's repository/issue/comment identifiers. It does not accept `actorId`, username, tier, role, department, permission, audit actor or tenant identity from the decrypted request as authority.
7. The broker decrypts and validates the envelope, resolves the immutable GitHub account ID to an active canonical USER, then obtains the actor's ROOTS/YARD ROLE/department rights from the private data repository.
8. The broker authorizes the exact service, action, tenant, module, record and current authority epoch. All checks are default-deny and server-side.
9. A **separate Data App** installation token, restricted to the `YARDHUB-DATA` repository ID and required Contents permission, performs the operation. The Inbox App never receives data-repository access. The data store uses optimistic ref compare-and-swap, bounded retries and an idempotency ledger. The workflow never checks out an issue, comment, branch or fork supplied by the user as executable code.
10. The result is encrypted to the requesting USER's registered public key and posted as a comment to that user's request issue. The UI polls the comment channel and decrypts only its own response.

The event actor is the authentication evidence. A field inside the request envelope is only a requested operation or target, never proof of identity.

## 4. Cryptographic envelope and privacy requirements

The actual cryptographic library and version must be selected after dependency/security review; do not implement a bespoke cipher.

Required properties:
- Authenticated public-key encryption from client to broker and broker to the intended user.
- Per-user key pair with the private key held by the user/device, never sent to the broker or committed to Git.
- User public key and key version registered against the canonical USER ID by a privileged, audited onboarding flow.
- A stable, non-secret request ID, protocol version, key ID, bounded creation time and nonce.
- AEAD associated data binds at least the broker repository ID, issue ID, protocol version and authority epoch.
- Broker rejects tampered, expired, unsupported, over-size, unknown-key and duplicate/replayed envelopes.
- Responses are encrypted to the intended user's current public key; other broker collaborators cannot read operational responses even though they can see issue comments.
- Key rotation/revocation, lost-device recovery and two-device onboarding must be designed and tested. A missing/deactivated key must fail closed rather than fall back to plaintext.

Issue titles, issue bodies, labels, branch names, workflow names, logs, run annotations, artifacts, caches and commit messages must contain no operational data. The only permitted plaintext in the broker control plane is a minimal generic status that does not identify an operational record or reveal its contents.

## 5. GitHub Actions workflow requirements

The candidate trigger is:

```yaml
on:
  issue_comment:
    types: [created]
```

Required workflow guardrails:
- The workflow file must exist on the private broker repository's default branch before `issue_comment` can trigger it. A workflow file only present on this PR branch cannot prove this design.
- Ignore pull-request comments: require `github.event.issue.pull_request` to be absent.
- Accept only comments on exact pre-registered broker issue(s) and from mapped human GitHub accounts. For a public inbox, reject unknown sender IDs before any secret-bearing step is eligible to run; protect the public repo from comment spam and workflow-cost exhaustion.
- Use a fixed, pinned workflow implementation from the broker's default branch; never execute event text, issue content, user branch content or a checkout ref supplied by the user.
- Keep `GITHUB_TOKEN` permissions minimal. Use it only for required broker-repository response comments.
- Use a separate Data App installation token for cross-repository data access, installed only on `YARDHUB-DATA` with the minimum repository permissions required. Do not store this token in the browser.
- Use a separate Inbox App whose only user-token permission is Issues: write on the broker repository. Never add Contents permission to that App.
- Protect the App private key and encryption private key as broker secrets; mask them and never print secret-bearing objects.
- Do not expose operational payloads in logs, output variables, artifacts or caches. Disable verbose debug output in the broker job.
- Reject stale authority epochs before every read/write operation, and reject stale epoch at commit.
- Make event comment ID the transport idempotency key. Re-runs of the same event must not duplicate writes or audit events.
- Use a global serialized data-write lane for operations that need ordered Git ref mutation. Test the current GitHub Actions concurrency queue semantics and maximum pending depth; a full queue must return an explicit retryable response without silently dropping an accepted write.
- Do not use `pull_request_target` for this broker. Do not check out a contributor PR or untrusted branch in a privileged workflow.

GitHub documents that `issue_comment` workflow runs use the default branch and only trigger if the workflow file exists on that default branch. GitHub Actions concurrency defaults to one pending run per group, replacing earlier pending work; the optional `queue: max` supports up to 100 pending runs before additional runs are cancelled. These constraints require a queue/backpressure proof; they are not a durable operational message queue.

## 6. Authorization contract

The broker must resolve and enforce:
- GitHub immutable account ID → canonical USER ID; never map by mutable login alone.
- USER status: active, not archived, disabled or locked.
- Staff linkage and department assignment.
- ROOTS authority and immutable DEV/DEV1/ADMIN protections from the source contract.
- YARD ROLE assignment and department/module permission level: VIEW, ENTER, EDIT or MANAGE.
- Exact action-to-permission mapping; no privilege escalation by passing a role/tier field.
- Record scope: attachment, customer/vehicle/visit, fault/asset, daily operator, configuration or other record must be checked against its owning module and allowed department.
- Current authority epoch and system primary/secondary role.
- Audit identity from the authenticated event principal only.

Unknown identity, missing mappings, disabled users, expired/revoked keys, malformed requests, unavailable secrets, unavailable data repository, stale epoch and ambiguous authorization all fail closed.

## 7. Proof environment and acceptance tests

This proof must use a newly provisioned disposable broker/inbox repository (private preferred; public mode requires a separate metadata/abuse approval) and a separate disposable private data repository, with synthetic records only. No DOWNTIME production records or credentials are permitted.

| Gate | Required test evidence |
|---|---|
| B-01 Default-branch trigger | An issue comment on a registered issue triggers the exact default-branch workflow; PR comments and unregistered issues do not |
| B-02 Least privilege | Browser credential can submit/read broker requests but cannot read or write data repo contents, Actions secrets or workflow files |
| B-03 Actor authenticity | Sender ID maps to the canonical USER; forged actor IDs/names/roles in JSON are ignored; bots/unknown users rejected |
| B-04 Encryption | Tampered ciphertext, wrong key, invalid tag, unknown key, expired envelope and oversized payload rejected |
| B-05 Privacy | Automated scan confirms no plaintext request/response data in issue/comment metadata, logs, outputs, artifacts or caches |
| B-06 Authorization | No-session, disabled, wrong department, VIEW-only, ENTER-only, EDIT-only, MANAGE, ROOTS, DEV and SPECTATOR matrices produce expected allow/deny decisions |
| B-07 Service semantics | Each of the 96 service action/read surfaces has request/response, table change, audit and failure parity tests |
| B-08 Replay/idempotency | Replayed comment/event, workflow retry and duplicate request ID do not duplicate state or audit |
| B-09 Concurrency | Multi-user writes, same-record conflicting writes, queue saturation, CAS conflicts and retry exhaustion preserve atomic state and return deterministic outcomes |
| B-10 Recovery | Broker interruption, runner termination, data-branch conflict and failed response delivery never produce partial or duplicate state; user can safely retrieve a completed response |
| B-11 Latency/throughput | Measure cold-start, median, p95/p99, queue wait and completion time under representative simultaneous operators and burst load |
| B-12 Two-device use | Same USER can securely use two devices; key recovery, rotation and revocation work without server-held plaintext private keys |
| B-13 Credential revocation | Revoke user's broker token and disable USER; further requests are denied while other users continue |
| B-14 Secret/repo isolation | Only Data App can access data repo; no human user can obtain either App private key or data Contents permission |
| B-15 Failure mode | Missing secrets, revoked App installation, API throttling, Actions outage and full queue are visible as recoverable errors, never silent success |
| B-16 Binary evidence transport | Upload/download/delete for photos and PDFs can move through the broker without granting users Contents access; encrypted chunking, integrity, size limits, resume, retries and queue cost are measured against all five source Storage buckets |
| B-17 Inbox privacy and abuse | Private/public inbox trade-off approved; public-mode metadata is assessed; unauthorised comments do not reach secret-bearing steps; comment spam cannot exhaust Actions budget or starve valid operators |

**Pass condition:** every gate above passes on the private test infrastructure, all results are reproducible, and measured latency is accepted for actual Yardhub operations. A passing local mock is not sufficient.

## 8. Provisioning dependency and current blocker

The connected GitHub tooling available in this workspace supports reading repositories/PRs and committing source files. It does not provide a repository-creation, GitHub App-registration, repository-secret management or private broker provisioning action. The only accessible private repository is the unrelated `DOP-website`, which is explicitly excluded.

Therefore Phase 3 cannot be honestly called implemented or accepted in this workspace. The next technical dependency is a dedicated broker/inbox repository, a separate private data repository, two distinct GitHub Apps (Inbox App with Issues: write only; Data App with private-data Contents permission only), protected broker secrets, PKCE/user onboarding and synthetic test USER accounts. Do not weaken the permission model, place a data token in the browser, use the existing DOP repository, or merge this PR merely to make a default-branch workflow trigger.

## 9. Sources and protected boundary

Official GitHub documentation:
- [Events that trigger workflows — issue_comment](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issue_comment)
- [Control the concurrency of workflows and jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [REST API endpoints for issue comments](https://docs.github.com/en/rest/issues/comments)
- [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)
- [GitHub App user access tokens — user/app permission intersection and repository restriction](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub App best practices — public-client PKCE and device-flow phishing risk](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
- [Create a workflow dispatch event — Actions: write permission](https://docs.github.com/en/rest/actions/workflows)

This document does not grant authority to create external infrastructure or change protected repositories. All source changes are confined to `aka30art/DowntimeUI`. `aka30art/DOWNTIME` remains untouched. YARDHUB remains primary. No production record has been migrated, no authority switch has occurred, and PR #3 remains open/draft.


## 10. Current code state — 27 November 2026

The following code now exists in PR #3:

- `src/infrastructure/github-app-broker-client.js` implements GitHub App web authorization with PKCE S256, random state, callback verification and the `repository_id` restriction during token exchange. It verifies the authenticated GitHub profile and keeps the user access token in module memory for a maximum local window of 30 minutes. The App client secret is public-client configuration, not a secret boundary. Its request/response channel uses ephemeral P-256 ECDH, HKDF-SHA-256 and AES-256-GCM. The public issue comment contains ciphertext, not the tested customer/vehicle payload.
- ECDH request keys are currently ephemeral in the client return context. A page reload or device loss removes the ability to decrypt an already-completed response. No IndexedDB CryptoKey persistence, multi-device recovery or encrypted export/restore of pending request contexts is implemented. This blocks reliable interrupted-operation recovery.
- `src/infrastructure/github-actions-broker.js` implements a local orchestration core for the existing ECDH envelope: event repository/sender/issue/comment validation, numeric sender-ID principal lookup, per-USER inbox issue authorization, decryption callback, strict action schema, caller-identity field rejection, current authority-epoch check, YARD ROLE authorization callback, idempotency claim and encrypted response callbacks.
- `tests/github-app-broker-client.test.js` exercises encryption/decryption, tamper rejection, expiry, PKCE/state validation, callback code exchange and repository-ID restriction using mocked GitHub HTTP responses. `tests/github-actions-broker-e2e.test.js` joins the cryptographic client and callback-driven Actions core for a local encrypted request/response and idempotent replay.
- The base64url decoder applies pre-decode and decoded-byte limits sized to the 11 KB envelope contract; request and response payloads above 1 KB have explicit regression coverage.
- `tests/github-actions-broker.test.js` exercises event identity, inbox ownership, canonical USER mapping, decryption failure, permission denial, caller-supplied identity rejection, replay and missing authority epoch.

**Important limitations:**
1. The client now uses web authorization with PKCE S256. Its static-client App secret is visible in the application bundle and must never be treated as confidential; security depends on PKCE, minimum App permissions, token repository restriction and actor verification from the issue-comment event. The registered App's actual settings and the returned token's real permissions have not been inspected.
2. The broker core is callback-driven. The private USER resolver, inbox ownership lookup, cryptographic broker key, data-repository adapter, atomic idempotency ledger, permission evaluator and encrypted comment publisher are not connected.
3. No `issue_comment` Actions workflow exists on a dedicated broker repository's default branch. No private broker or data repository has been provisioned, and no App credentials/secrets are installed.
4. The client holds the ephemeral response-decryption private key in memory. Recovery after page/device loss and secure two-device use are not yet solved.
5. The tests are deterministic local/mock tests. They do not prove the real event context, GitHub App permissions, separate Data App isolation, public/private inbox privacy, queue behaviour, rate limits or end-to-end latency.

The official GitHub documentation supports the `repository_id` restriction parameter in the web application token exchange, recommends PKCE S256 for browser clients and describes Device Flow for headless/constrained clients. The local implementation follows the browser-flow recommendation, but real App configuration and permission-isolation acceptance remain open.

**Phase 3 remains BLOCKED.** No operational data, production credentials or YARDHUB authority have been moved.


## 11. Implementation delta and current release gate — 28 November 2026

This section supersedes earlier statements that the broker has no concrete identity resolver, permission evaluator, session issuer or idempotency adapter. Those components now exist locally in PR #3:

1. **Identity and authorization:** `github-broker-authority.js` resolves immutable numeric GitHub IDs to active canonical USER/STAFF records, reciprocal STAFF profiles, ROOTS status and YARD ROLE department capabilities. The action catalogue is default-deny and covers 96 source service actions/read surfaces. `github-broker-identity-admin.js` limits account linking/revocation to immutable DEV and writes an audit record.
2. **Session boundary:** the broker rejects caller-provided actor/role/session/access-token fields. It mints a short-lived Central Bank-compatible session from the verified principal, stores only the SHA-256 hash, and revokes the session after the service call.
3. **Atomicity and replay:** the broker idempotency ledger uses durable private-store rows and lease recovery. The service action and transition of the request ledger to COMMITTED occur in the same staged GitHub database transaction. Completed requests replay the saved encrypted response rather than execute twice.
4. **Authority lock:** broker operations are disabled while `YARDHUB-PRIMARY` is primary. The data-store transaction accepts an expected authority epoch and validates the authority manifest at the same commit SHA as the data snapshot; it requires ACTIVE status, the exact epoch and `DOWNTIMEUI-GITHUB` as primary. This is a hard gate, not an authority-transfer mechanism.
5. **Actions runner:** `run-github-actions-broker.mjs` restricts the Data App installation token to a separate configured data-repository ID and validates event name/action, repository full name/ID, private visibility, default-branch ref and non-PR issue context. The script is not installed in a dedicated broker repository workflow.
6. **Pending response recovery:** the browser client includes an IndexedDB adapter for pending request contexts and ECDH CryptoKey persistence. Real browser persistence, reload recovery and two-device/key-loss recovery remain unaccepted.

**Production proof is still incomplete.** No dedicated private broker repository or private data repository is provisioned; no Inbox/Data GitHub Apps or secrets are configured; no default-branch `issue_comment` workflow exists; no real GitHub event, App permission, two-account isolation, load/queue, latency, private-storage, or disaster-recovery proof has passed. The local tests remain mock-based and do not prove the actual GitHub trust boundary.

The broker must remain fail-closed while YARDHUB is primary. PR #3 remains open/draft; no merge, deployment, production data migration or authority transfer is authorised. `aka30art/DOWNTIME` remains untouched.


## Implementation update — 28 November 2026

The broker is now an implemented integration path in the PR branch, not only an interface sketch. The following code paths exist:

- `github-app-broker-client.js`: encrypted ECDH request/response envelopes, per-user inbox issue context, PKCE/OAuth client flow, and rejection of caller-supplied session/authorization credentials.
- `github-broker-authority.js`: GitHub actor to canonical USER/STAFF resolution, per-user issue binding, immutable DEV-only identity link/revoke, and service/action-to-YARD ROLE permission checks.
- `github-central-service-session.js`: short-lived Central Bank-compatible sessions; only SHA-256 token hashes are persisted and the broker revokes sessions after each action.
- `github-actions-broker-store.js`: durable request claims, lease recovery, actor-bound replay prevention, encrypted response replay and active-primary epoch lookup.
- `github-actions-broker-runtime.js`: composes the authority resolver, broker, private data store, preserved Edge handlers, encrypted response channel and durable ledger.
- `github-actions-broker-runtime.test.js`: local encrypted request-to-handler integration coverage with a memory-backed data store and YARD ROLE fixture.
- `github-edge-runtime.js`: commits the idempotency state in the same transaction as a successful action and rejects a changed authority epoch before handler execution/commit.
- `scripts/run-github-actions-broker.mjs`: Actions entrypoint; mints a GitHub App installation token scoped to the configured private data repository, imports the broker ECDH key, loads the authenticated event and posts only encrypted responses to the broker inbox.
- `scripts/yardhub-backup-to-github.mjs`: source replication now preserves GitHub-only broker tables rather than treating them as stale source paths.

### Data contract

The GitHub-native store has 42 tables: the 39 source YARDHUB tables plus three GitHub-only extension tables:

- `downtime_github_identities` — canonical USER/STAFF to GitHub actor and dedicated inbox issue mapping.
- `downtime_github_broker_requests` — actor-bound request idempotency, lease and encrypted response ledger.
- `downtime_github_broker_identity_audit` — append-only identity link/revoke audit.

The source backup manifest remains a 39-table contract. A source restore initializes broker extensions empty; source replication preserves already-present extension rows. This prevents source backup cleanup from deleting identity or idempotency state.

### Latest validation evidence

- CI run #613 on `603c15ac873cf850fd12ba9040df8e9ef8100b8c` passed `npm run check`, including the broker runtime, identity, idempotency and backup-preservation tests. Chromium installation/browser QA was still running at the time this note was written.
- The current PR head is newer than that tested commit and has its own CI run in progress. No pass is claimed for the newer head until that run completes.
- Browser tests and local integration tests use in-memory stores and mock GitHub calls. They prove deterministic code paths, not the real GitHub trust boundary.

### Production proof still blocked

No dedicated private broker repository or private YARDHUB data repository has been provisioned. The Inbox and Data GitHub Apps, installation, protected secrets, broker ECDH keys and default-branch `issue_comment` workflow have not been configured or exercised. There is no real GitHub event, two-account isolation, production queue/backpressure, latency, or private binary-storage proof.

The three broker extension tables are preserved during source replication, but a separate private backup repository and full recovery rehearsal for the entire GitHub twin—including broker identities, audit and idempotency state—remain outstanding. Initial immutable DEV provisioning in the private data repository also remains an out-of-band setup gate.

**Release position is unchanged:** YARDHUB remains primary; the broker must fail closed until the GitHub twin is explicitly active primary. No production records have been copied, no authority transfer has occurred, and PR #3 remains open/draft.
