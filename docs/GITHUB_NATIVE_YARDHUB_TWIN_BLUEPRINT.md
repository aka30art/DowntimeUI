# YARDHUB / DOWNTIMEUI — GitHub-Native Twin Architecture Blueprint

**Status:** Phase 0 repository audit and architecture proposal  
**Date:** 27 November 2026  
**Scope:** Documentation only. No application code, production data, Supabase configuration, deployment, or primary-system behaviour is changed.

## 1. Decision and non-negotiable boundaries

The target is two independently operable systems:

- **YARDHUB Primary:** the existing `aka30art/DOWNTIME` application. It remains the original production system and retains its existing Supabase infrastructure.
- **DOWNTIMEUI GitHub Twin:** the existing `aka30art/DowntimeUI` project, expanded into a complete functional twin whose own runtime and operational data do not depend on Supabase or another external provider.
- **Controlled Sync:** a separately specified replication and reconciliation layer. The initial direction is YARDHUB → GitHub continuous backup, with explicit authority transfer.
- **Recovery:** versioned snapshots, append-only change records, integrity checks and rehearsed restoration.

The existing DOWNTIME/YARDHUB application must not be modified as part of the DOWNTIMEUI build. No DOWNTIME module UI, checksheet, preset, permission, or workflow may be changed for convenience during the duplication. Central Data Bank remains separate from DOWNTIME's operational module boundaries.

Both systems may be available at all times, but shared operational data must have one declared writer/authority at a time. A switch of primary authority must be explicit, versioned and gated by reconciliation. The secondary can remain independently operable against its own dataset, but its divergent writes must be reconciled before becoming the shared authority.

## 2. Repositories inspected

### Primary — `aka30art/DOWNTIME`

Default branch: `main`  
Inspected tree head: `ba99913d1eaff7d99785088fd0931b3815defd4c`

The repository contains the full YARDHUB application, browser UI, module code, tests, Supabase migrations, and Supabase Edge Functions. Current module/backend surfaces include:

- Central Bank identity, sessions, USER/STAFF records, ROOTS authority and audit.
- YARD ROLE registry, assignments and department permissions.
- YARD HUB settings and configuration control plane.
- DOWNTIME operational tracker, daily/weekly records, assignments and reports.
- GATELOG customers, vehicles, visits, waste types, Gateman assignments and report archive.
- R&M assets, machinery catalogue, faults, presets, settings, PDF exports and audit.
- Photo evidence and staff photo storage.
- Spectator read-only state.
- Central configuration and operational settings.

The repository contains numerous additive SQL migrations and separate Edge Function APIs. Supabase is not a thin storage adapter: it currently supplies the session authority, server-side permission checks, atomic writes, persistent records, file storage, realtime broadcasts and API execution.

### GitHub twin — `aka30art/DowntimeUI`

Default branch: `main`  
Inspected tree head: `58955b13f6a70f9da44d6ead9e409639086989a7`

The repository already contains a universal, tenant-configurable local application foundation:

- Installer and configuration core.
- Downtime entry and calculations.
- Schedule and break handling.
- Daily Tasks and immutable local day snapshots.
- Plant overview and local transition history.
- Reports and browser print/PDF.
- Local backup, restore and factory reset.
- Permission configuration helpers.
- Automated domain, flow and Chromium browser tests.

Its own implementation-status and feature-parity documents explicitly state that it is a local single-browser build, not a production multi-user system. Authentication, session lifecycle, shared persistence, server-enforced permissions, concurrency, audit attribution, central backup/recovery and secure shared photo handling are not complete.

This is a useful starting point, but it is not a code-level duplicate of the current YARDHUB application. The existing installer-oriented tenant model must be reconciled with the specific YARDHUB module and operational model rather than replacing the original application wholesale.

## 3. Confirmed Supabase dependency map

The following are confirmed source-level dependencies, not merely package references.

