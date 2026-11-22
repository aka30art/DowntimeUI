# DOWNTIMEUI — Multi-tenant backend and security specification

**Status:** architecture specification only. No Supabase project is linked, modified or deployed by this document.

## 1. Isolation boundary

DOWNTIMEUI is a multi-tenant product. Every installed organisation is a distinct tenant. A user can belong to more than one tenant, with a separate membership and role in each. Every tenant-owned database row, file path, report and realtime message is scoped by tenant_id.

The existing aka30art/DOWNTIME project and its DOWNTIME-staging project are not DOWNTIMEUI backends. Do not reuse either project, its tables, credentials, authentication users, secrets, storage buckets or operational data.

A dedicated DOWNTIMEUI development Supabase project must be provisioned and explicitly identified before live backend integration can be verified. No new paid resource should be created without a cost/plan check and approval.

## 2. Authentication and authorisation

- Use Supabase Auth as the identity provider. The browser receives only a publishable key and the authenticated user's session.
- Keep the service-role/secret key in server-side function secrets only. It must never enter index.html, browser bundles, storage, logs or test fixtures.
- Resolve tenant access through tenant_memberships using the verified auth.uid() identity. Do not authorise from user-editable user_metadata.
- A user may access only tenants with an active membership. Tenant selection is not proof of membership.
- Each membership points to one tenant-scoped role. Permissions are stored in the tenant's role records and checked server-side as well as in RLS.
- Provide standard role templates as editable starting points (Owner, Admin, Manager, Supervisor, User and Spectator). Custom roles and fine-grained permissions are tenant-owned.
- Owner transfer, last-owner protection, member invitation, revocation, disablement and session termination require explicit transactional rules.
- STAFF/operator roster profiles are separate from Auth accounts. A staff record can exist without login access; linking a staff record to an Auth user is optional.

## 3. Proposed relational data model

All public-schema tables below must have RLS enabled before any browser/API access is granted.

| Table | Scope and purpose |
|---|---|
| tenants | Organisation identity, install state, schema version and tenant-level version |
| tenant_memberships | Tenant/user relationship, assigned role, status and invitation lifecycle |
| tenant_roles | Tenant-defined role name, system-role marker and explicit permission JSON |
| sites | Site identity, timezone, locale, hierarchy labels and schedule policy |
| areas | Site areas / departments |
| stations | Station/line/machine definitions and area relationship |
| downtime_reasons | Tenant-managed reason catalogue |
| shift_templates | Reusable shifts and break windows |
| staff_profiles | Operator roster, optional linked Auth user, profile and private photo path |
| daily_task_templates | Reusable task definitions and ordering |
| operation_days | Per-site operating date, shift snapshot and operational lock state |
| downtime_entries | Per-day downtime records, station/area/reason references, duration, notes and audit metadata |
| daily_task_days | Per-site/day task snapshot, completed task IDs, lock timestamp and locking member |
| weekly_report_snapshots | Immutable report payload, calculated totals, generated-by and archive metadata |
| tenant_audit_events | Append-only actor/action/target history |
| tenant_versions | Compare-and-swap version per tenant/site data stream |
| setup_drafts | Resumable setup progress before tenant activation |

Use UUID primary keys, foreign keys that include tenant/site scope where practical, unique constraints for names/keys within their parent scope, check constraints for valid durations and states, and indexes beginning with tenant_id on common access paths.

Avoid storing the entire operational business model in one mutable JSON blob. JSONB is appropriate for versioned configuration snapshots, report snapshots and task snapshots; frequently queried entities and access-controlled records should remain relational.

## 4. Database security and RLS

- Enable RLS on every exposed table, including configuration, membership, operational records, snapshots, audit events and storage.objects policies.
- Default to no access. Add only the required TO authenticated policies and explicit predicates for membership, tenant scope and action permission.
- Do not grant anon access to tenant tables or private storage.
- Validate tenant_id against an active membership for every read/write; never trust a tenant ID supplied by the client on its own.
- Use a non-exposed private schema for narrowly scoped helper functions where necessary. Any privileged function must use a fixed safe search path, fully qualified relation names, verify auth.uid(), and revoke execute from PUBLIC and anon.
- Do not use the service-role key as a shortcut around policy design. If a server-side function uses it for provisioning, it must verify the caller and validate every tenant/member/role transition before the privileged transaction.
- Use WITH CHECK on updates and inserts to stop tenant ID, owner, author or relationship reassignment.
- Test direct PostgREST requests as well as application workflows. Hiding a UI control is not a security policy.

