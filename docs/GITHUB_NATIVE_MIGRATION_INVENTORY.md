# YARDHUB reference inventory — no data migration

**Updated:** 28 November 2026  
**Target:** `aka30art/DowntimeUI`, PR #3

## Purpose

This document records the historical source-code inventory used to preserve YARDHUB module behaviour. It is not an instruction or approval to migrate data, schemas, users, staff, settings or files from the original application.

## Locked decision

The GitHub-native twin starts as a completely empty installation. The user will manually create DEV ROOT and all subsequent users, staff, roles, presets, machinery, customers and operational records.

No production database export, Supabase backup, scheduled replication, migration workflow, or transfer of records from MAIN is part of the selected architecture. The original YARDHUB reference source is retained only to compare interface and functional parity.

## Protected boundary

The `aka30art/DOWNTIME` repository and its production services are outside the implementation scope. Do not read, write, configure, export, migrate or deploy against that repository as part of this work.

## Runtime data destination

The twin uses one separately provisioned private GitHub repository. The browser connects directly with a fine-grained token restricted to that repository. The app creates its own empty schema on first connection. Git history and the app's JSON backup/restore feature provide recovery for data created inside the twin.

## Current state

- Source UI and seven service entrypoints are retained under `yardhub/reference/` for parity comparison.
- GitHub-native service bundles and local data adapters are implemented.
- The 39 operational/configuration table definitions are initialized empty.
- No source operational data is copied.
- Real private-repository and two-device tests remain outstanding until a dedicated private repository and app token are configured.
