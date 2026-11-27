# YARDHUB → Private GitHub Backup Bridge

## Purpose

DOWNTIMEUI includes a one-way, read-only backup bridge from the existing YARDHUB Supabase project to a separate private GitHub data repository. The bridge runs from GitHub Actions every 15 minutes and can also be triggered manually.

It does not change the DOWNTIME repository, the YARDHUB application, Supabase schema, Supabase data, Edge Functions, Storage or production configuration.

## What is backed up

- All 39 public operational tables.
- Central Bank user and staff directory data, role definitions, ROOTS and YARD ROLE assignments, configuration, operational records and audit history.
- All five Storage buckets:
  - `downtime-evidence`
  - `downtime-pdfs`
  - `downtime-staff-photos`
  - `repair-maintenance-evidence`
  - `repair-maintenance-reports`
- A manifest with row counts, object counts, byte totals and Git blob checksums.

Active rows in `downtime_central_sessions` are intentionally excluded. The twin must create its own sessions when users sign in.

## Destination repository

The destination must be a dedicated **private** GitHub repository, separate from both `aka30art/DOWNTIME` and `aka30art/DowntimeUI`. Initialise it with a README so its default branch exists.

The backup tree is written under:

```
replication/yardhub-primary/
  manifest.json
  tables/
    <table>.json
  storage/
    <bucket>/<object-path>
  storage-metadata/
    <bucket>/<object-path>.json
```

The bridge uses Git's compare-and-swap ref update. If another writer advances the branch during a backup, it rereads the latest head and retries rather than force-pushing over that work. Unchanged table/object files are skipped. Removed source objects are removed from the mirror tree in the same backup commit.

## GitHub Actions secrets

Add these repository secrets to **DOWNTIMEUI → Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | The existing YARDHUB Supabase project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | The project's service-role API key; never commit this value |
| `YARDHUB_DATA_REPOSITORY` | Private destination in `owner/repository` format |
| `YARDHUB_DATA_BRANCH` | Destination branch, normally `main` |
| `YARDHUB_DATA_TOKEN` | Fine-grained token with Contents read/write and Metadata read on the private destination repository |

The service-role key is used only by the scheduled GitHub Action to perform read-only REST and Storage requests. The backup script does not send SQL writes or Storage mutations to Supabase.

## First backup

1. Create and initialise the dedicated private data repository.
2. Add the five GitHub Actions secrets above.
3. Merge and deploy the DOWNTIMEUI backup bridge when its PR has passed the complete validation gate.
4. Open GitHub Actions → **YARDHUB GitHub Backup** → **Run workflow**.
5. Verify the resulting commit and `replication/yardhub-primary/manifest.json` in the private data repository.

The scheduled run then repeats every 15 minutes. If Supabase becomes paused or unavailable, the action fails without deleting or replacing the last successful backup.

## Important scope boundary

This is a one-way YARDHUB → GitHub backup. It does not make the unchanged YARDHUB application write to GitHub. DOWNTIMEUI can restore the replicated snapshot and operate independently on GitHub. A true two-way primary switch requires an explicit operational cutover and a tested reconciliation/import process; the GitHub authority manifest alone cannot force the unchanged YARDHUB application to stop accepting Supabase writes.
