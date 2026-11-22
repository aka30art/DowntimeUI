# DOWNTIMEUI implementation status

This ledger distinguishes working local features from features that are not yet secure for a shared company deployment.

## Working in the local single-browser build

- Universal empty-install flow with resumable setup, validation and install/reopen.
- Tenant-defined company, site, area, station, downtime-reason and quick-entry preset, schedule, staff/photo, intended staff-role link, role and daily-task configuration.
- Daily downtime capture, edit and delete; quick-entry preset application; selected-day operator assignment; live Start/Stop Shift and actual shift overrides.
- Schedule and break calculations, including overnight windows and break overlap clipped to actual shift times.
- Daily/weekly metrics using weighted aggregate minutes.
- Daily task completion with immutable, persisted per-date snapshot and SAVE & LOCK FOR TODAY.
- Plant Overview by configured area/station, local Running/Down/Maintenance/Idle state, operator assignment, alerts and change history.
- Weekly report snapshots, local archive, print/PDF and JSON export.
- Installation-scoped backup validation, existing-workspace restore with rollback, and clean-install recovery.
- Responsive layout and Chromium browser test coverage for the listed local flows.

## Security and backend rules

- Local role definitions are configuration only. There is no login, authenticated user identity or secure session in this build.
- Central Data Bank access is modelled separately from tenant permissions: a trusted, active platform-admin identity claim is required. A tenant owner, supervisor or configurable role must not be able to grant that privilege.
- The platform-admin claim must be issued and verified by the authentication/backend layer. It must never be trusted from a browser-editable configuration object.
- Every protected operation must be authorised server-side. Hiding navigation or controls is not an access-control mechanism.
- No Main production database, tenant records or credentials are used. Multi-user functionality requires a separate DOWNTIMEUI development backend.

## Remaining Main parity / release blockers

1. Authentication, account invitation/provisioning, sign-in, session expiry/revocation, password reset and recovery.
2. Server-enforced tenant isolation and row-level access policies.
3. Server-authoritative role enforcement, read-only spectator policy and restricted Central Data Bank navigation/API access.
4. Shared persistence, realtime sync, conflict resolution, offline reconciliation and audit events with authenticated actor attribution.
5. Staff profiles/photos and secure upload/storage controls.
6. Native settings editors, preset categories/bulk management, archive/retention controls and audit history. Core tenant presets and Settings shortcut are implemented.
7. Live downtime timer/pause/resume, operator handover and full schedule exception handling.
8. Full visual parity for the Main Plant Overview and all remaining edge-case/browser regression tests.
9. Accessibility, security, performance, recovery and multi-user concurrency reviews.

## Release state

**Not release-ready for multi-user production.** The local feature build is useful for functional review but must not be described as secure shared operations software. Production remains untouched. No merge or deployment is authorised until the user gives the exact instruction DEPLOY & Merge.