## 5. Tenant installation transaction

1. Authenticate the initial installer as a verified Auth user.
2. Validate company/site identity and the complete configuration payload server-side.
3. Create the tenant, its first site, default editable role templates, initial Owner membership, areas, stations, reasons, schedule, staff profiles and task templates in one transaction.
4. Assign a new installation UUID and schema version.
5. Mark the tenant installed only after every required row succeeds.
6. Return a tenant-safe configuration payload with no secret fields.
7. Use an idempotency key to prevent duplicate tenants/memberships when the client retries.
8. Save resumable pre-install progress in setup_drafts with expiry and owner binding. Drafts must not be visible to another user or tenant.

An interrupted transaction must not leave a half-installed active tenant. The client must be able to resume or safely retry.

## 6. Operational persistence and concurrency

- Daily operations are keyed by site and local operating date in the site's IANA timezone.
- Downtime duration is stored as integer minutes. Server validation rejects invalid or zero durations and enforces station/area/reason scope.
- Calculate scheduled, break, net, downtime and running minutes from the site's dated schedule. Weekly percentages must be calculated from aggregate weekly minutes, not the arithmetic mean of daily percentages.
- Each save includes an expected data version. The database increments the version atomically. A stale version returns a conflict and must not overwrite newer records.
- Realtime subscriptions are tenant/site scoped and must be authorised. Realtime messages contain state/version hints, not private record payloads.
- Daily Tasks SAVE & LOCK FOR TODAY must atomically snapshot the active task template IDs, names and order, retain completion state, set locked_at/locked_by, and make the day's snapshot immutable. A database trigger must reject later update/delete of a locked snapshot, including attempted service-side edits.
- Weekly report snapshots store the exact calculated payload used at generation time. Later downtime entry edits must not mutate archived reports.
- Audit events include actor, tenant, site, action, target, timestamp and safe details; do not log passwords, tokens or personal secrets.

## 7. Storage and evidence

Use private buckets only. Object paths must start with the tenant UUID and then a resource namespace, for example <tenant_id>/staff/<staff_id>/... or <tenant_id>/reports/<report_id>/.... Policies must confirm the caller is a member of the matching tenant and has the appropriate permission. Prefer short-lived signed upload/download URLs. File size, MIME type, ownership and path must be validated server-side.

## 8. Edge Functions

Use Edge Functions for tenant provisioning, member invitations/role changes, secure report generation and other privileged workflows. Each function must:
- verify the Supabase Auth JWT and resolve the caller with auth.getUser();
- validate tenant membership and role on every invocation;
- validate request bodies with strict schemas and size limits;
- explicitly handle CORS preflight and response headers;
- return structured errors (401, 403, 409, 422) without leaking database internals;
- never expose service-role credentials or raw database errors;
- write audit events for privileged changes.

## 9. Acceptance tests before any shared backend release

1. Two independent tenants with overlapping station/reason names cannot read, update, delete or enumerate each other's rows.
2. A user with no membership cannot access a tenant even when its UUID is known.
3. A user belonging to tenant A cannot use tenant A's role in tenant B.
4. Every role/permission combination is tested at the database/API boundary, including read-only and spectator restrictions.
5. Owner transfer and last-owner protection are tested under concurrent requests.
6. Setup retries are idempotent and interrupted install rolls back.
7. Concurrent writes produce one winner and a conflict for stale versions.
8. Locked daily task snapshots cannot be changed through direct SQL/API or privileged application workflows.
9. Archived report snapshots remain unchanged after source record edits/deletes.
10. Storage path traversal, cross-tenant reads, incorrect MIME types and oversized uploads are rejected.
11. Realtime channels do not reveal tenant IDs, operational data or presence across tenants.
12. Backup export, restore, audit retention and account-deletion handling are verified in the dedicated development project.
13. Run Supabase advisors and review all policies, triggers, functions and storage rules before release.

## 10. Current implementation boundary

The current DOWNTIMEUI operational workspace is a single-browser local implementation. Local roles are configuration metadata only; they are not an authentication or authorisation boundary. The application must display this limitation and must not be used as a multi-user production system.

The next backend work must be implemented and tested against a dedicated DOWNTIMEUI development project. It must not be deployed to the existing DOWNTIME production or staging projects. No migration application, edge-function deployment, project creation or production data operation is authorised by this specification.
