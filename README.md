# DowntimeUI

Isolated visual development and review environment for DOWNTIME.

## Safety boundary
- Standalone static UI only; mock data only.
- No production database, API, auth, PIN, or central sync connection.
- No production secrets or credentials.
- Changes here are design prototypes and must not be integrated into production until explicitly authorized with **DEPLOY ON MAIN APP**.

## Preview
GitHub Pages deployment is configured through Actions. In repository Settings → Pages, select **GitHub Actions** as the build/deployment source.

## Workflow
Prototype → Preview deployment → Visual review/refinement → Acceptance → Explicit production authorization → Separate integration work.
