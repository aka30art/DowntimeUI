# DOWNTIMEUI — Universal installer and local operations implementation

## Phase 1 — company-neutral installation

The application starts from a clean, company-neutral state. No company, site, staff member, area, station, downtime reason or task template is prefilled.

The nine-stage installer covers Welcome, Company, Site structure, Downtime reasons, Schedule, Staff, Access roles, Daily tasks and Review. It supports local draft persistence, resuming setup, input validation, activation, later section-based editing and configuration JSON export.

Configuration includes organisation identity, locale/time zone, configurable site hierarchy, areas/stations, downtime reasons and reusable area/station/reason/duration presets, work days, shifts, breaks, staff roster and optional portraits, intended staff-to-role metadata links, role definitions and task templates. Schema v3 migrates older v1/v2 configurations by adding an empty preset list. Validation includes required company/site values, valid IANA time zone, unique names/IDs, station-to-area relationships and schedule formats. Overnight shifts and breaks are supported by the schedule domain engine; overlapping shift windows are merged.

## Phase 2 — local operations workspace

After installation the application opens a tenant-configured local operations workspace.

- **Daily Sheet:** date/day selection, downtime entry create/edit/delete, quick-entry preset application, area/station selection, free-text or configured reason, duration, operator-of-day assignment, live Start Shift / Stop Shift using the tenant time zone, manual actual daily shift start/finish overrides, schedule/break deduction, net available, downtime/running totals and rates.
- **Plant Overview:** station cards grouped by configured area, station states (running/down/maintenance/idle), station/operator assignments, overall plant running/stopped state, issue alerts, local transition history, and operator portrait cards showing photo, name and assigned station.
- **Staff photos:** optional JPEG/PNG/WebP upload, 8 MB source-file limit, 320 × 320 crop/resize, JPEG compression and 180 KB data-URL cap. This remains local browser storage pending secure private backend storage. This is an operational record only; it is not connected to machinery controls.
- **Daily Tasks:** checklist completion, per-day immutable task snapshot and **SAVE & LOCK FOR TODAY**. Completion and lock state persist locally after reload.
- **Weekly Intelligence:** aggregate weighted weekly calculations, cause ranking, best running day/highest downtime day and prior-week comparison.
- **Reports:** dated weekly snapshots, local report archive, browser print/PDF and JSON export. A stored report snapshot is not changed when the underlying downtime entries are later edited or deleted.
- **Settings:** direct access back to each installer section, including identity, site structure, reasons and quick-entry presets, schedule, staff/photos and intended role links, role definitions and task templates.
- **Data recovery:** full workspace JSON backup, validation of the backup format/version/export timestamp and tenant installation ID, record-reference integrity checks, explicit confirmation, best-effort rollback when browser storage writes fail, restore within an installed workspace and restore onto a clean installation.

Operational records are namespaced by installation ID in browser storage. The current operational workspace is **single-browser local mode**. It is not a secure multi-user system and does not sync across devices.

## Domain modules and verification

Business rules are separated into domain modules for schedule calculations, downtime metrics, daily task locking, role/permission helpers, weekly reports, Plant Overview state and backup/restore.

The automated Node suite covers configuration validation/migration/persistence, installer flow, shift and break calculations including overnight intervals, daily/weekly metric calculations, immutable task snapshots, least-privilege permission helpers, report aggregation, Plant Overview transitions/assignments, backup validation/restore/rollback, workspace integration and tenant-neutrality.

The Playwright Chromium suite drives the installer and workspace in a real browser. It covers installation, staff portrait upload/compression, intended staff-role selection, downtime preset configuration/application, downtime create/edit/delete, operator assignment, Plant Overview, task-lock persistence, weekly reports, Settings section edits, backup export, in-place restore, clean-install restore, restored Settings values, archived report retention and the narrow 390px mobile layout. It saves desktop, Plant Overview, weekly and mobile screenshots as workflow artifacts.

## Explicit limitations and remaining Main parity work

- There is no dedicated DOWNTIMEUI backend connected yet. Existing Main production and Main staging Supabase projects are not used.
- No live Auth integration, user invitation/account lifecycle, secure multi-tenant persistence, server-enforced authorization, read-only spectator flow, cross-device/realtime synchronization or compare-and-swap concurrency is active.
- Role definitions and optional staff-to-role links are stored as local configuration metadata; client-side helpers are not a security boundary.
- Central audit history, staff-to-account linking, private photo storage/signed URL lifecycle, backup retention and server-side recovery remain backend work. Local optional photo upload/display is implemented.
- Company logo URL is configurable; managed upload/storage is not yet implemented.
- PDF printing uses the browser print-to-PDF path; cloud report archival is not connected.

The required next backend phase must use a separate DOWNTIMEUI development project after it has been explicitly designated. It must not reuse the DOWNTIME live or staging project. The multi-tenant and security design is documented in `docs/MULTI_TENANT_BACKEND_SPEC.md` but has not been deployed or applied to any Supabase project.

## Release boundary

All current work is on `feature/universal-app-foundation`. No merge, GitHub Pages deployment, live upload or production database change is authorised until the user explicitly says **DEPLOY & Merge**. A green result applies only to the exact commit tested and does not mean all Main-app feature parity is complete.