| Existing capability | Current implementation surface | Required GitHub-twin replacement |
|---|---|---|
| Central USER login and session | `central-bank` Edge Function; `downtime_central_sessions`; `central-bank-client.js` | DOWNTIMEUI-owned account/session model and GitHub-native persistence |
| USER, STAFF and ROOTS authority | Central Bank payload, ROOTS tables, shared identity modules | Stable IDs, explicit role/authority records and one twin-side resolver |
| YARD ROLE permissions | `yard_roles`, `yard_role_assignments`, `yard_role_department_permissions` | Versioned module/department permission records |
| Central configuration | `central-config-admin`, Central Bank state and audit | Independent configuration domain and audit events |
| DOWNTIME state | Central Bank operational save paths and existing report/evidence facilities | Full operational event and state persistence |
| GATELOG | `gatelog-api` and `gatelog_*` relational tables | Customers, vehicles, visits, waste line items, assignments, archive and audit |
| R&M | `repair-maintenance-api` and `repair_maintenance_*` tables | Assets, models, faults, notes, presets, settings, PDF archive and audit |
| Photo evidence | `photo-evidence`, private storage buckets and metadata | GitHub-compatible file/object strategy plus metadata and retention manifest |
| Staff photo originals | Central Bank upload path and GitHub originals integration | Twin-owned file path and integrity manifest |
| Spectator view | `spectator-read` and broadcast/state mechanisms | Read-only snapshot projection and polling/version checks |
| Realtime state | Supabase Realtime publication/broadcast | Version polling and refresh notifications; no native GitHub equivalent to Supabase realtime |
| Atomic writes | Database RPCs, optimistic versions and Edge Function transactions | Compare-and-swap commits, append-only events and deterministic conflict reconciliation |

### Important implementation finding

The Central Bank, GATELOG and R&M Edge Functions directly use the Supabase client, query relational tables, call RPCs, and access Storage. The Central Bank also implements login/session validation, ROOTS resolution, YARD ROLE resolution, account lifecycle, audit and administrative workflows. R&M and GATELOG each have their own substantial server-side action surfaces.

Therefore, changing only the frontend's data URL or replacing a few `supabase.from()` calls is insufficient. Each server-side action needs an explicit equivalent in DOWNTIMEUI's GitHub-native data and processing model.

## 4. GitHub-only runtime and data architecture

### 4.1 Application hosting

Use GitHub Pages and GitHub Actions for the DOWNTIMEUI frontend build and deployment, subject to confirming the intended use complies with GitHub Pages terms and repository visibility/plan constraints.

GitHub Pages is static hosting. It is not an always-running application server and does not itself provide database transactions, authentication, private file storage or realtime subscriptions.

### 4.2 Data persistence

Preferred candidate: a dedicated GitHub data repository, separate from the DOWNTIMEUI application repository. This separation prevents operational record commits from triggering frontend deployment and allows independent data retention and restoration.

The data layout should be module-scoped and versioned, for example:

```text
YARDHUB-DATA/
  CONTROL/
    authority.json
    schema-version.json
    replication-checkpoint.json
  IDENTITY/
    users/
    staff/
    roots/
    yard-roles/
    sessions/
  DOWNTIME/
    events/
    daily/
    weekly/
    reports/
    evidence-manifests/
  RM/
    assets/
    models/
    faults/
    presets/
    settings/
    reports/
  GATELOG/
    customers/
    vehicles/
    visits/
    waste-types/
    assignments/
    reports/
  CENTRAL-DATA-BANK/
    configuration/
    audit/
  SYNC/
    inbound/
    outbound/
    conflicts/
    snapshots/
```

Do not place the entire application state into one ever-growing JSON document. Use stable record IDs, append-only event/change records, bounded snapshots and module-specific projections. Large media should not be embedded in JSON or committed as frequently changing binary blobs; the file strategy must be separately tested against repository limits and Pages publishing boundaries.

### 4.3 GitHub API write model

The GitHub Contents/Git Data APIs can store versioned records, but they are not a transactional database. A write must use the current blob/commit SHA and handle stale-write conflicts. The design must:

- Queue and batch writes rather than creating a commit for every keystroke.
- Use stable operation IDs and idempotency keys.
- Preserve append-only event history.
- Use per-module/per-day/per-tenant shards to reduce contention.
- Retry only after reading and reconciling the latest version.
- Reject stale or conflicting writes rather than silently overwriting.
- Maintain checksums and snapshot manifests.

