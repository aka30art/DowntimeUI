# YARDHUB GitHub-native service parity and validation matrix

**Updated:** 28 November 2026  
**Target:** `aka30art/DowntimeUI`, PR #3  
**Architecture:** static GitHub Pages app + one private GitHub data repository + direct browser API access.

## Service inventory

| Service | Preserved application scope | Automated coverage | Real private-repository validation |
|---|---|---|---|
| Central Bank | DEV bootstrap, USER/PIN login, USER/STAFF administration, tiers and access rights | Local service and bootstrap tests | Pending |
| Central Config Admin | YARDHUB menu, central settings and configuration administration | Local handler and contract tests | Pending |
| DOWNTIME | Operational tracker, settings, assignments, reports and evidence | Source/runtime and domain tests | Pending |
| GATELOG | Customers, vehicles, arrivals, departures, waste types and reports | Local CRUD flow tests | Pending |
| R&M | Machinery catalogue, assets, faults, notes, attachments and PDF/report flows | Local CRUD and storage adapter tests | Pending |
| Photo Evidence | Upload tickets, evidence metadata and reads | Local upload/read transport tests | Pending |
| Spectator Read | Read-only operational projections | Service registration and handler tests | Pending |
| YARD HUB Settings | Launcher, roles, department permissions and configuration | Local settings and RPC tests | Pending |

## Shared persistence contract

- The private GitHub repository is the shared source of truth.
- The app loads current state at connection/login.
- REFRESH DATA explicitly reads the latest central state.
- Every write uses the current manifest revision and Git ref; stale writes must fail with a conflict.
- No realtime subscription, timer-based polling, Supabase service or Actions broker is used.
- Offline mode may display previously cached data. Writes and refreshes must not be reported as successful while offline.

## Acceptance still required

1. Provision and verify the dedicated private data repository.
2. Initialize the empty 39-table schema and create DEV ROOT.
3. Use two separate browser/device sessions against the same repository.
4. Save on device A and manually refresh device B; verify the update appears.
5. Attempt competing edits and verify the stale revision is rejected without data loss.
6. Exercise each service above against real GitHub persistence.
7. Upload, read, delete and recover staff photos, evidence, R&M attachments and report/PDF objects within configured size limits.
8. Verify cached offline reads, failed offline writes, JSON backup/restore and Git-history recovery.

A passing mock test or browser smoke test is not evidence that the real-repository gates have passed.
