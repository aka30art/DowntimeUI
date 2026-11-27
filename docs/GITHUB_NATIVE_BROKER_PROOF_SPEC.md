# GitHub-native YARDHUB broker — Phase 3 proof specification

**Status:** DESIGN CANDIDATE ONLY — NOT IMPLEMENTED OR ACCEPTED  
**Target PR:** `aka30art/DowntimeUI` #3  
**Scope:** GitHub-only request transport, identity boundary, private data repository gateway  
**Protection:** No operation in this specification may target or modify `aka30art/DOWNTIME`.

## 1. Decision

The current browser-direct GitHub Contents-token design is rejected for multi-user operations. A token that can read/write the data repository bypasses application USER/STAFF, ROOTS and YARD ROLE controls.

The only GitHub-native broker candidate carried forward for proof is a **private GitHub Actions request broker**, triggered by comments on pre-registered issues in a private broker repository. The public DOWNTIMEUI Pages app remains a static client. It sends encrypted request envelopes to the broker issue channel; an Actions workflow derives the actor from GitHub's webhook event, authorizes against the canonical USER/ROOTS/YARD ROLE records, performs a transaction against a separate private data repository, and returns an encrypted result.

This is an asynchronous message broker, not a synchronous HTTP API. It must be rejected if measured latency, throughput, queue limits or availability cannot support the actual YARDHUB operational workflows.

## 2. Repository and credential boundaries

Three distinct repositories are required:

| Repository | Visibility | Purpose | Who receives access |
|---|---|---|---|
| `DowntimeUI` | Public source/Pages | Static UI, source code, public broker encryption key, no operational records or secrets | Public |
| `YARDHUB-BROKER` | Private | Default-branch workflow, protocol implementation, public-key registry if not stored in data, broker configuration and issue/comment request channel | Approved staff receive issue/comment capability only; broker maintainers own code |
| `YARDHUB-DATA` | Private | Operational JSON tables, audit history, authority manifest, idempotency ledger, binary storage objects, recovery checkpoints | Broker GitHub App only; no staff Contents access |

The broker and data repositories must be newly provisioned for this purpose. Do not reuse `DOWNTIME`, `DOP-website` or any public repository as the operational data store.

### Browser credential

The UI must not receive a token with `Contents` access to `YARDHUB-DATA`. The submission credential may only operate the broker request channel. A candidate is a fine-grained GitHub App user token or fine-grained PAT with the minimum Issues permission needed to create/read a comment in the private broker repository, and no Contents, Actions, Administration or data-repository permission.

GitHub's create-issue-comment API documents Issues: write (or Pull requests: write) as the fine-grained permission requirement. The proof must establish the actual least-privilege permission set, whether users require repository triage access, and whether that access enables unwanted issue/repository operations. Treat this as a risk to test, not an assumed security guarantee.

## 3. Request flow

1. User signs into the static YARDHUB UI with the GitHub account that is mapped to their canonical USER record.
2. The UI obtains a narrowly scoped broker-channel credential. It is never granted access to the private data repository.
3. The UI builds a strict, versioned request envelope. Its payload is encrypted to the broker's public encryption key before it is submitted as an issue comment. Plaintext operational fields, record names, customer data, fault descriptions, images, PINs and tokens must not appear in the issue title/body or comment.
4. The comment is posted to the pre-registered request issue assigned to that user. The issue number is not selected from arbitrary client input.
5. GitHub emits an `issue_comment.created` event. The private broker workflow is loaded from the broker repository's default branch. It rejects pull-request comments and events for unknown issue IDs.
6. The broker derives the transport actor exclusively from `github.event.sender.id` and the event's repository/issue/comment identifiers. It does not accept `actorId`, username, tier, role, department, permission, audit actor or tenant identity from the decrypted request as authority.
7. The broker decrypts and validates the envelope, resolves the immutable GitHub account ID to an active canonical USER, then obtains the actor's ROOTS/YARD ROLE/department rights from the private data repository.
8. The broker authorizes the exact service, action, tenant, module, record and current authority epoch. All checks are default-deny and server-side.
9. A broker-only GitHub App installation token with access restricted to `YARDHUB-DATA` performs the operation. The data store uses optimistic ref compare-and-swap, bounded retries and an idempotency ledger. The workflow never checks out an issue, comment, branch or fork supplied by the user as executable code.
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
- Accept only comments on the exact pre-registered broker issue(s) and from mapped human GitHub accounts.
- Use a fixed, pinned workflow implementation from the broker's default branch; never execute event text, issue content, user branch content or a checkout ref supplied by the user.
- Keep `GITHUB_TOKEN` permissions minimal. Use it only for required broker-repository response comments.
- Use a GitHub App installation token for cross-repository data access, installed only on `YARDHUB-DATA` with the minimum repository permissions required. Do not store this token in the browser.
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

This proof must use newly provisioned disposable private broker and data repositories, with synthetic records only. No DOWNTIME production records or credentials are permitted.

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
| B-14 Secret/repo isolation | Only broker App can access data repo; no human user can obtain broker private key, App key or data Contents permission |
| B-15 Failure mode | Missing secrets, revoked App installation, API throttling, Actions outage and full queue are visible as recoverable errors, never silent success |

**Pass condition:** every gate above passes on the private test infrastructure, all results are reproducible, and measured latency is accepted for actual Yardhub operations. A passing local mock is not sufficient.

## 8. Provisioning dependency and current blocker

The connected GitHub tooling available in this workspace supports reading repositories/PRs and committing source files. It does not provide a repository-creation, GitHub App-registration, repository-secret management or private broker provisioning action. The only accessible private repository is the unrelated `DOP-website`, which is explicitly excluded.

Therefore Phase 3 cannot be honestly called implemented or accepted in this workspace. The next technical dependency is a dedicated private broker repository, separate private data repository, GitHub App installed on the data repo, broker secrets and a test USER roster. Do not weaken the permission model, place a data token in the browser, use the existing DOP repository, or merge this PR merely to make a default-branch workflow trigger.

## 9. Sources and protected boundary

Official GitHub documentation:
- [Events that trigger workflows — issue_comment](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issue_comment)
- [Control the concurrency of workflows and jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [REST API endpoints for issue comments](https://docs.github.com/en/rest/issues/comments)
- [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)

This document does not grant authority to create external infrastructure or change protected repositories. All source changes are confined to `aka30art/DowntimeUI`. `aka30art/DOWNTIME` remains untouched. YARDHUB remains primary. No production record has been migrated, no authority switch has occurred, and PR #3 remains open/draft.
