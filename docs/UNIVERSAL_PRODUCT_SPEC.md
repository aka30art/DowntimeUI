# DOWNTIMEUI — Universal Edition

## Product goal
A company-neutral, installable downtime and operations application. A new tenant starts with an empty workspace and configures its own identity, operating structure, stations, downtime reasons, schedule, people, roles, and daily tasks. The code must not contain default-company names, employee names, or operational data.

## Universalization requirements
- All identity and logo data comes from installation configuration.
- Plant/site, areas, lines, machines and stations are tenant-configurable.
- Downtime reason library is tenant-configurable.
- Operating days, shift schedules, break rules and time-zone settings are configurable.
- Staff/operator roster and assignment data is tenant-configurable.
- Role/permission matrix is configurable and enforced in UI and backend.
- Daily task templates are configurable; daily snapshots can be saved and locked for a specific day.
- Setup supports incomplete progress, validation, review, install/activate, and later edit via Settings.
- Empty states are first-class UX states, not errors.
- Data isolation must be enforced server-side; UI hiding alone is not authorization.
- Setup must be repeatable and idempotent; no duplicated records if install is retried.
- Existing preview content must be clearly marked as demo and never treated as production records.

## Main app feature parity to port
1. Downtime entry: area/station selection, preset reasons, manual reason, duration, start/stop where supported, edit/delete.
2. Daily summary and calculations: totals, running time, break deductions, percentages with correct handling of zero/invalid values.
3. Weekly intelligence: day-by-day metrics and correctly weighted totals.
4. Reports: weekly report generation, print/PDF export, archive management and retention controls.
5. Plant overview: configurable plant visualization, assignments, state transitions and alerts.
6. Daily tasks: template management, checklist completion, SAVE & LOCK FOR TODAY, locked snapshots and persistence.
7. Areas/stations: create/edit/archive and preset management.
8. Downtime reasons: reason presets and category management.
9. Staff: roster, profile/photo handling, operator assignment.
10. Settings Hub: organized sections, responsive layout, access-aware settings.
11. Shift & break schedule: workdays, shift times, breaks, excluded time and calculations.
12. Access & rights: tier/role restrictions, read-only spectator, explicit permissions.
13. User accounts: account administration and secure access lifecycle.
14. Persistence, sync, auditability, backup/export, failure/retry and recovery.

## Installer flow
- Welcome / product setup status
- Company identity and locale
- Site/plant and hierarchy setup
- Areas, stations and optional machine/line levels
- Downtime reasons and categories
- Operating days, shifts, breaks, timezone
- Staff and assignments (optional during install)
- Roles and permissions
- Daily task templates (optional during install)
- Review, validation, installation/activation
- Setup progress saved; administrator may resume later

## Build and release gates
- Static checks and syntax validation
- Unit/contract tests for configuration validation, calculations, permission enforcement and locked daily tasks
- Browser QA on desktop and mobile viewport sizes
- Empty-state QA before any setup and after optional sections skipped
- Install/reinstall/idempotency and persistence tests
- Security review: tenant isolation, authorization, secrets, input validation, data access boundaries
- Regression tests for every ported module
- CI green and browser QA green before PR readiness
- Production merge/deploy only after user command: “DEPLOY & Merge”

## Porting policy
Do not wholesale copy Main-app production credentials, company branding, staff/roster records, preset operational data, tenant identifiers, or production database configuration. Port reusable feature behavior, tests, and design patterns. Keep universal defaults blank or neutral. Use a separate development backend/project for this product.
