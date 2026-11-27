# YARDHUB GitHub-twin service and feature parity matrix

**Audit date:** 27 November 2026  
**Target:** `aka30art/DowntimeUI`, PR #3, branch `architecture/github-native-yardhub-twin`  
**Reference baseline:** `yardhub/reference/` — source manifest pins `aka30art/DOWNTIME` main tree `ba99913d1eaff7d99785088fd0931b3815defd4c`  
**Status:** source inventory completed for the seven Edge Function entrypoints; twin acceptance is not yet demonstrated.

## 1. Acceptance rule

The preserved source files are the comparison baseline. A successful bundle/build, handler registration test, or static route inventory does **not** prove service parity. Each action below must eventually pass a trusted-broker integration test against a private GitHub data repository, including positive and negative authorization cases, state integrity, audit attribution, retries, concurrency and browser workflow acceptance.

Current status for the actions listed below is **INVENTORIED / TWIN EXECUTION UNVERIFIED**. No action is being represented as production-complete.

## 2. Service entrypoint and action catalogue

### Central Bank — 30 action values

Source: `yardhub/reference/supabase/functions/central-bank/index.ts`  
Source blob SHA: `eb513d824b3666d0b38e196e5109160598d58f14`

| Area | Actions |
|---|---|
| Bootstrap and sessions | `bootstrap`, `login`, `logout`, `list-users`, `users` |
| State and plant | `get-state`, `save-state`, `save-settings`, `set-plant-status` |
| USER / STAFF lifecycle | `user-save`, `user-delete`, `user-staff-provision`, `user-staff-activate`, `staff-save`, `tiers-save` |
| ROOTS and diagnostics | `identity-reset`, `identity-diagnostics` |
| Central configuration | `central-admin-state`, `central-config-state`, `central-config-save-draft`, `central-config-publish`, `central-config-restore-draft` |
| Daily operator register | `daily-operator-list`, `daily-operator-assign`, `daily-operator-unlock` |
| Evidence and photos | `photo-evidence-context`, `staff-original-upload`, `staff-photo-url`, `staff-photo-read`, `staff-photo-remove` |

**Principal data dependencies:** Central Bank state, USER sessions and audit, ROOTS assignments/bootstrap/reset records, YARD ROLE assignments/permissions/definitions, configuration state/history, daily operator assignments/audit, DOWNTIME evidence metadata and STAFF photos.

### Central Config Admin — 8 action values

Source: `yardhub/reference/supabase/functions/central-config-admin/index.ts`  
Source blob SHA: `a33bc32ae93d5e231e19dc8123d9972a29bd88ba`

| Area | Actions |
|---|---|
| Configuration lifecycle | `central-config-state`, `central-config-save-draft`, `central-config-publish`, `central-config-restore-draft` |
| Governance and validation | `central-config-audit`, `central-config-impact`, `central-config-validate` |
| Navigation/menu | `yard-hub-menu` |

**Principal data dependencies:** Central Bank identity/session, Central Bank configuration state/history, ROOTS bootstrap, Central Bank audit and YARD HUB navigation configuration. The source constrains central configuration administration to immutable DEV authority.

### GATELOG — 19 action values

Source: `yardhub/reference/supabase/functions/gatelog-api/index.ts`  
Source blob SHA: `b2126ef329211dff8d5ffd7c31b1754d2d5d8ed9`

| Area | Actions |
|---|---|
| Initialisation and lookup | `bootstrap`, `history`, `day-register` |
| Customers and vehicles | `customer-save`, `customer-update`, `customer-archive`, `vehicle-save` |
| Site entry and exit | `arrival`, `customer-arrival`, `departure`, `visit-update`, `visit-delete` |
| Waste taxonomy | `waste-type-create`, `waste-type-update` |
| Gateman assignment | `gateman-save`, `gateman-lock` |
| Reporting | `report`, `report-save`, `report-archive` |

**Principal data dependencies:** customers, vehicles, visits, visit/waste junctions, waste types, daily Gateman assignments, GATELOG audit/report archive, Central Bank identity/session, ROOTS and YARD ROLE.

