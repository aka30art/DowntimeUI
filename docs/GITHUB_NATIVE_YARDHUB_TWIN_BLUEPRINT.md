# YARDHUB GitHub-native twin — implementation blueprint

**Status:** Active implementation plan · 28 November 2026  
**Repository:** `aka30art/DowntimeUI` · PR #3  
**Release rule:** Keep PR #3 open and draft until every acceptance gate passes.

## Locked architecture

- GitHub Pages hosts the static YARDHUB application.
- One dedicated private GitHub repository stores shared operational JSON and supported binary objects.
- Each device connects directly to that repository using a fine-grained PAT restricted to that repository (Contents read/write; Metadata read).
- Connection setup performs an authenticated Git Data blob-write capability probe. This confirms the PAT itself has Contents: write; the repository's account-level `permissions.push` metadata is not treated as sufficient proof. The probe creates an unreferenced Git blob only and does not update a branch, ref or operational record.
- The token is stored in that browser profile so the device can reconnect. The same token must be configured on each device.
- Existing YARDHUB USER/PIN login and YARD ROLE interface remain application-level controls. They are not a security boundary against someone who extracts the repository token.
- The browser runs the seven local GitHub-native service handlers. GitHub is the only external platform used for hosting and persistence.
- Startup and login read the latest central data. **REFRESH DATA** performs a manual read. Saves commit to the private repository and stale revisions are rejected.
- No polling, realtime subscriptions, Supabase service, Actions broker, OAuth inbox, separate backend, or import from MAIN.
- First installation is empty and begins with DEV ROOT only. All other users, staff, presets, machinery, customers and operational records are created manually.

## Data layout and consistency

The private repository is the shared source of truth. The data store uses versioned JSON table shards and a manifest. Binary objects are stored separately with metadata and integrity checks. Every mutation reads the current Git ref and database revision before committing. If another device has committed since the caller's version, the mutation must return a conflict; the caller must refresh and reconcile rather than overwrite.

Git history provides point-in-time recovery of committed JSON and object files. The in-app JSON backup/restore remains a separate user-controlled export/import function. No scheduled replication or import from the original application is part of this design.

## Setup

1. Create a new private repository dedicated to YARDHUB operational data (suggested name: `YARDHUB-DATA`).
2. Create a fine-grained PAT limited to that repository with Contents read/write and Metadata read.
3. Connect each device to the same repository and token.
4. Verify private repository visibility and initialise the empty schema.
5. Initialise DEV ROOT, then manually create the remaining configuration and accounts.

Never use `aka30art/DOWNTIME` or `aka30art/DowntimeUI` as the operational data repository.

## Explicit limitations

This is the deliberately simple direct-browser model. The repository token grants direct access to the entire private data repository and bypasses application-level roles if extracted. This is accepted as a simplicity trade-off, not represented as enterprise-grade security. Every device requires the token. GitHub API limits, repository size and binary object limits apply. The current runtime's configured upload ceilings require real file-flow validation.

## Acceptance gates

1. CI, service checks and browser QA pass on the exact final PR head.
2. A real private data repository is verified and the empty schema is initialised.
3. DEV ROOT is created on the first install; no imported users or operational data exist.
4. Two separate devices use the same repository: a save on device A appears on device B after manual refresh.
5. Two competing edits prove stale writes are rejected without overwriting committed data.
6. DOWNTIME, GATELOG, R&M, Hub Settings, USER/STAFF administration and PDF/report flows pass real-repository tests.
7. Staff photos, evidence and R&M attachments pass upload, read, delete and recovery tests within the documented limits.
8. Offline mode displays only previously loaded data and never reports an uncommitted edit as saved.
9. JSON backup/restore and Git-history recovery are rehearsed.

Do not merge or deploy before all gates pass. The protected DOWNTIME repository must remain untouched.
