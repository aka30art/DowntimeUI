# DOWNTIMEUI — Universal Edition

Company-neutral installation and interface development environment for DOWNTIME.

## Product boundary
- New installations begin with an empty tenant configuration.
- Company identity, site hierarchy, areas, stations, reasons, schedules, staff, roles and daily task templates are configured per installation.
- Demo content in the preview interface is fictional and must never be treated as operational data.
- This branch must not contain production credentials, production tenant records or production database connections.

## Current development scope
The universal first-run installer supports local draft persistence, validation, installation and JSON export. A local operations workspace is now connected to the installer. It supports downtime entry, operator assignment, daily task locking, weighted weekly metrics, report snapshots and export. Its operational state is local to one browser; shared persistence, authentication, user provisioning, server-enforced permissions, cross-device sync, secure backups and full Main feature parity remain separate implementation gates.

## Quality and release boundary
- Development branch: `feature/universal-app-foundation`
- CI runs configuration tests, JavaScript syntax checks and project integration smoke checks.
- No merge to `main`, GitHub Pages deployment or production release is authorised until the user gives the exact instruction **DEPLOY & Merge**.
- A green installer CI result does not mean the complete DOWNTIME application is release-ready.
