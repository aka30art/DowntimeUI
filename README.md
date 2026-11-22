# DOWNTIMEUI — Universal Edition

A company-neutral downtime and operations application. New installations start with an empty configuration and use an installer to define company identity, site structure and operating rules.

## Implemented on `feature/universal-app-foundation`

- Nine-stage first-run installer with resumable local drafts, validation, installation and section-specific Settings edits.
- Tenant-configurable company/site identity, hierarchy, areas, stations, downtime reasons and reusable quick-entry presets, work days, shifts, breaks, staff, intended role links and daily task templates.
- Local daily operations workspace with downtime-entry create/edit/delete, quick-entry preset application, per-day operator assignment, live Start/Stop Shift controls and manual actual-time overrides.
- Schedule-aware daily availability, break deduction, running/downtime totals, percentage calculations and return-to-configured-schedule controls.
- Configurable Plant Overview with station status, station/operator allocation, staff portrait cards, alerts and local transition history.
- Daily task checklist with immutable per-day snapshots using **SAVE & LOCK FOR TODAY**.
- Weighted weekly performance, downtime cause ranking, day comparison and previous-week intelligence.
- Weekly report snapshots, local archive, browser print/PDF and JSON export.
- Tenant-scoped JSON backup, integrity validation, rollback-aware restore and recovery from a clean installer. Staff portraits are resized and compressed locally before being stored with the roster.
- Desktop/mobile responsive styles and Chromium browser regression coverage.

## Current operating boundary

The installed workspace is **local single-browser mode**. Configuration, operations and reports are stored in this browser. Plant and station status is a local operational record; it is not a physical machinery control signal.

Configured roles and staff-to-role links are local configuration metadata only. They do not provide authentication, secure account sessions or server-enforced authorization. The following Main-app parity work remains open: secure authentication and user/account lifecycle; server-enforced permissions and read-only spectator enforcement; a separately provisioned tenant-isolated DOWNTIMEUI backend; shared persistence, cross-device/realtime sync and conflict resolution; central audit attribution; secure private photo storage and staff/account linking; and server backup/retention policies.

No Main production credentials, tenant records or database configuration are included. Do not connect this branch to Main's production backend. Multi-user operation requires a separately provisioned DOWNTIMEUI development backend and a reviewed authorization/data-isolation model.

## Quality gates

- `npm run check`: JavaScript syntax, configuration/domain tests, installer/workspace flow and tenant-neutrality regression.
- `npm run test:browser`: Chromium installer-to-workspace, photo upload, intended staff-role assignment, quick-entry preset setup/application, plant overview, actual/live shift controls, task-lock persistence, weekly metrics, report archive, Settings edits, same-tenant backup restore, clean-install recovery and 390px mobile overflow.
- Latest verified head: `97ebd1e8786ccbf9213bd6dd4006086e7c41a747`. Successful Actions runs: [44980310122](https://github.com/aka30art/DowntimeUI/actions/runs/44980310122) and [44980308168](https://github.com/aka30art/DowntimeUI/actions/runs/44980308168).
- A green CI result applies to the exact commit tested. It does not certify the unimplemented Main parity or security features.

## Release boundary

- Development branch: `feature/universal-app-foundation`
- `main` and production remain untouched.
- Do not merge or deploy until the user gives the exact instruction **DEPLOY & Merge**.
