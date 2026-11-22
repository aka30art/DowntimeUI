# DOWNTIMEUI — Release Readiness Ledger

Development branch: `feature/universal-app-foundation`

## Implemented
- Universal empty-state installation, configurable tenant model, resumable setup and section-based Settings editing.
- Local operations: downtime-entry CRUD, station selection, per-day operator assignment, live Start/Stop Shift controls and manual actual shift-time overrides.
- Schedule engine: configured/actual shift windows, overnight periods, merged overlap handling and break deduction within shift boundaries.
- Daily and weighted weekly metrics, downtime cause ranking and week-on-week comparison.
- Weekly report snapshots, archive, print/PDF and JSON export.
- Plant Overview: plant status, station status, operator assignment, portrait/name/station cards, alerts and local transition history.
- Daily Tasks: checklist completion and immutable per-day **SAVE & LOCK FOR TODAY** snapshots.
- Tenant-scoped backup validation, same-installation restore, rollback on simulated storage failure and clean-installer recovery.
- Optional staff portrait upload with supported image type/size validation, 320px square JPEG compression and local storage.
- Responsive desktop/mobile UI.

## Automated verification
- Configuration defaults, validation, migration and local persistence.
- Shift/break intervals, overnight schedule arithmetic, actual shift-time overrides and weighted weekly metrics.
- Downtime-entry validation and cause ranking.
- Daily task completion, immutable snapshot and lock behavior.
- Role-definition and permission-helper validation.
- Plant/station state transitions and exclusive operator assignment.
- Weekly report snapshot and archive immutability.
- Backup integrity, tenant separation, rollback and restore.
- Installer and workspace integration flow.
- Tenant neutrality and absence of Main production connection details.
- Chromium browser QA for installation, staff photo upload/compression and restored portrait, live shift start/stop and actual shift override/reset, daily entry CRUD, Plant Overview operator assignment, task lock persistence, weekly intelligence, report archive, Settings edits, backup export/import, clean-install recovery and 390px mobile overflow. Latest successful run: 44979557773 on commit 8e253506ce8fd83adfd772b0137fea2195544f41; screenshot artifact: downtimeui-browser-qa.

## Release blockers
1. Authentication, secure account lifecycle and identity attribution are not implemented.
2. Role definitions are not enforced by a server; spectator/read-only policy is not secure.
3. Shared multi-user persistence, tenant isolation policies, realtime sync and conflict resolution are not implemented.
4. Central audit trail, private photo storage/signed URL lifecycle and authenticated account-to-staff linking are not implemented. Local staff photo upload/display is implemented.
5. Server backup/retention policies, monitoring and disaster recovery are not implemented.
6. Full Main visual/functional parity and final security review remain open.
7. A separate DOWNTIMEUI development backend must be provisioned and reviewed before multi-user operation. Main production backend and credentials must not be reused.

## Release boundary

No merge to `main`, GitHub Pages publication or production upload is permitted until the user gives the exact instruction **DEPLOY & Merge**.