A browser-side GitHub credential would be exposed to users. This is not a suitable production pattern. A GitHub-only implementation therefore needs an explicitly selected credential and write-orchestration approach. GitHub Actions can process queued jobs but is asynchronous and requires authenticated workflow dispatch; it is not a low-latency always-on API. This is a key feasibility gate, even where security is not the primary design constraint.

### 4.4 Authentication and permissions

DOWNTIMEUI must not depend on YARDHUB's Supabase sessions, user tables, or credentials. It needs its own identity/session model and its own role/permission authority.

The twin must preserve the distinction between:
- USER: a person who can authenticate to the system.
- STAFF: an operational personnel record, which does not automatically imply a login.
- ROOTS: protected system authority.
- YARD ROLE: module/department rights, including VIEW, ENTER, EDIT and MANAGE.

Client-side UI hiding is not server-side enforcement. The selected GitHub-only write gateway must validate every protected operation against the current twin authority record. The user's instruction not to make security the limiting factor does not remove the need for reliable actor attribution, data integrity and authority checks.

### 4.5 Realtime and offline behaviour

GitHub does not provide Supabase-style realtime database subscriptions. The twin should use version polling, visibility-triggered refresh and explicit sync status. Offline writes should enter a local durable queue with stable IDs and be reconciled on reconnect. A stale device must not overwrite a newer primary state.

## 5. Controlled synchronisation and primary switching

### Initial replication direction

YARDHUB → DOWNTIMEUI GitHub data repository.

The existing primary remains authoritative while backup replication is active. A replication checkpoint must record the source version/time, module, record range, schema version, checksum and completion status. The replication process must be idempotent and resumable.

The replication bridge must be explicitly implemented. Candidate approaches are:
1. A scheduled GitHub Actions workflow that reads the primary's approved export/API using credentials held as GitHub Actions secrets.
2. A source-side export/push action from the existing YARDHUB backend to the GitHub data repository.

The exact bridge cannot be selected until the current primary export surface, data volume, rate limits and credentials are audited. The GitHub twin's own runtime must remain independent of Supabase; the backup bridge is the only planned connection to the primary.

### Primary authority record

Maintain an authority manifest containing:
- current primary system ID;
- monotonically increasing authority epoch;
- last accepted source/event sequence;
- last successful replication checkpoint;
- schema version;
- cutover state (ACTIVE, PREPARING, FROZEN, RECONCILING, ACTIVE);
- explicit operator/administrator approval metadata.

### Switch protocol

1. Freeze new shared writes on the current primary.
2. Complete and verify the last replication checkpoint.
3. Compare source and destination manifests, record counts and checksums.
4. Reconcile missing, duplicate and divergent events.
5. Increment authority epoch and mark the new primary active.
6. Confirm the former primary is read-only for the shared dataset.
7. Resume writes only on the newly designated primary.
8. Record the cutover event and retain a rollback snapshot.

Returning to YARDHUB requires the same protocol in reverse. No automatic failover should promote a stale replica without reconciliation.

## 6. Feature parity and migration order

The parity ledger must track every feature, data domain, action, permission, report, export and edge case. The target is complete functional parity, but no parity claim is valid until tests pass.

Recommended work order:

1. **Phase 0 — Audit and blueprint:** source inventory, schema/data export inventory, API/action catalogue, module parity matrix and architecture approval.
2. **Phase 1 — GitHub data foundation:** schema/version contracts, record IDs, event log, storage adapter, commit conflict handling, snapshots and restore tests.
3. **Phase 2 — Identity and authority:** twin-only login/session, USER/STAFF separation, ROOTS, YARD ROLE, module permission matrix and audit.
4. **Phase 3 — DOWNTIME parity:** checksheets, shifts, break handling, operators, downtime records, weekly analytics, reports, locks and photo evidence.
5. **Phase 4 — R&M parity:** machine registry, models, assets, faults, notes, presets, settings, PDFs and history.
6. **Phase 5 — GATELOG parity:** customers, vehicles, visits, multiple waste types, Gateman assignments, statistics, reports and history.
7. **Phase 6 — Central Data Bank and YARDHUB administration:** preserve independent module boundaries and administrative access rules.
8. **Phase 7 — Replication and reconciliation:** continuous YARDHUB-to-GitHub backup, integrity verification, offline queue and conflict tooling.
9. **Phase 8 — Authority switching and recovery:** rehearsed cutover, reverse cutover, backup restoration and failure simulation.
10. **Phase 9 — Full acceptance:** cross-device/multi-user tests, module-by-module parity, regression, browser QA and operational rehearsal.

