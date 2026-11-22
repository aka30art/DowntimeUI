# DOWNTIMEUI — Universal Edition

A company-neutral downtime and operations application. New installations start with an empty configuration and use a nine-stage installer to define company identity, site structure, operating rules, staff, access-role definitions and daily task templates.

## Implemented on `feature/universal-app-foundation`

- Empty-state first-run installer with local drafts, validation, install and later section-based editing.
- Configurable company/site identity, timezone, hierarchy, areas, stations, downtime reasons, work days, shifts/breaks, staff, role definitions and daily task templates.
- Local Daily Sheet with downtime entry create/edit/delete, station and operator assignment, schedule metrics and actual daily shift times.
- Configurable Plant Overview with station states/assignments, overall plant status, alerts and local transition history.
- Daily Tasks checklist with immutable per-day snapshots and **SAVE & LOCK FOR TODAY**.
- Weighted weekly performance, cause ranking, prior-week comparison and archived report snapshots.
- Browser print/PDF and JSON report export.
- Full workspace backup with validation, in-place restore, rollback handling and clean-install recovery.
- Playwright Chromium regression coverage for installer, operations, Plant Overview, task locks, reports, Settings, backups/restores and mobile layout.

## Current operating boundary

The installed workspace is currently **local single-browser mode**. Operational records and configuration are persisted in browser storage. Plant/station state is not a physical machinery control signal.

The following Main-app parity work remains open: secure authentication and user/account lifecycle; server-enforced permissions and read-only spectator enforcement; tenant-isolated shared persistence; cross-device/realtime sync and conflict resolution; central audit trail; staff photo upload/profile handling; and backend backup/retention policies. Configured roles are definitions only until the backend authorization layer is implemented.

No production credentials, tenant records or database connection details from Main are included. A separate DOWNTIMEUI development backend must be explicitly designated and security-reviewed before multi-user operation is enabled. The required architecture is specified in `docs/MULTI_TENANT_BACKEND_SPEC.md`.

## Quality gates

- `npm run check`: syntax, unit/domain tests, installer and workspace flows, backup/restore and tenant-neutrality regression.
- `npm run test:browser`: Chromium installer-to-workspace, downtime CRUD, Plant Overview, task-lock persistence, weekly reports, Settings edits, backup export/restore, clean-install recovery and 390px mobile overflow checks.
- A green result applies to the exact commit tested. It does not imply the complete Main feature set is ready for production.

## Release boundary

- Development branch: `feature/universal-app-foundation`
- `main` and production remain untouched.
- Do not merge or deploy until the user gives the exact instruction **DEPLOY & Merge**.
