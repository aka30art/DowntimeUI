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
