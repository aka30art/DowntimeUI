# YARDHUB source migration inventory and schema drift register

**Audit date:** 27 November 2026  
**Immutable source reference:** `aka30art/DOWNTIME` main tree `ba99913d1eaff7d99785088fd0931b3815defd4c`  
**Target:** `aka30art/DowntimeUI`, PR #3, branch `architecture/github-native-yardhub-twin`  
**Method:** read-only Git tree and selected SQL-file inspection. No workflow, branch update, data export, SQL execution, migration or write operation was performed against the source repository or its Supabase project.

## 1. Inventory result

| Item | Observed result |
|---|---:|
| Files in pinned source Git tree | 193 |
| Files under `supabase/migrations/*.sql` | 45 |
| Additional SQL files under `supabase/` | 2 |
| Total SQL files in source tree | 47 |
| Applied migrations in the previously recorded live Supabase inventory | 49 |
| Difference requiring reconciliation | 4 |

The 49 applied-migration count and the live latest applied migration (`20261127095422_canonical_user_session_tier_nullable`) were recorded in the Phase 0 live inventory in `GITHUB_NATIVE_YARDHUB_TWIN_BLUEPRINT.md`. The pinned source Git tree contains 45 migration files, and its latest timestamped migration is `20261127110000_canonical_user_session_tier_nullable.sql`.

These two observations do not identify which four migration records lack matching files, nor whether the latest source migration is unapplied, supersedes the live migration, or has a different definition. This must be resolved by comparing the complete Supabase migration history to the complete source migration directory and hashing the SQL definitions. Do not infer equivalence from similar migration names.

## 2. Complete migration file inventory

The file paths and Git blob SHAs below are pinned to tree `ba99913d1eaff7d99785088fd0931b3815defd4c`. They provide a stable source identity for later migration-to-contract mapping.

