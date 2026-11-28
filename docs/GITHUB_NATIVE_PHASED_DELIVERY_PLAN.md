# YARDHUB GitHub-native twin — delivery and acceptance plan

**Updated:** 28 November 2026  
**Target:** PR #3 · `architecture/github-native-yardhub-twin`  
**Release rule:** PR #3 remains open and draft. No merge or deployment until every acceptance gate passes.

## Locked architecture

- GitHub Pages serves the static application.
- One dedicated private GitHub repository stores shared JSON records and supported binary objects.
- Every device connects directly with the same fine-grained repository-scoped PAT.
- Existing YARDHUB USER/PIN and YARD ROLE interfaces remain application-level controls; the PAT itself grants repository-wide access.
- Startup/login loads central data; REFRESH DATA retrieves the latest state on demand.
- Writes commit to GitHub with revision checks. Stale writes are rejected.
- No Supabase service, external database, Actions broker, OAuth inbox, scheduled backup bridge, live sync, background polling or migration from MAIN.
- First installation is empty and starts with DEV ROOT only. All remaining configuration and records are entered manually.

## Delivery phases

### Phase 1 — Retire obsolete architecture
Remove broker workflows, OAuth/inbox code, broker identity tables, broker-only runtime paths, scheduled Supabase backup and source-data restore paths. Keep the local Supabase-compatibility shim only as an interface adapter for the preserved service handlers; it must not make network calls to Supabase.

### Phase 2 — Verify direct GitHub runtime
Validate private repository checks, token scoping guidance, empty schema bootstrap, central USER/PIN login, local service routing, GitHub JSON writes, binary object transport and recovery behaviour.

### Phase 3 — Automated validation
Run syntax checks, all unit/service tests, service bundle builds and Chromium browser QA on one exact PR head. Ensure no obsolete broker or backup workflow remains and no background polling is started.

### Phase 4 — Real repository provisioning
Create a dedicated private repository (suggested name `YARDHUB-DATA`). Connect a fine-grained PAT with Contents read/write and Metadata read. Verify private visibility, repository identity and forbidden-repository protection. Initialize the empty schema and DEV ROOT.

The branch includes a manual `YARDHUB Real GitHub Acceptance` Actions workflow. Before running it, add these repository Actions secrets in `aka30art/DowntimeUI`:
- `YARDHUB_DATA_REPOSITORY`: the private data repository in `owner/repo` form.
- `YARDHUB_DATA_TOKEN`: fine-grained PAT scoped only to that private repository, with Contents read/write and Metadata read.
- `YARDHUB_DATA_BRANCH`: optional branch name; when omitted, the runtime and acceptance script use the repository's declared default branch.

Then run **Actions → YARDHUB Real GitHub Acceptance → Run workflow** on this PR branch. The workflow verifies repository privacy, initializes the empty 39-table schema if needed, checks two independent store sessions, refresh visibility, stale-write rejection, binary object transport and offline cached reads. It removes its temporary test records and object. Run this before creating DEV ROOT; the first-run assertion expects an empty USER directory.

### Phase 5 — Multi-device acceptance
Connect two independent browser/device profiles to the same private repository. Commit a change on device A, manually refresh device B, and verify that B reads the new central version. Test stale concurrent writes and confirm conflict rejection.

### Phase 6 — Operational parity
Test Central Bank, DOWNTIME, GATELOG, R&M, Photo Evidence, Spectator Read and YARD HUB Settings against real GitHub persistence. Include USER/STAFF management, permissions, reports and PDF flows.

### Phase 7 — Files, offline and recovery
Test staff photos, DOWNTIME evidence, R&M attachments and reports through upload/read/delete/recovery. Verify configured object ceilings. Confirm offline cached data is read-only, failed writes are never reported as saved, and both JSON backup/restore and Git-history recovery work.

### Phase 8 — Release decision
Review the complete acceptance evidence against the exact final PR head. Only after every gate passes may merge/deployment be considered. The user must separately authorize release.

## Current gate status

- Obsolete GitHub Actions broker and scheduled Supabase backup workflows: removed. The GitHub-native compatibility shim remains local to the browser and has no Supabase network or realtime transport.
- Universal App Foundation CI #767: passed, including `npm run check` and Playwright browser QA. CI #770 is validating the latest branch-default and browser regression tests.
- YARDHUB Real GitHub Acceptance #11: blocked at credential preflight because `YARDHUB_DATA_REPOSITORY` and `YARDHUB_DATA_TOKEN` are not configured. No real private-repository test has been executed.
- The acceptance script verifies empty fresh-install tables, DEV ROOT bootstrap identity, two independent store clients, stale-write rejection, binary object transport and offline cached reads. It does not yet prove all module workflows or real browser/device behaviour.
- Full-system JSON backup/restore including binary objects is not yet exposed in the YARDHUB runtime. Git history is available, but full recovery acceptance remains a release blocker.
- Merge/deploy: prohibited until all gates pass.

## Protected boundary

The `aka30art/DOWNTIME` repository remains untouched and is not a source, destination or dependency for this twin.
