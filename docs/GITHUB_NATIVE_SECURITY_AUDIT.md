# YARDHUB GitHub-native twin — direct GitHub architecture and release audit

**Updated:** 28 November 2026  
**Target:** `aka30art/DowntimeUI`, PR #3, branch `architecture/github-native-yardhub-twin`

## Selected architecture

The user has explicitly selected the simplest GitHub-only design. The former GitHub Actions broker, OAuth inbox, ECDH request transport, scheduled Supabase backup and migration from MAIN are retired.

The active design is GitHub Pages plus one dedicated private GitHub data repository. The browser connects directly with a fine-grained PAT scoped to that repository. Existing YARDHUB USER/PIN and YARD ROLE interfaces remain application-level controls; the PAT itself grants repository-wide access and bypasses those controls if extracted. The token is persisted in the browser profile for reconnection, and every device must be configured with the same repository token.

The app runs the existing seven service modules locally through the GitHub-native compatibility runtime. The private repository is the shared source of truth. Startup/login loads central data; REFRESH DATA performs a manual read; saves use revision checks and must reject stale writes. No realtime/polling is used.

## Current validation

- Universal App Foundation CI run **#767** passed on commit `4b72ff7fdb498d92e2b0777a0fbc4b8aaec02e6b`, including `npm run check` and Chromium Playwright browser QA.
- Universal App Foundation CI run **#770** is validating the newer branch-default and acceptance-test changes on the current PR head.
- YARDHUB Real GitHub Acceptance run **#11** is blocked at its credentials preflight. Repository secrets `YARDHUB_DATA_REPOSITORY` and `YARDHUB_DATA_TOKEN` are empty; no live private-repository test was run.
- The offline-session restoration, invalid-token rejection, read-only-token rejection and writer-identity regression tests are covered by passing CI #767.
- The current YARDHUB runtime still has no user-facing full-system JSON export/restore workflow that includes operational tables and binary objects. Git history provides prior commits, but is not a substitute for a tested full backup/restore workflow. This remains a release blocker.


## Outstanding real-repository tests

No dedicated private data repository or fine-grained PAT has been supplied/provisioned for the app runtime. Therefore these checks are NOT yet evidenced:

- Private repository access using the actual app token.
- Empty schema initialisation and first DEV ROOT bootstrap.
- Two independent browser/device sessions reading and writing the same repository.
- Manual refresh from device B after device A commits.
- Simultaneous writes and stale-revision rejection.
- All seven module workflows against real GitHub persistence.
- Binary uploads/downloads/deletes for staff photos, operational evidence, R&M attachments and reports.
- Offline cached reads, no false save-success, JSON backup/restore and Git-history recovery.

Automated mocks and browser smoke tests are not substitutes for these real-repository acceptance gates.

## Security and operational trade-off

The PAT is stored in browser local storage in the YARDHUB runtime. Anyone with access to the browser profile or extracted token can read/write the entire private repository outside YARD ROLE restrictions. This is the deliberately accepted simplicity trade-off. Do not describe it as server-enforced multi-user authorization.

GitHub API rate limits, repository growth, Git history size and binary object ceilings must be monitored. Current configured binary limits are 10 MB overall, 5 MB for original STAFF PNGs and 4 MB for R&M attachments; each flow still needs real-repository validation.

## Release decision

**NOT READY TO MERGE OR DEPLOY.** Keep PR #3 open and draft until the cleanup CI and all real-repository acceptance gates pass.

The protected `aka30art/DOWNTIME` repository has not been accessed or modified. No operational data is imported from MAIN.