## 7. Release gates

DOWNTIMEUI is not a production replacement until all of the following are true:

- Every primary module and action has a documented twin equivalent.
- All data domains have export/import and integrity checks.
- Twin-side identity and permission rules are enforced by the write gateway.
- Simultaneous writes and stale clients produce safe conflicts, not lost updates.
- Replication is continuous, resumable and auditable.
- Primary switching and reverse switching have been rehearsed.
- Recovery from a clean browser/device has been demonstrated.
- The complete DOWNTIMEUI test suite, new contract tests and multi-user browser tests pass.
- No production DOWNTIME/YARDHUB regression is introduced.
- No change to the primary system is made without a separate explicit implementation and release plan.

No merge, deployment, primary cutover or Supabase removal is authorised by this blueprint.

## 8. Phase 0 exit status

**Completed from read-only repository inspection:**
- Located both repositories and confirmed default branches.
- Inspected the current DOWNTIME and DOWNTIMEUI repository trees.
- Inspected the primary Supabase architecture document, central identity dependency map, key Edge Function sources, CI and Pages workflows.
- Inspected DOWNTIMEUI's implementation status, feature parity audit, backend specification, package scripts and local persistence/backup implementation.
- Confirmed the twin is currently local-browser-only and that the primary uses multiple substantial Supabase Edge Function and relational/storage services.

**Still required before Phase 0 can be marked fully complete:**
- Exhaustive source census of every Supabase table, RPC, Storage bucket, Realtime channel, Edge Function action, frontend caller and migration.
- Complete inventory of the primary's current data tables, row counts, media sizes, exports and retention requirements.
- Exact DOWNTIMEUI feature-by-feature parity matrix against the current primary main branch.
- A tested GitHub-only write-orchestration prototype, including concurrency and failure behaviour.
- Selection and approval of the YARDHUB → GitHub replication bridge.

**Current state:** architecture proposal prepared; no application code or production system changed.


## 9. Live Supabase inventory — read-only checkpoint, 27 November 2026

The linked production project was inspected read-only. Project status returned `ACTIVE_HEALTHY`, region `eu-west-1`, PostgreSQL 17. No SQL writes, migrations, function deployments, storage mutations or configuration changes were performed.

### Platform inventory

- **39 public tables** were returned by the live table inventory; all 39 report RLS enabled.
- **49 applied migrations** were returned. Latest: `20261127095422_canonical_user_session_tier_nullable`.
- **7 active Edge Functions**:
  - `central-bank` v31
  - `photo-evidence` v9
  - `repair-maintenance-api` v21
  - `spectator-read` v10
  - `yard-hub-settings-api` v21
  - `central-config-admin` v10
  - `gatelog-api` v15
- **5 private Storage buckets**:
  - `downtime-evidence`
  - `downtime-pdfs`
  - `downtime-staff-photos`
  - `repair-maintenance-evidence`
  - `repair-maintenance-reports`
- Storage object inventory at this checkpoint: 6 downtime-evidence objects (6,172,205 bytes), 2 downtime-pdfs objects (61,578 bytes), 0 staff-photo objects, 0 R&M evidence objects, and 1 R&M report object (5,010 bytes). Total observed: 9 objects, 6,238,793 bytes. This is a point-in-time inventory, not a full export or retention assessment.
- The `supabase_realtime` publication currently contains only `public.downtime_shared_state`. Other module updates are served through API reads/writes and refresh flows, not publication membership.

### Live table row-count snapshot

The following row counts are the values returned by the live table inventory. They are a migration planning snapshot, not a substitute for exported records and checksums.

