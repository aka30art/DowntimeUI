# YARDHUB → DOWNTIMEUI Runtime Port Audit

**Date:** 27 November 2026  
**Scope:** Read-only source audit of `aka30art/DOWNTIME`; all implementation copies and changes are confined to `aka30art/DowntimeUI`.

## 1. Source preservation in DOWNTIMEUI

Two trees now exist in the DOWNTIMEUI development branch:

- `yardhub/reference/` — source-reference snapshot. This is the immutable comparison baseline and must not be edited during the port.
- `yardhub/runtime/` — working copy for the GitHub-native port. All port changes must happen here.

The reference snapshot contains 26 runtime files (approximately 855 KB), plus a source manifest and README. Source manifest records the original `aka30art/DOWNTIME` main tree SHA and source blob SHA for each file.

The copied runtime includes:
- Main YARDHUB/DOWNTIME `index.html`.
- Central Bank browser client and admin page.
- STAFF image library metadata and staff image JavaScript.
- YARDHUB Settings and access-rights UI.
- YARDHUB navigation and visual-system styles.
- R&M UI, machinery category SVGs, launch/structure scripts and workspace.
- GATELOG UI, styles, daily management and settings scripts.
- Plant overview preview and shared UI CSS.

**The copied runtime still contains original Supabase endpoints. It is deliberately not connected to the DOWNTIMEUI application entry point, and must not be loaded or deployed until its backend has been replaced and the browser/API regression suite passes.**

## 2. Browser/API integration inventory

### Central Bank browser client

The current browser adapter exposes these operations:
- `listUsers`, `login`, `logout`, `state`, `identityDiagnostics`
- `resetIdentities`, `provisionUserStaff`, `activateProvisionedUser`
- `dailyOperators`, `assignDailyOperator`, `unlockDailyOperator`
- `saveTracker`, `saveSettings`, `setPlantStatus`
- `saveUser`, `deleteUser`, `saveStaff`, `saveTiers`
- STAFF original upload, signed photo upload/read/removal and bootstrap

The current browser session token is stored in sessionStorage and sent as `x-downtime-session`. The GitHub twin must implement its own session records and must not accept or copy Supabase session tokens.

### Supabase Edge Function action inventory

| Endpoint | Action surface | Primary data domains |
|---|---|---|
| central-bank | login, logout, list-users, get-state, save-state, save-settings, user/staff lifecycle, ROOTS, YARD ROLE lookup, daily operator assignments, central config, bootstrap, staff photo actions | USER, STAFF, ROOTS, YARD ROLE, DOWNTIME payload, central audit, central configuration, daily assignment audit |
| yard-hub-settings-api | my-access, settings-state, save-tier-settings, save-user-tier, remove-user-tier, assign-user-role, yard-role-save, roots-state, roots-manage | YARD ROLE, assignment, legacy YARD HUB access configuration, ROOTS |
| central-config-admin | central config state/save/publish/restore/audit/impact/validate and YARD HUB menu operations | Central Data Bank configuration and history |
| gatelog-api | bootstrap, customer and vehicle management, arrivals/departures, visit update/delete, waste type management, daily register, Gateman assignment/lock, reports and archive | Customers, vehicles, visits, waste line items, waste catalogue, Gateman assignment, GATELOG audit/report archive |
| repair-maintenance-api | access, fault create/list/get/update/delete, assets, models, presets, machine settings, notes, attachments, PDF export/create/list/url/delete | R&M assets, faults, notes, attachments, models, presets, settings, PDF archive and audit |
| photo-evidence | create-upload, view, delete, cleanup | DOWNTIME evidence metadata and image files |
| spectator-read | verified spectator snapshot read | Read-only DOWNTIME/plant snapshot |

### Confirmed relational data domains

The live inventory includes:
- Central state, session, audit and configuration state/history.
- Canonical YARD ROLE definitions, department permissions, assignments and audit.
- Protected ROOTS bootstrap, assignments, assignment audit, protected definitions and identity-reset lifecycle.
- DOWNTIME weekly report metadata, attachment metadata and daily operator assignments/audit.
- R&M assets, faults, notes, attachments, machine models, machine presets, machine settings, PDF exports and audit.
- GATELOG customers, vehicles, visits, visit/waste links, waste types, Gateman assignments, report archive and audit.

### Atomic database operations to port

The current Edge Functions call SQL RPCs for operations that must retain atomic semantics:

- `downtime_commit_central_bank`
- `downtime_central_commit_identity_event`
- `downtime_get_bootstrap_code`
- `downtime_identity_reset_preserve_dev`
- `downtime_roots_manage_identity`
- `yard_hub_save_tier_settings`
- `yard_role_assign_user`
- `yard_role_reassign_user`
- `yard_role_save_definition`
- GATELOG arrival/departure/visit/Gateman/statistics RPCs

These need deterministic equivalents in the GitHub-native write engine. They must not be replaced with a sequence of independent commits that could leave partial records.

## 2A. Latest source-main STAFF layout delta

The pinned reference tree `ba99913d1eaff7d99785088fd0931b3815defd4c` remains immutable. A read-only comparison against the current source `main` found two commits beyond that reference:

- `0cbda60f90ee45f8df866e7b36f532498a78ea49` — "Match STAFF workspace to YARD HUB layout (#210)". Updates the STAFF view to the shared YARD HUB settings header, compact header return control, USERS-style directory rows and responsive action toolbar; preserves STAFF profile, role, photo, station and permission behavior.
- `939195a1fac26a9a632ab3938f17922985d8cd9d` — "Match STAFF action wrapping to shared YARD HUB toolbar". Changes the STAFF action group to the same responsive flex-wrapping toolbar and adds a contract assertion.

The observed source-main delta is limited to `index.html` and related test contracts; no Edge Function or SQL migration file changed in those two commits.

**Port applied in DOWNTIMEUI only:** `yardhub/runtime/index.html` now contains the latest STAFF CSS, markup, row renderer and dedicated `staffBackToYardHub` event binding. The runtime's GitHub bootstrap/connection and other runtime-specific code were preserved. The immutable `yardhub/reference/index.html` remains at its original pinned blob SHA.

A new `tests/yardhub-runtime-staff-layout.test.js` contract checks:
- STAFF header and dedicated YARD HUB return route;
- responsive flex toolbar and shared USER row classes;
- the immutable source-reference snapshot remains unchanged.

The test is included in both `npm test` and `npm run check`. It is a static layout contract, not a full interactive/multi-user browser acceptance test.

## 3. GitHub-native port strategy

The preferred direction is a DOWNTIMEUI-owned data transaction adapter:

1. Read the current GitHub data-branch commit and database manifest.
2. Load only the module/table shards required for the requested action.
3. Execute the complete action against an in-memory transaction view.
4. Stage every changed JSON table/shard and append the corresponding audit event.
5. Create one Git commit containing all changed blobs and the updated manifest.
6. Advance the data branch with a non-force fast-forward update.
7. On a concurrent update, reject with a conflict or re-run only an idempotent request from the latest snapshot. Never silently overwrite.

The first versioned event/snapshot store already implements the GitHub Git Data API write path. The next step is to generalise it into module-scoped JSON transactions and use a browser-side action adapter to replace the original Edge Function endpoints.

The exact primary UI files should be retained while only their transport/API boundary is changed. This avoids changing the user's established screens, workflows and operator conventions to fit the new storage provider.

## 4. Port order and acceptance criteria

1. Central Bank identity/session and shared JSON state.
2. DOWNTIME core persistence, weekly reports, daily operator register, photo evidence and spectator read.
3. YARD ROLE/ROOTS and STAFF management, including module-specific VIEW/ENTER/EDIT/MANAGE decisions.
4. R&M machinery, models/assets, faults, notes, settings, attachments and exports.
5. GATELOG customer/vehicle/visit/waste/Gateman/report workflows.
6. Central Data Bank configuration, history and menu control plane.
7. Continuous backup import/replication, offline queues, reconciliation and primary switching.

For each endpoint/action, test:
- expected UI request and response shape;
- valid and denied actions for every permission level;
- write idempotency and duplicate requests;
- simultaneous writes and stale-version rejection;
- data export/restore and record-count/checksum invariants;
- desktop/mobile browser behaviour.

## 5. Protection and activation rules

- Never edit or deploy to `aka30art/DOWNTIME`.
- Never change its Supabase project, API endpoints, secrets, migrations, functions, storage, records or Pages deployment.
- Never connect the copied `yardhub/runtime` to the live Supabase endpoint.
- Never enable `yardhub/runtime/index.html` as the DOWNTIMEUI production entry until all GitHub adapters have replaced the Supabase dependencies and the full acceptance suite passes.
- Do not copy primary operational records or staff/customer media into the public DOWNTIMEUI repository without an explicitly selected destination and a verified export/recovery procedure.
- Keep the reference source snapshot unchanged.