| # | Migration file | Source blob SHA |
|---:|---|---|
| 1 | `20261119032429_spectator_read_only_state.sql` | `82a72497e4cf630de324cdf4b553e3c8d51aa177` |
| 2 | `20261119035000_spectator_access_via_secure_edge_function.sql` | `996974d65b2e0426f08f6e0049b40cae39fb322a` |
| 3 | `20261120000001_simple_central_data_bank.sql` | `f6f399f38fd10498510e28cf4f02f71530425176` |
| 4 | `20261120000002_central_auth_and_audit.sql` | `d02c5587875d60760263f249d37b3b6eb7ed4f41` |
| 5 | `20261120010000_photo_evidence.sql` | `0cf8bac6e71e3f39a86ccbfa4d7325e43b372cf7` |
| 6 | `20261120070000_photo_attachment_service_role_grants.sql` | `02e823405bad3a25f9699a4f61eef485bd7fa63b` |
| 7 | `20261121020000_secure_bootstrap_and_staff_photo_limits.sql` | `48afe7a4605caf437118543b9c42b8f17ecef354` |
| 8 | `20261121050415_central_state_realtime_broadcast.sql` | `248b95ab22a6711337309fb402060dce9e35f8ee` |
| 9 | `20261122060000_central_configuration_control_plane.sql` | `297db0e5ad172870c47da4e5da943b95697f21ac` |
| 10 | `20261123195000_repair_maintenance_module.sql` | `cf71e55f29bdc79deec995c5476c1579492fbf36` |
| 11 | `20261123212500_yard_hub_access_control.sql` | `1b2febe403374b14f19be152b6e65f9c8c8c2d3c` |
| 12 | `20261124000000_rm_mechanic_machine_presets.sql` | `0c14c45ced77616a9e8e2e705a99dfb192c16250` |
| 13 | `20261124110000_rm_machine_model_catalog.sql` | `f586a53f4e1637e1de50eb4ba421cf2793e83b98` |
| 14 | `20261124190000_dev_master_configuration_navigation.sql` | `4e011b958533c584ffa202e65fa0071cff670426` |
| 15 | `20261124210000_rm_pdf_export_archive.sql` | `d28513f4067da030757edf5a91d28ccdfa8ae8b2` |
| 16 | `20261124220000_rm_fault_update_status_contract.sql` | `d3b6b76dcdba66d6fee6945f2facc65ef8fd629e` |
| 17 | `20261124230000_rm_machinery_registry.sql` | `3d15ea29049b953391183e7028880dac0a30db99` |
| 18 | `20261124240000_rm_machinery_fault_asset_fk_index.sql` | `b11a3c3bf9b5320abc51d33bb360329a5f26954d` |
| 19 | `20261124250000_rm_asset_selector_visibility.sql` | `975a9506795519ab2f4a9213d937da37bdf38b54` |
| 20 | `20261125000000_rm_model_catalogue_machine_register.sql` | `d92cd5ab0f13deff9cbca051b7d0cdd4445e1eee` |
| 21 | `20261125010000_daily_operator_register.sql` | `749384ed2c937ff491934ec4e2d33dbbdf48e72e` |
| 22 | `20261125180000_gatelog_customer_site_entry.sql` | `546ad5933136bc416fd73c85017c82f303376311` |
| 23 | `20261125190000_gatelog_atomic_actions_and_menu_seed.sql` | `1059470e2566f3cf701d979461ed3dbc836e2129` |
| 24 | `20261125193000_gatelog_foreign_key_indexes.sql` | `bcf84f74a3715682627e1bd46cfc6f6ae039ec23` |
| 25 | `20261125200000_gatelog_customer_arrival_and_stats.sql` | `78eb6be05ae024670c64191bc4e2ddebaf57bf26` |
| 26 | `20261126000000_rm_registration_field_setting.sql` | `4a762557c9eab1f120d119b0829f241100d3590c` |
| 27 | `20261126100000_gatelog_period_statistics.sql` | `0063abb2f63fe57831a36787365c94b8f51675bc` |
| 28 | `20261126110000_gatelog_daily_gateman_assignments.sql` | `1c396eb166da0fec4f85bfb30821247006c35af5` |
| 29 | `20261126114151_central_bank_atomic_state_audit.sql` | `628d06b229bfeea6b35ffae09fc3bf86b455c985` |
| 30 | `20261126120000_gatelog_gateman_atomic_actions.sql` | `54f53ab0154c4bc3ddb8a69e0695c1151693eac8` |
| 31 | `20261126140000_gatelog_visit_manage_actions.sql` | `2e75d8efbdaaa90f3e748302f394694bdae2ab5d` |
| 32 | `20261126150000_gatelog_report_archive.sql` | `83bac1c609e8fa33599b3789d2ca4d60e3b1c8cc` |
| 33 | `20261126151000_gatelog_waste_type_activation.sql` | `a9cf509b39b35cdc39fa5083393a376459af7559` |
| 34 | `20261126190000_photo_evidence_record_scope.sql` | `e9f22c70e5701effae2b2c6b540680aac5f8e956` |
| 35 | `20261126233000_canonical_yard_role_registry.sql` | `839ad8438388548cd8ff407f28d527a497ef0a07` |
| 36 | `20261127011000_protected_roots_assignments.sql` | `42fd3e9d55325743dff9498e87819972ddfddfa2` |
| 37 | `20261127030000_yard_role_definition_management.sql` | `328dd1158193b90f43de1b457952e4d0fe2b4d` |
| 38 | `20261127040000_yard_role_assignment_reassignment.sql` | `c77fdc001f1973ae464f0380946677ed81d0fc90` |
| 39 | `20261127050000_roots_bootstrap_and_lifecycle.sql` | `87efc7d340d297dba1e4f6b0893a786e1a1fe895` |
| 40 | `20261127060000_complete_identity_reset.sql` | `6b623ae92bf839b4bc40573a91d7a2284cb93f26` |
| 41 | `20261127061000_yard_role_access_levels.sql` | `7f86f876694255d8216815f75c55f9d9be058fcf` |
| 42 | `20261127062000_revoke_audit_trigger_function_execute.sql` | `5e05aa1b060bd670bb38fb888956e3d776a880d3` |
| 43 | `20261127100000_preserve_dev_identity_and_rooted_roles.sql` | `85dea01beabb3aa206e569632274df585e8f7727` |
| 44 | `20261127100001_disable_legacy_identity_reset_rpc.sql` | `a1ade3946e2beeef493ce697316004703f767ba1` |
| 45 | `20261127110000_canonical_user_session_tier_nullable.sql` | `32804057bc8085621a49af2bc66c1cda6a783e6e` |

