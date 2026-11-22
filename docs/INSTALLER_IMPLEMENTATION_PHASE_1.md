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

Overnight shift and break intervals are supported by the schedule domain engine. Overlapping shift ranges are merged and breaks are deducted only where they overlap configured working intervals. Advanced schedule policies remain future work. Company logo URL support is present; managed upload/storage remains future Settings work.

## Release gate
This phase is a setup foundation only. Restore and validate Main app behavior module-by-module, implement shared persistence and authentication safely, complete desktop/mobile browser QA, and pass all CI and regression checks before proposing release. Do not merge, deploy or publish until the user gives the exact instruction **DEPLOY & Merge**.


## Phase 2 — local operations workspace

The installer now opens a tenant-configured operations workspace with:
- daily downtime entry capture and deletion, station selection and staff assignment;
- schedule-aware daily availability, break deduction, downtime and running metrics;
- seven-day date selection and weighted weekly calculations;
- daily task completion, per-day immutable snapshot and SAVE & LOCK behaviour;
- weekly report snapshots, local archive, print-to-PDF and JSON export;
- local backup export and access to edit workspace configuration.

All operational state is namespaced by the installation ID. This is a single-browser local mode. It is not shared across devices, and the configured role permissions are not yet server-enforced. Do not use it as a secure multi-user production system.

- Actual daily shift start and finish overrides; configured break periods are clipped to the recorded interval, including overnight actual shifts.
- Validated full workspace backup restore with installation identity checks, explicit confirmation, storage rollback on failure and recovery into a clean browser installation.