### Photo Evidence — 4 action values

Source: `yardhub/reference/supabase/functions/photo-evidence/index.ts`  
Source blob SHA: `cb1a695cf4f7d90a206e17dc5dfcbcfd8d3953a1`

| Area | Actions |
|---|---|
| Object lifecycle | `create-upload`, `view`, `delete`, `cleanup` |

**Principal data dependencies:** DOWNTIME attachment metadata, Central Bank identity/access context, audit and private Storage object bytes. This service must enforce the rights of the module/record that owns each object; a signed URL is not a substitute for authorisation.

### Repairs & Maintenance — 25 action values

Source: `yardhub/reference/supabase/functions/repair-maintenance-api/index.ts`  
Source blob SHA: `0cfe7b02b3126f10f078fe73e3e2f696e4a5491a`

| Area | Actions |
|---|---|
| Access and faults | `access`, `list`, `get`, `create`, `update`, `delete` |
| Fault history and evidence | `note-add`, `upload` |
| Machine register/assets | `asset-list`, `asset-add`, `asset-update`, `asset-delete`, `asset-archive` |
| Model catalogue | `model-list`, `model-add`, `model-delete` |
| Presets and settings | `preset-list`, `preset-add`, `preset-delete`, `settings-get`, `settings-update` |
| PDF/report archive | `export-create`, `export-list`, `export-url`, `export-delete` |

**Principal data dependencies:** R&M assets, machine models, faults, notes, attachments, presets, machine settings, PDF export archive/audit, Central Bank identity/session, ROOTS, YARD ROLE and tier permissions, private evidence/report Storage.

### Spectator Read — 1 read surface

Source: `yardhub/reference/supabase/functions/spectator-read/index.ts`  
Source blob SHA: `c63f4c188643f8fef0b9f5cc802d6352dc8db0e1`

| Area | Read surface |
|---|---|
| Read-only snapshot | Access-code-gated read from `downtime_shared_state` |

**Principal data dependencies:** DOWNTIME shared snapshot and spectator access verification. No mutation path is permitted.

### YARD HUB Settings — 9 action values

Source: `yardhub/reference/supabase/functions/yard-hub-settings-api/index.ts`  
Source blob SHA: `8e5c5e1e1b668b72715fa1bb38387a0537ef73ac`

| Area | Actions |
|---|---|
| Actor access | `my-access`, `settings-state` |
| ROOTS | `roots-state`, `roots-manage` |
| YARD ROLE definitions/assignments | `yard-role-save`, `assign-user-role` |
| Tier and department permissions | `save-tier-settings`, `save-user-tier`, `remove-user-tier` |

**Principal data dependencies:** Central Bank USER/session, ROOTS bootstrap/assignments/definitions, YARD ROLE definitions/assignments/department permissions and YARD HUB tier configuration.

## 2A. Preserved browser caller map

This section maps the preserved UI sources to service requests. It is a static caller scan of the pinned `yardhub/reference/` snapshot, not runtime traffic capture. A literal action call is evidence that the UI exposes or invokes that action; absence of a literal call does not prove an action is unused because a caller may construct it dynamically or invoke it from another service.

