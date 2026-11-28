# YARDHUB GitHub-native runtime

This directory contains the independent YARDHUB application runtime and its existing operating UI. It is developed inside the DowntimeUI repository but is not activated by the current production Pages route. The protected `aka30art/DOWNTIME` repository is not a source, destination or dependency.

## Agreed architecture

- GitHub Pages serves the static YARDHUB application.
- One dedicated **private GitHub repository** stores shared operational JSON and supported file data.
- The browser connects directly to GitHub using a fine-grained personal access token with access only to that data repository.
- The token is stored in that browser profile so the device can reconnect after reload. Configure the same token on each device.
- The existing YARDHUB Central Bank USER/PIN login remains the application login. The GitHub token is a separate device-level connection credential.
- The existing Edge Function modules run locally in the browser through the GitHub-native compatibility runtime; their data operations commit to the private repository.
- Opening the app reconnects to GitHub and loads the latest central records after USER/PIN sign-in.
- The existing **REFRESH DATA** control retrieves the latest central state on demand.
- Writes commit centrally. Version checks reject stale writes rather than silently replacing newer data.
- No polling, realtime subscriptions, Supabase, external database, external server or data migration from MAIN.
- Initial data is empty. The first account is DEV ROOT; all other users, staff, presets, machines, customers and operational records are created manually in YARDHUB.

## First-time setup

1. Create a new private repository dedicated to YARDHUB data. Do not use the DOWNTIME or DowntimeUI source repository.
2. Create a fine-grained token limited to that repository, with **Contents: Read and write** and **Metadata: Read-only**.
3. Connect the repository and token in the YARDHUB setup gate. The app verifies that the repository is private and initializes an empty schema.
4. Initialize the first DEV ROOT account using the one-time setup code shown by the runtime.
5. Create the remaining users and operational records manually.

The optional repository-creation button uses a one-time GitHub credential with repository-creation permission. After the repository is created, replace it with the repository-limited fine-grained token before connecting.

## Credential and access trade-off

This is the deliberately simple direct-browser model. The fine-grained token is stored in browser local storage and can be used by anyone with access to that browser profile. Every device needs the same repository token configured. YARD ROLE and USER/PIN remain application-level controls; a person who extracts the repository token can access the private data repository directly. This is not equivalent to a server-enforced security boundary.

## Data and conflict behaviour

The application loads the latest central data when it connects and after USER/PIN sign-in. The **REFRESH DATA** action performs an explicit read of the current central state. No background polling or realtime channel is used. Each write is checked against the current repository version; a stale write fails with a refresh-before-retry message. Git history retains prior committed JSON versions for recovery.\n\nAfter a successful connection, the browser caches the latest table snapshot and small binary objects (up to 512 KB each) in local storage. If GitHub becomes unreachable, the app can reopen that last cached state in **read-only offline mode**. The cached user session is restored locally; write operations return an explicit offline/not-saved error, and manual refresh is unavailable until the device reconnects. Larger binary attachments may not be available offline, and local browser storage quotas can limit cache size. Offline mode is only available after that device has successfully loaded the repository at least once.

## Scope and limits

The runtime preserves the original YARDHUB interface and service logic. Operational JSON and binary objects use the same private repository. The GitHub storage adapter now supports direct uploads, one-time browser upload tickets, downloads and browser-local read URLs. The current object ceiling is 10 MB; the existing STAFF original PNG limit is 5 MB and R&M attachments are limited to 4 MB. This transport has unit coverage, but staff-photo, DOWNTIME evidence, R&M evidence and PDF archive flows still require end-to-end browser and two-device tests before full operational parity can be accepted.

## Validation and release gate

- Build all seven GitHub-native service bundles.
- Run unit, service contract and browser QA tests.
- Verify empty first-run bootstrap and DEV ROOT creation.
- Verify two separate browser/device sessions reading and writing the same private repository.
- Verify manual refresh retrieves another device's committed update.
- Verify stale concurrent writes are rejected.
- Verify backup/recovery and supported binary storage.
- Keep PR #3 open and do not merge or deploy until every production acceptance gate passes.
