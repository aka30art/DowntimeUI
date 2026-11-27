# DOWNTIMEUI YARDHUB Runtime — Porting Worktree

This is the working copy of the YARDHUB runtime copied from `yardhub/reference/`.

It is isolated inside `aka30art/DowntimeUI`. It is not linked to the DOWNTIMEUI app entry point and is not deployed.

**Do not run or deploy this worktree yet:** the initial copy still contains Supabase endpoints. The task here is to replace those integrations with the GitHub-native data adapter, then port/verify module by module before any route is enabled.

The untouched source baseline is retained in `yardhub/reference/`.


## Runtime activation gate

`index.html` in this working tree is intentionally a safe activation interstitial. It does not load the original application or call Supabase. The original full UI is preserved in `yardhub/reference/index.html`. Replace this interstitial only after the GitHub-native action adapters, module storage and parity tests are complete.


## Current GitHub-native service harness

The porting branch now includes a tested experimental compatibility harness:
- Seven preserved YARDHUB Edge Function entrypoints are bundled by `npm run build:yardhub`.
- The local runtime adapter routes existing `/functions/v1/*` calls to those bundled handlers.
- GitHub table, binary storage and RPC adapters provide the service compatibility layer.
- Tests currently verify service registration, local CORS routing, runtime teardown and the shared database adapters.

This is a build/test harness only. It is not a secure deployed backend and does not yet prove parity of every service action or a production authorization boundary. The original app is still not activated from this directory.

## Data security

- The DOWNTIMEUI source repository is public. Its `data/yardhub` branch is metadata-only and must remain free of operational records.
- The DOWNTIME repository is protected and blocked as a data-store destination.
- A dedicated private data repository is required before any operational record is stored.
- The browser-direct connector is only an administrator prototype. Its token is memory-only, but a connected user can still read or alter all data in that private repository outside YARD ROLE restrictions.
- Do not use this worktree for live operations until a server-enforced multi-user authorization gateway and recovery tests are complete.