| Service | Preserved browser caller(s) | Literal actions found in caller scan | Caller coverage notes |
|---|---|---|---|
| Central Bank | `central-bank-client.js`; `central-bank-admin.html`; shared use from `index.html` and `repair-maintenance.html` | `bootstrap`, `daily-operator-assign`, `daily-operator-list`, `daily-operator-unlock`, `get-state`, `identity-diagnostics`, `identity-reset`, `list-users`, `login`, `logout`, `save-settings`, `save-state`, `set-plant-status`, `staff-original-upload`, `staff-photo-read`, `staff-photo-remove`, `staff-photo-url`, `staff-save`, `tiers-save`, `user-delete`, `user-save`, `user-staff-activate`, `user-staff-provision` | `central-bank-admin.html` also uses the central-bank endpoint for bootstrap/login/logout. The browser scan did not find direct literal calls for `users`, `central-admin-state` or `photo-evidence-context`; trace these internal/indirect paths explicitly before claiming caller coverage. |
| Central Config Admin | `central-bank-admin.html`; `yard-hub-structure.js`; shared config from `index.html` and `repair-maintenance.html` | `central-config-state`, `central-config-save-draft`, `central-config-publish`, `central-config-restore-draft`, `central-config-audit`, `central-config-impact`, `central-config-validate`, `yard-hub-menu` | All eight source action values have a preserved UI caller. The DEV-only rule must remain enforced in the trusted broker, not by hiding the UI link. |
| GATELOG | `gatelog-app.js`, `gatelog-day-management.js`, `gatelog-settings.js` | `bootstrap`, `arrival`, `customer-arrival`, `day-register`, `departure`, `visit-delete`, `visit-update`, `gateman-lock`, `gateman-save`, `report`, `report-save`, `customer-archive`, `customer-save`, `customer-update`, `report-archive`, `waste-type-create`, `waste-type-update` | The scan found 17 of 19 backend action values. No direct literal call was found for `history` or `vehicle-save`; establish whether these are intentionally API-only, dynamically invoked or missing UI functionality. |
| Photo Evidence | inline caller in `index.html` | `create-upload`, `view`, `delete` | `cleanup` is not a browser action in the caller scan; it is a protected service/maintenance operation and needs a broker-only contract test. |
| Repairs & Maintenance | `repair-maintenance-app.js`; `repair-maintenance-launch.js`; endpoint config in `repair-maintenance.html` | `access`, `list`, `get`, `create`, `update`, `delete`, `note-add`, `upload`, `asset-list`, `asset-add`, `asset-update`, `asset-delete`, `asset-archive`, `model-list`, `model-add`, `model-delete`, `preset-list`, `preset-add`, `preset-delete`, `settings-get`, `settings-update`, `export-create`, `export-list`, `export-url`, `export-delete` | All 25 action values have literal caller coverage in the preserved R&M UI scripts. Permission-negative tests and private Storage object scope remain outstanding. |
| Spectator Read | inline `index.html` spectator refresh flow | `spectator-read` | The caller uses Supabase `functions.invoke`; verify access-code validation, approved snapshot projection, no write path and data minimisation. |
| YARD HUB Settings | `yard-hub-settings.js` | `my-access`, `settings-state`, `roots-state`, `roots-manage`, `yard-role-save`, `assign-user-role`, `save-tier-settings`, `save-user-tier` | The scan found eight of nine backend action values; no direct literal call was found for `remove-user-tier`. Determine whether removal is dynamically performed through another action or the backend action is orphaned. |

### Caller-to-service acceptance requirements

1. Capture every request action, payload schema, response schema and caller file/line (including dynamic action construction). Keep this trace stable against the pinned source manifest.
2. For the GATELOG, YARD HUB Settings and Central Bank gaps above, make an explicit decision: preserve an API-only operation with a service-only test, identify the dynamic caller, or implement the missing UI workflow only if it exists in the source contract.
3. For every caller action, execute the same workflow through the GitHub twin and assert the expected table mutations, audit events, authorization decision and failure response.
4. Add negative UI tests for unauthenticated, disabled USER, wrong department, insufficient VIEW/ENTER/EDIT/MANAGE, expired session, protected ROOTS/DEV and cross-record evidence access.
5. Browser-side button disabled/hidden states are presentation only and must never substitute for broker-side permission evaluation.

## 3. Atomic RPC catalogue

The source code also depends on database-side RPCs. These functions are part of the contract, not optional convenience helpers. A replacement must preserve their atomic state transitions, uniqueness checks, immutable authority constraints, audit effects and failure semantics.

