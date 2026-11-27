# DOWNTIMEUI YARDHUB Runtime — Porting Worktree

This is the working copy of the YARDHUB runtime copied from `yardhub/reference/`.

It is isolated inside `aka30art/DowntimeUI`. It is not linked to the DOWNTIMEUI app entry point and is not deployed.

**Do not run or deploy this worktree yet:** the initial copy still contains Supabase endpoints. The task here is to replace those integrations with the GitHub-native data adapter, then port/verify module by module before any route is enabled.

The untouched source baseline is retained in `yardhub/reference/`.
