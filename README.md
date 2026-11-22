# DOWNTIMEUI — Universal Edition

A company-neutral downtime and operations application. New installations start with an empty configuration and use an installer to define company identity, site structure and operating rules.

## Implemented on `feature/universal-app-foundation`

- Nine-stage first-run installer with resumable local drafts, validation and later section-specific editing in Settings.
- Tenant-configurable company/site identity, hierarchy, areas, stations, downtime reasons, work days, shifts, breaks, staff, access-role definitions and daily task templates.
- Local daily operations workspace with downtime entry create/edit/delete and per-day operator assignment.
- Schedule-aware daily availability, break deduction, running/downtime totals and percentage calculations.
- Configurable Plant Overview with station status, station/operator allocation, status alerts and a local transition history.
- Daily task checklist with a saved, immutable per-day snapshot using **SAVE & LOCK FOR TODAY**.
- Weighted weekly performance summary, downtime cause ranking and prior-week comparison.
- Weekly report snapshots, local archive, browser print/PDF and JSON export.
- Tenant-scoped JSON backup, integrity validation, in-place restore and recovery from a clean installer.
- Desktop/mobile responsive styles and a Playwright browser regression suite.

## Current operating boundary

The installed workspace is currently **local single-browser mode**. Operational records and configuration are persisted in browser storage. Plant/station state is not a physical machinery control signal.

The following Main-app parity work remains open: secure authentication and user/account lifecycle; server-enforced permissions and read-only spectator enforcement; tenant-isolated shared persistence; cross-device/realtime sync and conflict resolution; central audit trail; staff photo upload/profile handling; and backend backup/retention policies. Configured roles are definitions only until the backend authorization layer is implemented.

No production credentials, tenant records or database connection details from Main are included. A separate DOWNTIMEUI development backend must be provisioned and security-reviewed before multi-user operation is enabled.

## Quality gates

- `npm run check`: syntax, unit/domain tests, installer flow, workspace integration and tenant-neutrality regression.
- `npm run test:browser`: Chromium installer-to-workspace, plant, daily task lock persistence, reports, section-based Settings edits, backup restore and 390px mobile overflow checks.
- A green result applies to the exact commit tested. It does not imply the complete Main feature set is ready for production.

## Release boundary

- Development branch: `feature/universal-app-foundation`
- `main` and production remain untouched.
- Do not merge or deploy until the user gives the exact instruction **DEPLOY & Merge**.