| Service area | Source RPCs |
|---|---|
| Central Bank / identity | `downtime_commit_central_bank`, `downtime_central_commit_identity_event`, `downtime_get_bootstrap_code`, `downtime_identity_reset_preserve_dev` |
| YARD HUB Settings / ROOTS / roles | `downtime_roots_manage_identity`, `yard_hub_save_tier_settings`, `yard_role_assign_user`, `yard_role_reassign_user`, `yard_role_save_definition` |
| GATELOG | `gatelog_assign_gateman`, `gatelog_create_arrival`, `gatelog_create_customer_arrival`, `gatelog_customer_visit_stats`, `gatelog_delete_visit`, `gatelog_lock_gateman`, `gatelog_overall_statistics`, `gatelog_period_statistics`, `gatelog_register_departure`, `gatelog_update_visit` |

**RPC coverage requirement:** each function must have an equivalent transaction implementation and a contract test for valid inputs, invalid inputs, conflicting versions, duplicate operation IDs, denied actor, audit attribution and rollback on partial failure.

## 4. Relational table inventory — 39 tables

Source inventory snapshot: live read-only platform inventory captured in `docs/GITHUB_NATIVE_YARDHUB_TWIN_BLUEPRINT.md`, dated 27 November 2026. All 39 source tables were reported with RLS enabled.

| Domain | Tables |
|---|---|
| DOWNTIME / shared state | `downtime_shared_state`, `downtime_reports`, `downtime_attachments` |
| Central Bank identity and audit | `downtime_central_bank`, `downtime_central_sessions`, `downtime_central_audit` |
| Central configuration | `downtime_central_config_state`, `downtime_central_config_history` |
| ROOTS and identity lifecycle | `downtime_roots_assignments`, `downtime_roots_assignment_audit`, `downtime_roots_bootstrap`, `downtime_roots_role_definitions`, `downtime_identity_reset_runs` |
| YARD ROLE and access | `yard_roles`, `yard_role_department_permissions`, `yard_role_assignments`, `yard_role_assignment_audit`, `yard_role_definition_audit`, `yard_hub_tier_config`, `yard_hub_access_audit` |
| Daily operator | `downtime_daily_operator_assignments`, `downtime_daily_operator_audit` |
| GATELOG | `gatelog_customers`, `gatelog_vehicles`, `gatelog_visits`, `gatelog_waste_types`, `gatelog_visit_waste_types`, `gatelog_audit`, `gatelog_daily_gateman_assignments`, `gatelog_report_archive` |
| R&M | `repair_maintenance_faults`, `repair_maintenance_notes`, `repair_maintenance_attachments`, `repair_maintenance_audit`, `repair_maintenance_machine_presets`, `repair_maintenance_pdf_exports`, `repair_maintenance_assets`, `repair_maintenance_machine_settings`, `repair_maintenance_machine_models` |

## 5. Storage inventory — 5 private buckets

| Bucket | Domain | Required twin handling |
|---|---|---|
| `downtime-evidence` | DOWNTIME evidence | Binary preservation, object metadata, owner/record authorization, checksum and restore |
| `downtime-pdfs` | DOWNTIME reports | Binary preservation, metadata, authorization, checksum and restore |
| `downtime-staff-photos` | STAFF imagery | Private original/derived images, identity linkage, permissions, checksum and restore |
| `repair-maintenance-evidence` | R&M evidence | Fault/asset-scoped evidence, metadata, permission and checksum |
| `repair-maintenance-reports` | R&M PDF reports | Export archive linkage, metadata, permission and checksum |

The table inventory and storage bucket list define the source scope only. Current object counts/bytes are point-in-time estimates from the blueprint, not export evidence. Full binary listing and checksum verification remain open.

## 6. Permission and actor acceptance matrix

Every action must be tested against the actual server-side YARD ROLE decision, not a client-side visibility condition.

| Actor state / authority | Required outcome |
|---|---|
| No authenticated principal | Deny all protected actions; never create a synthetic production session |
| Unknown GitHub actor ID | Deny before reading operational tables or Storage |
| Disabled / archived USER | Deny protected reads and all writes |
| Active USER without module VIEW | Deny module reads and subscriptions |
| Active USER with VIEW only | Read allowed only for that module/record scope; all writes denied |
| Active USER with ENTER | Permit only the module's explicitly classified create/enter action |
| Active USER with EDIT | Permit only scoped update/edit actions; MANAGE actions remain denied |
| Active USER with MANAGE | Permit module management actions only within the assigned module/department |
| ROOTS / immutable DEV authority | Apply only the protected identity/configuration operations defined by source policy; prevent self-escalation and preserve the original DEV safeguard |
| SPECTATOR | Read-only approved snapshot only; all mutations denied |