| Table | Rows |
|---|---:|
| downtime_shared_state | 1 |
| downtime_reports | 2 |
| downtime_attachments | 6 |
| downtime_central_bank | 1 |
| downtime_central_sessions | 13 |
| downtime_central_audit | 650 |
| downtime_central_config_state | 1 |
| downtime_central_config_history | 3 |
| repair_maintenance_faults | 18 |
| repair_maintenance_notes | 0 |
| repair_maintenance_attachments | 0 |
| repair_maintenance_audit | 95 |
| yard_hub_tier_config | 1 |
| yard_hub_access_audit | 26 |
| repair_maintenance_machine_presets | 21 |
| repair_maintenance_pdf_exports | 1 |
| repair_maintenance_assets | 5 |
| repair_maintenance_machine_settings | 6 |
| repair_maintenance_machine_models | 4 |
| downtime_daily_operator_assignments | 11 |
| downtime_daily_operator_audit | 11 |
| gatelog_customers | 3 |
| gatelog_vehicles | 3 |
| gatelog_visits | 0 |
| gatelog_waste_types | 6 |
| gatelog_visit_waste_types | 0 |
| gatelog_audit | 16 |
| gatelog_daily_gateman_assignments | 1 |
| gatelog_report_archive | 0 |
| yard_roles | 6 |
| yard_role_department_permissions | 30 |
| yard_role_assignments | 2 |
| yard_role_assignment_audit | 2 |
| downtime_roots_assignments | 2 |
| downtime_roots_assignment_audit | 4 |
| yard_role_definition_audit | 17 |
| downtime_roots_bootstrap | 1 |
| downtime_identity_reset_runs | 1 |
| downtime_roots_role_definitions | 2 |

### Implications for the backup design

1. The backup must cover more than the operational tracker. Identity, sessions, role definitions/assignments, audit history, configuration drafts and published versions, GATELOG and R&M records, daily assignments, report metadata and all five Storage buckets require explicit export treatment.
2. Storage file contents must be copied and checksum-verified; copying database metadata alone does not preserve photo evidence or PDFs.
3. Session tokens should not be replicated as active sessions. The GitHub twin needs its own independent session lifecycle; the backup should preserve account identity and relevant audit history without treating primary sessions as valid twin sessions.
4. The live row counts show existing operational and audit history. Empty-looking GATELOG visit or R&M attachment tables do not imply that the rest of their module data can be omitted.
5. The sole Realtime publication member confirms that replacing Supabase realtime with GitHub polling is a manageable design change, but all client refresh paths still need explicit parity tests.

## 10. Updated Phase 0 exit status

**Additional live read-only work completed:**
- Confirmed the primary Supabase project is currently active and healthy.
- Enumerated all 39 public tables and confirmed RLS is enabled on each.
- Enumerated 49 applied migrations and 7 active Edge Functions.
- Enumerated all 5 private Storage buckets and counted their current objects and bytes.
- Enumerated the current Realtime publication membership.
- Captured a live table row-count snapshot for migration planning.

**Still required before Phase 0 can be marked fully complete:**
- Export-level verification of every table, including complete row contents, foreign-key relationships, large JSON payloads and checksums.
- Full Storage object listing and actual file export/checksum verification, including report/evidence references.
- Exhaustive source census of all browser callers and all Edge Function actions, SQL RPCs, triggers and policies.
- Complete feature-by-feature parity matrix against the current primary main branch.
- A tested GitHub-only write-orchestration prototype with concurrent writes, stale writes, retry, outage and restoration scenarios.
- Selection and rehearsal of the YARDHUB → GitHub replication bridge.

**Updated state:** repository audit and live platform inventory are documented. Phase 0 remains open until export completeness, source census and the write-gateway feasibility test are complete. No production system or application code has been changed.


## 11. Phase 1 — GitHub-native storage engine prototype

