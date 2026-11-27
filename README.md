# DOWNTIMEUI GitHub Data Branch

This branch is a data-only Git tree for the GitHub-native YARDHUB twin.

- Application source and GitHub Pages deployment remain on `main`.
- DOWNTIMEUI feature development remains on its application branches.
- Runtime records are written as versioned JSON state/event shards by the GitHub storage adapter.
- This branch is not a backup of the primary DOWNTIME repository and contains no imported production records at initialization.

Do not merge this branch into `main`. The GitHub-native twin reads/writes it as its independent data store.
