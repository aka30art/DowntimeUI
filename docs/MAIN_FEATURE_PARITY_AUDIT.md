# Main → DOWNTIMEUI Feature Parity Audit

Reference: aka30art/DOWNTIME main branch, inspected at commit a80fe1c013cffde44b0bea546e8d8450fc01b335 (22 Nov 2026). DOWNTIMEUI baseline: 9d7e56979c567516ead79615e302e7f25178f584.

## Main-app features identified from inspection
- Downtime entry panel and entry list, manual duration entry, area/reason presets, edit/delete.
- Daily summary, weighted weekly metrics, weekly intelligence.
- Weekly reports and archive/export.
- Settings hub with user management, areas, reasons, daily task presets, staff, schedule, access rights.
- Plant Overview preview/overlay, configurable operator assignments, transition alerts.
- Daily tasks modal with SAVE & LOCK FOR TODAY and frozen checklist snapshot.
- Operator/spectator modes and role-aware UI.
- Central user/account management, settings sync, realtime central state, audit-related backend.
- Staff photo evidence/upload support.
- Mobile layout and navigation safeguards.

## Current DOWNTIMEUI gaps confirmed by baseline inspection
- UI is an isolated preview/demo prototype and not a production-ready configured application.
- Main branch lacks the Main app's Daily Tasks module and save/lock behavior.
- UI prototype contains demo/mock content; must not be mistaken for company installation data.
- Main app's functions and configuration assumptions must be separated from tenant-specific data.

## Parity ledger
Port behavior—not company-specific content—and track every feature against implementation, unit/contract tests, browser QA, and completion evidence in the project's issue/PR notes.

## DOWNTIMEUI implementation status — 22 Nov 2026

### Implemented and covered by automated tests
| Main capability | DOWNTIMEUI status | Evidence / boundary |
|---|---|---|
| Universal first-run installation | Implemented locally | Nine-stage installer, empty defaults, validation, resumable draft, browser install |
| Company / site / areas / stations | Implemented locally | Tenant configuration and editable setup steps |
| Downtime reasons / staff / daily task templates | Implemented locally | Optional tenant-defined lists; no inherited Main data |
| Schedule, shifts, breaks and timezone | Implemented locally | Weekly schedule model, overnight periods and break overlap |
| Daily timekeeping | Implemented locally | Planned schedule plus per-day actual start/finish overrides |
| Downtime entry | Implemented locally | Add, edit, delete, duration validation and station association |
| Daily calculations | Implemented locally | Scheduled, net, downtime and running minutes/rates |
| Weekly intelligence | Implemented locally | Weighted aggregate rates, day ranking, cause distribution and prior-week comparison |
| Daily Tasks | Implemented locally | Day-specific immutable snapshot and SAVE & LOCK FOR TODAY |
| Plant Overview | Implemented locally | Configured station states, one-operator-per-station allocation and local transition history |
| Weekly report archive | Implemented locally | Dated report snapshots, print/PDF and JSON export |
| Backup and recovery | Implemented locally | Tenant-scoped backup envelope, validation, explicit confirmation, rollback and clean-browser recovery |
| Responsive UI | Browser-tested | Chromium desktop and 390px mobile layout smoke/interaction checks |

### Partially implemented
| Capability | Remaining work |
|---|---|
| Settings Hub | Settings can reopen the installer sections; a fully native settings editor, bulk management, archive/delete policies and audit view remain |
| Downtime presets | Free-text/datalist entry and configured reasons exist; richer reusable area/reason preset UX and validation rules remain |
| Plant alerts | Station states and transition history exist; alert routing, acknowledgement, severity and escalation remain |
| Shift tracking | Actual start/finish overrides and tenant-timezone live Start/Stop controls exist; pause/resume, operator handover and server clock integrity remain |
| Access roles | Role definitions and client-side default-deny helpers exist; there is no authenticated active-user/session layer or server-side authorization |
| Reports | Local archive and browser print/PDF exist; scheduled delivery, centrally shared archives and controlled report access remain |

### Not yet implemented / production blockers
- User account creation, invitations, sign-in, credential lifecycle, session management and account recovery.
- Server-side tenant isolation, persistent shared database, realtime sync, concurrency control, audit events and server-authoritative backup/recovery.
- Server-enforced role, operator/spectator and read-only permissions.
- Secure private staff photo storage, signed upload/download, privacy controls and linking staff profiles to authenticated accounts. Local photo compression and operator-card rendering are implemented.
- Cross-device and multi-user operational workflows, including collision and offline reconciliation.
- Production deployment hardening, security review, accessibility review, performance testing and complete visual parity QA.

### Release gate
The implementation is a **local single-browser functional build**, not a production multi-user application. No claim of full Main parity or production readiness is made. Complete the remaining modules, provision a separate development backend (never Main's production database), run security and multi-user tests, pass browser QA and only then request the user's explicit **DEPLOY & Merge** authorisation.


## Implementation status — universal branch

### Implemented
- **Empty tenant installation:** nine-step universal installer; resumable draft; identity/site/schedule/reasons/roster/role/task configuration; section-specific Settings editing.
- **Downtime entry:** local create/edit/delete; reason, area, station, duration; per-day operator assignment.
- **Daily metrics:** configured shifts, actual-time override and live Start/Stop Shift controls; configured break deduction clipped to actual shift; downtime/running minutes and rates.
- **Weekly intelligence:** day-by-day view; weighted weekly rates; cause ranking; best/worst day; previous-week comparison.
- **Reports:** immutable weekly report snapshots, archive, browser print/PDF and JSON export.
- **Plant Overview:** tenant-configured area/station cards, station Running/Down/Maintenance/Idle states, operator allocation, portrait/name/station operator cards, alerts and transition history.
- **Daily Tasks:** week/date navigation, per-day checklist completion, independent day-specific immutable snapshots and **SAVE & LOCK FOR TODAY**.
- **Staff profiles:** optional JPEG/PNG/WebP photo upload, browser-side 320px crop/resize/compression, JPEG data validation and local portrait display in Plant Overview operator cards. Each card shows only photo, name and assigned station. Photos remain in the local tenant configuration.
- **Settings:** company/site, reasons, schedule, roster/photos, role definitions and task template edit routes.
- **Backup and recovery:** schema-checked, installation-scoped JSON backup; validation; rollback-aware restore; clean-install restore path.
- **QA:** domain/flow regression plus Chromium desktop/mobile browser suite for the implemented paths.

### Not yet at Main parity — release blockers
- Secure user account creation, login/session lifecycle and account administration.
- Backend-enforced permissions for each protected action and a read-only spectator policy.
- A separately provisioned DOWNTIMEUI backend, server-side tenant isolation policies, shared persistence, realtime sync and concurrent-edit conflict resolution.
- Central audit trail with authenticated user attribution.
- Secure private photo storage, signed upload/download and linking staff profiles to authenticated accounts. The local profile-photo upload and rendering flow is implemented.
- Server-managed backup, retention, monitoring and tested disaster recovery.
- Full Main Plant Overview blueprint/visual parity and any remaining uncovered edge cases.

Local role definitions and browser controls are not secure access control. Local plant state is an operational record, not a machinery-control command. These limitations must remain visible until the backend and security work is completed.