**Implementation branch:** `architecture/github-native-yardhub-twin`  
**Data branch:** `data/yardhub`  
**Application PR:** [#3 — Architecture: GitHub-native YARDHUB functional twin](https://github.com/aka30art/DowntimeUI/pull/3)

### Data branch initialisation

The `data/yardhub` branch was created with a data-only tree containing:
- `README.md`
- `control/authority.json`

Initial authority:
- Primary: `YARDHUB-PRIMARY`
- Secondary: `DOWNTIMEUI-GITHUB`
- Authority epoch: 1
- Status: ACTIVE
- Replication status: NOT_CONFIGURED

No production YARDHUB/DOWNTIME records, sessions, credentials, reports or evidence were copied to this branch.

The branch is currently a data-branch prototype inside the public DOWNTIMEUI repository, not yet a separate private/dedicated data repository. Its current manifest is safe test metadata only. Do not treat this branch as the long-term production destination until the final repository/storage layout is chosen.

### Implemented source files

- `src/infrastructure/github-data-store.js`
  - GitHub Git Data API client.
  - Optimistic non-fast-forward ref update for compare-and-swap commit behaviour.
  - Append-only per-system, per-module, per-day event shards.
  - Stable event IDs and duplicate suppression.
  - Primary vs secondary-local write classification.
  - Versioned workspace snapshots with expected-version checks.
  - Authority manifest read/update.
  - Prepare → freeze → complete/cancel primary-switch state machine.
  - Reconciliation proof requirement: verified=true, zero unresolved conflicts and equal source/target checksums.
- `src/infrastructure/github-connection.js`
  - Repository/branch connection configuration.
  - Session-scoped GitHub token storage.
  - Store construction and disconnect handling.
- `src/workspace.js`
  - GitHub connection panel in DOWNTIMEUI Settings → People & settings.
  - Connection verification against the authority manifest.
  - Debounced automatic backup of the local workspace to a versioned GitHub snapshot after local saves.
  - Manual Sync and Restore controls.
  - Reconnect using the current browser session.
  - Local browser persistence remains the immediate save path; GitHub snapshot is the remote backup path.
- `tests/github-data-store.test.js`
  - Secondary writes, idempotency, concurrent-write retry, authority switch sequencing, primary role, stale epochs, cancellation and snapshot version conflicts.
- `tests/github-connection.test.js`
  - Connection metadata/token separation, invalid settings, disconnect and missing-token behaviour.

### Important behaviour and current limitations

1. The DOWNTIMEUI runtime writes its own workspace snapshot under the DOWNTIMEUI system identity. The initial authority manifest keeps YARDHUB as primary, so these writes are labelled SECONDARY_LOCAL until a controlled authority switch is completed.
2. The snapshot stores the DOWNTIMEUI installation's configuration and local operation state. It is not yet a replicated copy of the main YARDHUB data.
3. The event API is available for subsequent module integration; the current existing workspace save paths are snapshot-backed rather than fully mapped to domain events.
4. Cross-device restore currently assumes the target workspace has the matching installation ID/configuration. A clean-device discovery/restore workflow and shared installation registry remain to be implemented.
5. The data branch currently holds metadata only. No operator should enter an actual GitHub token until they are ready to connect to the prototype. The app requires a repository token with Contents read/write access; tokens are held in the current browser session and are not committed to source.
6. The snapshot uses a bounded JSON file size. Larger data volumes need sharding, checkpoint compaction and media storage handling before production.
7. Primary-switch primitives are tested in isolation. They are not wired to live production YARDHUB or to a real replication checkpoint and must not be used for cutover yet.
8. GitHub's API and rate limits, large-file boundaries and Pages terms remain part of the production feasibility review.

### Validation checkpoint

- A GitHub Actions PR run for commit `1d7260f296a54164ff91e6328afdd03c74df88e5` completed successfully, including `npm run check` and Chromium browser QA.
- A later PR run for the workspace snapshot/connection integration reached `npm run check` successfully; Chromium browser QA was still running at the time of this documentation update.
- The test suite is wired through the existing DOWNTIMEUI `npm run check` / `npm test` workflow.

**Phase 1 status:** storage and browser connection prototype implemented. Phase 1 is not complete until the latest CI run finishes successfully, concurrent-writer behaviour is exercised with a real GitHub branch, and a clean-device restore is implemented and tested.

No merge, production deployment, primary cutover or Supabase removal has been performed.
