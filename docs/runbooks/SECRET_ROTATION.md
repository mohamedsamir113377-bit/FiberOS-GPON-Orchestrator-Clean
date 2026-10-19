# Secret rotation (do first, today)
The GitHub, Vercel and Neon tokens were pasted in plain text in a chat. Treat all three as compromised.

1. **GitHub**: Settings > Developer settings > Tokens > delete the exposed token. Create a new fine-grained token limited to this repo.
2. **Vercel**: Account Settings > Tokens > delete the exposed token, create a new one scoped to the team/project.
3. **Neon**: Account settings > API keys > revoke, create new. Also reset DB role passwords and update `DATABASE_URL` in Vercel env vars, then redeploy.
4. Store new values only in Vercel env vars / GitHub Actions secrets. Never in chat, code, or markdown.
5. Review GitHub secret scanning, and Vercel/Neon audit logs for unfamiliar activity since the exposure.
6. Add `gitleaks` to CI so a committed secret fails the build.
7. Record the rotation date (never the values) in the closing evidence.

## Present limitation (verified 2026-10-13)
Branch protection for `main` cannot be enabled while this repository is **private on a free plan**:
`GET /repos/codespine78-web/FiberNexus-1/branches/main/protection` returns HTTP 403
("Upgrade to GitHub Pro or make this repository public to enable this feature.").
`scripts/protect-main.sh` therefore only works after the repo is made public or moved to a paid plan.