Permission matrix must cover VIEW, ENTER, EDIT and MANAGE for each module/department assignment. A caller-supplied role, username, actor ID, audit identity, tier or permission flag is not authoritative. Broker identity and permissions must be resolved server-side from the authenticated GitHub event and canonical USER/ROOTS/YARD ROLE records.

## 7. Twin coverage status

| Twin component | Existing evidence | Acceptance status |
|---|---|---|
| GitHub Git Data transaction engine | Mocked tests for revision, compare-and-swap, concurrent branch update and atomic multi-table commits | PARTIAL — real private repository tests missing |
| Browser/table compatibility | Unit tests for select/mutation and a subset of RPC handlers | INCOMPLETE — no RLS/action enforcement; cross-role isolation unproven |
| Seven Edge service bundles | Build/registration/preflight tests | INCOMPLETE — action-level behaviour is unverified |
| Identity and sessions | Runtime compatibility shim only; synthetic session fallback exists | BLOCKED — no trusted multi-user broker identity |
| ROOTS / YARD ROLE | Source inventory and limited handler tests | INCOMPLETE — no canonical broker-enforced VIEW/ENTER/EDIT/MANAGE matrix |
| Binary Storage | Mocked adapter tests and in-memory upload ticket | INCOMPLETE — no production object permissions or private-bucket restore rehearsal |
| Spectator | Handler registration and shared-state read surface | INCOMPLETE — access-code and read-only scope tests needed |
| Backup export | Mock runner tests for table/bucket export, session exclusion, private-repo gate, checksum and authority pause | PARTIAL — no real private-repository export or full restore test |
| Cross-device recovery | Local snapshot restore only | BLOCKED — clean-device discovery and full binary restore are not complete |
| Authority switch | Isolated unit tests and manifest model | BLOCKED — no live replication checkpoint, real reconciliation or rollback rehearsal |

Current existing test files include `tests/github-data-store.test.js`, `tests/github-connection.test.js`, `tests/github-table-client.test.js`, `tests/github-storage-client.test.js`, `tests/github-rpc-handlers.test.js`, `tests/github-edge-runtime.test.js`, `tests/github-supabase-compat.test.js` and `tests/yardhub-backup-bridge.test.js`. Presence of a test file does not imply every source action or permission branch is covered.

## 8. Phase 0 and Phase 4 exit criteria

**Phase 0 remains PARTIAL** until the migration/trigger/policy/RLS/frontend-caller/export census is complete and a full export/restore inventory is checksummed. This document closes the first static endpoint/action/RPC/table/bucket catalogue, not the entire source census.

**Phase 4 remains NOT STARTED** until the trusted broker is proven. After Phase 3, port actions in service order and add a traceable test ID for every action in this matrix. Each test must compare the twin response/state changes with the preserved source contract.

Required evidence per action:
1. exact request schema and response schema;
2. authorised and denied cases across all relevant YARD ROLE states;
3. table/shard changes and audit event comparison;
4. transaction rollback and concurrency behaviour;
5. duplicate/replay handling and stale authority epoch rejection;
6. Storage object upload/read/delete scope and integrity (where applicable);
7. Chromium desktop/mobile user flow and cross-device consistency.

## 9. Protection boundary

The source inventory is derived from the preserved reference snapshot and previously recorded read-only audit. This implementation has not run workflows, commits, exports, tests or other actions against `aka30art/DOWNTIME`. Do not use `aka30art/DOWNTIME` as a test target. Do not use the unrelated `aka30art/DOP-website` repository for broker or data storage. YARDHUB remains primary; no production data has been copied, no authority transfer has occurred, and PR #3 remains open and draft.
