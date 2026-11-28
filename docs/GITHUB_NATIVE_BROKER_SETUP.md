# Private GitHub Actions broker setup

**Status:** configuration template only. No broker repository, data repository, GitHub App, key or secret has been provisioned by this PR.

## Required repository separation

Create three separate repositories:

1. **Public source/UI:** `aka30art/DowntimeUI`. Source code only; never operational data.
2. **Private broker/inbox:** dedicated private repository. Contains the default-branch issue-comment workflow and one private issue per mapped USER. No operational records or private data-store token.
3. **Private data store:** dedicated private repository. Contains the 42-table GitHub-native data schema, authority manifest, binary objects and event data. No public issue inbox.

Do not use `aka30art/DOWNTIME` or `aka30art/DOP-website` for any of these roles.

## GitHub Apps and permissions

- **Data App:** install only on the private data repository. Minimum required permissions: Contents read/write and Metadata read. The runner mints an installation token with an explicit single-repository `repository_ids` restriction.
- **Inbox App/OAuth client:** used for the user-facing GitHub authorization flow. Keep its permissions limited to the private broker repository and verify the exact OAuth/App permissions before accepting users.
- **Workflow GITHUB_TOKEN:** broker repository only, with Contents read and Issues write. It posts encrypted response comments. It must not have access to the data repository.
- **Broker ECDH key:** generate a dedicated P-256 key pair. Put only the private PKCS#8 key in the broker repository secret; publish the matching public key to the UI configuration. Rotation and recovery must be rehearsed before production.

## Broker repository variables

| Variable | Value |
|---|---|
| `DOWNTIMEUI_REF` | Exact audited DOWNTIMEUI commit SHA; never a moving branch for production |
| `YARDHUB_DATA_OWNER` | Owner of the private data repository |
| `YARDHUB_DATA_REPOSITORY` | Private data repository name |
| `YARDHUB_DATA_REPOSITORY_ID` | Numeric repository ID for the private data repository |
| `YARDHUB_DATA_BRANCH` | Protected data branch, default `data/yardhub` |
| `YARDHUB_DATA_APP_ID` | Data App ID |
| `YARDHUB_DATA_APP_INSTALLATION_ID` | Data App installation ID |
| `YARDHUB_BOOTSTRAP_GITHUB_USER_ID` | Optional, pre-approved GitHub numeric ID for the immutable DEV bootstrap identity |
| `YARDHUB_BOOTSTRAP_ISSUE_ID` | Optional numeric ID of the initial DEV's private inbox issue |
| `YARDHUB_EDGE_ORIGIN` | Exact production UI origin |

The broker repository ID is injected from `github.repository_id` by the workflow itself.

## Broker repository secrets

- `YARDHUB_DATA_APP_PRIVATE_KEY` — Data App private key (PEM).
- `YARDHUB_BROKER_ECDH_PRIVATE_KEY` — broker ECDH private key (PKCS#8 PEM).
- `GITHUB_TOKEN` — provided by GitHub Actions; grant only the workflow permissions above.

Never put these secrets, plaintext operational data, session tokens or decrypted payloads in issue comments, artifacts, caches or logs.

## Workflow installation

Copy `docs/templates/yardhub-private-broker.workflow.yml` to the **default branch** of the dedicated private broker repository at `.github/workflows/yardhub-broker.yml`. This caller template invokes the reusable workflow at `.github/workflows/yardhub-github-broker.yml` in the public source repository. Replace the `<PINNED_40_CHARACTER_COMMIT_SHA>` placeholder in its `uses:` line with the exact reviewed DOWNTIMEUI commit SHA, and set `DOWNTIMEUI_REF` to that same SHA.

The reusable inbox workflow is present in the PR branch but is not installed in a broker repository. It validates the private broker repository ID/full name/default branch, requires an issue-comment event, and only processes the encrypted request prefix. It mints a separate Data App token scoped to the private data repository. The caller's `GITHUB_TOKEN` is limited to `contents: read` and `issues: write`.

For identity onboarding, copy `docs/GITHUB_NATIVE_IDENTITY_ADMIN_WORKFLOW_TEMPLATE.yml` to the same private broker repository's default branch. It calls `.github/workflows/yardhub-github-identity-admin.yml`, accepts `workflow_dispatch` only, and uses `issues: read` plus the separate Data App token. Only the authenticated immutable DEV principal can link or revoke a GitHub identity. A link is accepted only for an active reciprocal USER/STAFF pair and an open, non-PR inbox issue assigned to that GitHub account.

GitHub's `issue_comment` workflow is loaded from the broker repository's default branch. A copy that exists only on a PR branch will not process comments. Pin `DOWNTIMEUI_REF` to the exact reviewed commit after the source PR has been accepted and merged under the separate release process.

The template uses one concurrency group per comment. This prevents duplicate delivery of the same comment from executing simultaneously; it does not serialize all users. Git ref compare-and-swap, durable idempotency and the authority-epoch recheck remain mandatory. Pending-run behaviour, throughput and rate limits must be tested before production.

## Initial identity and user enrolment

1. Create the private data repository and seed the initial immutable DEV identity out of band using the protected ROOTS bootstrap procedure.
2. Create a private inbox issue for that DEV in the broker repository.
3. Configure the initial DEV GitHub numeric ID and issue ID in the optional bootstrap variables.
4. Have immutable DEV link each active canonical USER/STAFF record to one GitHub numeric ID and one private inbox issue. Linking requires reciprocal USER/STAFF identity and is append-audited; revocation is also audited.
5. Verify that unknown, disabled, duplicate, unlinked, wrong-issue and wrong-repository actors are denied before operational data access.

The setup must fail closed if the data repository is public, the authority manifest is invalid, GitHub is not active primary, or the user's canonical USER/STAFF/YARD ROLE mapping cannot be resolved.

## Acceptance before activation

- Real GitHub event tests with at least two separate accounts and two private inbox issues.
- Confirm the workflow token cannot read or write the private data repository.
- Confirm the Data App installation token cannot access any repository except the private data repository.
- Verify every service action against VIEW/ENTER/EDIT/MANAGE and negative cases.
- Verify concurrent comments, duplicate event delivery, replay, pending/failed leases, rate limits and response recovery.
- Verify no plaintext data appears in GitHub comments, logs, artifacts, caches or workflow outputs.
- Exercise all five private storage buckets, checksums, clean-device restore and a separate full-twin backup repository.
- Rehearse authority cutover and reverse transfer.

**These are reusable workflow and caller templates, not a production configuration.** The private repositories, Apps, keys, secrets and caller workflows have not been provisioned or installed. Real event and two-account tests must pass before Phase 3 can pass.


The private data repository uses the dedicated `data/yardhub` branch by default. Do not point the broker at the source application's `main` branch.
