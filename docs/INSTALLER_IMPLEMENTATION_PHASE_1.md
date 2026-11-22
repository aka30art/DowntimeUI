# Universal installer implementation — Phase 1

## Delivered on feature/universal-app-foundation
- Responsive nine-stage first-run setup: Welcome, Company, Site structure, Downtime reasons, Schedule, Staff, Access roles, Daily tasks and Review.
- Empty tenant defaults: no preloaded company, site, area, station, downtime reason, staff, role or task records.
- Company-level locale and IANA time-zone configuration; optional HTTPS logo URL.
- Configurable area and station labels, records and station-to-area relationships.
- Optional downtime reason, work-day, shift, break, staff, role/permission and daily-task definitions.
- Local draft persistence, active local installation persistence, migration from schema version 1 and JSON export.
- Validation for required identity/site values, IANA time zones, unique names and IDs, area references, schedule formats and explicit role permission booleans.
- Responsive desktop/mobile installer styling and project smoke tests.

## Explicit limitations
The installer currently persists to the current browser's local storage. It does not create a server-side tenant, connect a database, create user accounts, enforce permissions on a server, sync between devices, provision backups, or make the underlying preview operational. Preview data remains fictional/demo-only.

Overnight shifts are not supported by this first setup version. Break/shift overlap and advanced schedule policy validation remain future schedule-engine work. Company logo URL support is present; managed upload/storage remains future Settings work.

## Release gate
This phase is a setup foundation only. Restore and validate Main app behavior module-by-module, implement shared persistence and authentication safely, complete desktop/mobile browser QA, and pass all CI and regression checks before proposing release. Do not merge, deploy or publish until the user gives the exact instruction **DEPLOY & Merge**.
