# Runbook — Vercel Deployment Proof (production/source parity)

> **Current verification (2026-10-19; supersedes the historical 2026-10-18 record below).** Do not use the older domain, project ID, or commit listed in the historical section as current production evidence.

## Current verified Vercel deployment

- GitHub source of truth: `mohamedsamir113377-bit/GPON-Orchestrator`, branch `main`.
- Current deployed main SHA: `55c7679f92d4fbc888665ec63ac838752d0f7e69`.
- Vercel project: `gpon-orchestrator`; project ID `prj_72DGqxTIPhMxXIEv0LRnnznjDkMV`; team slug `fiber-os`; team ID `team_O9pXfJ9Ic95mc5KdKjLaSnI4`.
- Current production deployment ID `dpl_AXY8biErpUfDHPghzLKrgLMcq19C`; Vercel reports `READY`, target `production`, and matching GitHub repo/ref/SHA.
- Verified public domain: `https://gpon-orchestrator-gold.vercel.app/`.
- The same deployment returned HTTP 200 for `/`, `/ops/`, `/field/`, `/customer/`, `/enterprise-command.html`, `/trust/`, `/robots.txt`, `/sitemap.xml`, and `/fiberos-api-config.js`.
- The served `robots.txt` and `sitemap.xml` now correctly reference `gpon-orchestrator-gold.vercel.app`. GitHub repository homepage metadata now points to that domain.
- Security response headers observed include Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy, and Cross-Origin-Resource-Policy.

## Backend and runtime boundary — still open

- This Vercel project is a **static-site deployment**: `vercel.json` sets `buildCommand: npm run website:build` and `outputDirectory: .netlify/site`. It does not declare Vercel Functions or API rewrites.
- The live `fiberos-api-config.js` reports `window.FIBEROS_API_BASE=""`; `FIBEROS_API_BASE` is not present in the project's Vercel environment-variable names. The root `/api/health` returns HTTP 404. This is a real backend wiring gap, not a passing API health check.
- The API source is a long-running Node HTTP server at `services/api/src/server.js`, with `/health` (not `/api/health`) as its health path. Runtime containers are described by `docker/Dockerfile.runtime`; the production checklist requires separately operated API/worker/AI/GIS services. Do not point `FIBEROS_API_BASE` at the static site or broaden CSP to `https:`/`*` as a workaround.
- Neon project `long-cloud-39180195`, database `neondb`, main branch `br-crimson-haze-b7gode2a`, was read-only inspected on 2026-10-19. PostgreSQL is `18.6`; the public application schema is empty (0 public base tables), no `fiberos_migration_history` exists, no `fiberos_*` application roles exist, and `postgis`/`pgcrypto` are available but not installed on main. A separate branch `audit-migrations-2026-10-19` was created for testing; its two bootstrap SQL files succeeded, but application migrations were not applied because the subsequent SQL action was blocked by safety checks. The test branch has 0 recorded application migrations. CI's PostgreSQL/PostGIS/RLS workflow uses an ephemeral CI database and is not proof of a live Neon migration.
- GitHub check `Supabase Preview` still appears from the Supabase GitHub App for the older project ref `vxrqd...`. A read-only repository webhook inventory returned no hooks; the stale third-party check has not been disabled or treated as evidence of current Neon connectivity.
- GitHub reports the private repository's branch-protection/ruleset endpoints are unavailable on the current plan (`403`, upgrade or make the repo public). `main` remains unprotected; do not make the private repository public as a workaround.
- `PRODUCTION_HOLD=true` remains the intended fail-closed posture. This document does not certify production API/DB readiness or release the hold.

## Current CI evidence on the deployed SHA

The exact current main SHA above had successful GitHub checks for `verify`, the PostgreSQL 18.6 / PostGIS 3.6 migration and RLS gate (ephemeral CI), `Final release admission`, runtime image security checks for API/worker/AI/GIS, source hygiene, website build, visual regression, and truth check. The Supabase Preview check is a separate third-party check and is not used as a Neon or backend readiness signal.

Historical deployment record from 2026-10-18 follows for audit history only; all current-state claims above take precedence.

---


Purpose: turn "Vercel link and deployment undecided" into recorded proof that the
live production URL serves the exact `main` head.

## Historical record — superseded (read-only API, 2026-10-18)

- Project `gpon-orchestrator` exists: id `prj_gJHBLhMsEmSkRWqFFoFEHWQd8axc`, team
  `fiber-os1` (`team_qarz5ArZSx5VS7vKSSqzqDGU`), Node 24.x, `vercel.json` headers applied.
- Git link: **none** — project reports zero linked Git projects; deployment history not
  readable with the scoped token. Therefore production parity is UNPROVEN.
- Target source of truth: `main` head `aef4f50dab3440bf47f00c72a802859874f964aa`
  (all release gates green, run 39076331902).

## Closure steps (owner)

1. Install/authorize the Vercel GitHub App for account `mohamedsamir113377-bit` with
   access to `GPON-Orchestrator` (the repository was transferred/renamed, so re-grant access).
2. Project → Settings → Git → connect `mohamedsamir113377-bit/GPON-Orchestrator`,
   production branch `main`.
   API equivalent: `PATCH /v9/projects/prj_gJHBLhMsEmSkRWqFFoFEHWQd8axc` with
   `{"link":{"type":"github","repo":"mohamedsamir113377-bit/GPON-Orchestrator",
   "repoId":1411730152,"productionBranch":"main"}}`.
3. Trigger production deployment of `main@aef4f50dab3440bf47f00c72a802859874f964aa`
   (Redeploy on that commit, or API `POST /v13/deployments` with `gitSource`).
4. Verify: deployment `status === "READY"`, `meta.githubCommitSha` starts with
   `aef4f50`, and deployment `target === "production"`.
5. Smoke-test on the live URL: `/`, `/ops/`, `/field/`, `/customer/` respond 200 with
   `no-store` per `vercel.json`; no mixed content; no secret-bearing config exposed.
6. Record deployment URL + commit SHA + timestamp in `FINAL_VERIFICATION_STATUS.md`
   and only then move the commercial decision out of HOLD.

## Historical live evidence (2026-10-18; superseded)

- Git linkage: project `gpon-orchestrator` is linked to `mohamedsamir113377-bit/GPON-Orchestrator`
  (deployments carry `githubCommitSha`; pushes to `main` reach Vercel).
- Production deployments `READY` at `target === "production"`:
  - `dpl_6ZRqMEYo56` at commit `aef4f50dab3440bf47f00c72a802859874f964aa`
  - `dpl_5ckjsvHoQ6` at commit `7f1f5645c4c24b2392bbad67b9cc4885bc9d4655` (closeout merge)
- Production alias `https://gpon-orchestrator.vercel.app` smoke test: `/`, `/ops/`,
  `/field/`, `/customer/` all HTTP 200.
- Rule: every new commit on `main` needs a fresh READY deployment (Git link is live, so
  pushes auto-deploy); parity claim must always cite the exact deployment id + SHA.

## Definition of done

- [x] Git link shows the exact repository and branch (deployments carry githubCommitSha)
- [x] READY production deployments at `aef4f50dab3440bf47f00c72a802859874f964aa` and `7f1f5645c4c24b2392bbad67b9cc4885bc9d4655`
- [x] Smoke tests pass on the production domain (all four surfaces HTTP 200)
- [x] Evidence recorded in this runbook; final-head deployment is re-verified on every push
