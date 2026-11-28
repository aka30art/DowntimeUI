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

### Phase 5 — Multi-device acceptance
Connect two independent browser/device profiles to the same private repository. Commit a change on device A, manually refresh device B, and verify that B reads the new central version. Test stale concurrent writes and confirm conflict rejection.

### Phase 6 — Operational parity
Test Central Bank, DOWNTIME, GATELOG, R&M, Photo Evidence, Spectator Read and YARD HUB Settings against real GitHub persistence. Include USER/STAFF management, permissions, reports and PDF flows.

### Phase 7 — Files, offline and recovery
Test staff photos, DOWNTIME evidence, R&M attachments and reports through upload/read/delete/recovery. Verify configured object ceilings. Confirm offline cached data is read-only, failed writes are never reported as saved, and both JSON backup/restore and Git-history recovery work.

### Phase 8 — Release decision
Review the complete acceptance evidence against the exact final PR head. Only after every gate passes may merge/deployment be considered. The user must separately authorize release.

## Current gate status

- Obsolete broker and scheduled Supabase backup paths: removed from the branch; cleanup CI is being re-run.
- Direct runtime unit/service/browser tests: pending final green CI after cleanup.
- Real private repository, PAT and two-device tests: blocked pending data repository and credential setup.
- Full binary and recovery acceptance: pending real repository.
- Merge/deploy: prohibited until all gates pass.

## Protected boundary

The `aka30art/DOWNTIME` repository remains untouched and is not a source, destination or dependency for this twin.
