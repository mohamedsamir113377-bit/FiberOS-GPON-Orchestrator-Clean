# GitHub security hardening (repository settings)

The sales-core tree ships Dependabot config at `.github/dependabot.yml`.
Some GitHub Advanced Security features depend on the **owner plan** and UI toggles.

## Enable on github.com (owner)

1. **Settings → Code security and analysis**
2. Enable where available:
   - Dependency graph
   - Dependabot alerts
   - Dependabot security updates
   - Secret scanning (and push protection if offered)
   - Code scanning (optional CodeQL)
3. **Branches → main → Add rule** (requires plan support on private repos):
   - Require status checks: `Final release admission` (and/or `Source verification / verify`)
   - Prevent force push

## Tokens

- Never commit PATs; never paste them into tickets or chat logs.
- Prefer fine-scoped tokens; rotate if exposed.
- Netlify: grant the GitHub App access to this **private** repository under the App’s **Repository access** list.

## Stale branches

Operational branches such as one-off `setup/*` initialization branches should be deleted after merge to keep `main` the only long-lived line.
