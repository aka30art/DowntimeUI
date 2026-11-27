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