## 3. Other SQL files

| File | Source blob SHA | Treatment |
|---|---|---|
| `supabase/schema.sql` | `f83d98982c62a1eaa9d210fd2b6e8441d64e3b9a` | Only defines `downtime_shared_state` and its initial RLS policy; not a complete current schema. |
| `supabase/seeds/repair-maintenance-staging-demo.sql` | `13fe2ec18620941e89a3ebbe8f0568be27cc8244` | Staging/demo seed only. Do not treat it as production data or a production migration. |

## 4. High-impact SQL semantics sampled

The following selected files were read directly at the pinned source tree; their blob SHAs are recorded above.

- `20261123212500_yard_hub_access_control.sql`: creates YARD HUB tier configuration and access audit, with versioned save function.
- `20261126233000_canonical_yard_role_registry.sql`: creates canonical YARD ROLE definitions, department permissions, assignments, assignment audit, and identity-event commit function.
- `20261127011000_protected_roots_assignments.sql`: creates ROOTS assignment and immutable audit structures.
- `20261127030000_yard_role_definition_management.sql`: creates immutable YARD ROLE definition audit and role-save function.
- `20261127040000_yard_role_assignment_reassignment.sql`: implements version-checked role reassignment.
- `20261127050000_roots_bootstrap_and_lifecycle.sql`: creates protected ROOTS bootstrap/lifecycle functions and service-role-only access to the bootstrap record.
- `20261127060000_complete_identity_reset.sql`: implements an atomic identity reset cutover that preserves operational records and ROOTS audit history.
- `20261127061000_yard_role_access_levels.sql`: installs a database trigger that enforces the four hierarchical access levels.
- `20261126190000_photo_evidence_record_scope.sql`: associates evidence with the operational record and enforces the DOWNTIME department scope.
- `20261127062000_revoke_audit_trigger_function_execute.sql`: revokes direct execution of audit trigger functions.

These are not merely DDL table definitions. The source migration sequence encodes immutable audit behaviour, protected ROOTS lifecycle, owner-created roles, version-checked assignment, atomic identity reset and database-boundary permission constraints. The twin must reproduce their externally observable behavior and deny paths; copying table shapes alone is insufficient.

## 5. Open source-drift and acceptance items

1. Reconcile the live 49-row migration history with the 45 tracked migration files at the exact pinned source tree. Identify all four unmatched applied migration versions and all tracked-but-unapplied versions.
2. Resolve the differing canonical USER/session migration timestamps:
   - live inventory: `20261127095422_canonical_user_session_tier_nullable`;
   - pinned Git tree: `20261127110000_canonical_user_session_tier_nullable.sql`.
   Compare the actual SQL contents and application status; do not assume identical semantics.
3. Export the current schema, policies, grants, triggers, indexes, RPC signatures/bodies and foreign keys into a versioned source contract. `supabase/schema.sql` is not sufficient.
4. Map every SQL migration statement to the corresponding table, action, RPC and permission test in `GITHUB_NATIVE_SERVICE_PARITY_MATRIX.md`.
5. Build a migration replay fixture in an isolated test database or deterministic SQL contract harness. Do not execute migrations against the primary.
6. Complete full object listing and checksums for all five private buckets as a separate backup acceptance task.

## 6. Phase impact

- **Phase 0 remains PARTIAL.** The tracked migration file inventory and hashes are now pinned, but the 49-vs-45 discrepancy, applied version mapping, complete SQL dependency semantics and full live export are unresolved.
- **Phase 4 remains NOT STARTED.** No action may be marked parity-complete from this inventory alone.
- **No operational data has been copied. No YARDHUB authority has been changed. PR #3 remains open and draft.**

## 7. Protection boundary

All operations used to create this inventory were read-only GitHub GET operations against the pinned source tree. No commit, branch, pull request, workflow, deployment, Supabase operation, SQL execution, credential operation or data export was performed against `aka30art/DOWNTIME`. All new documentation is confined to `aka30art/DowntimeUI`.
