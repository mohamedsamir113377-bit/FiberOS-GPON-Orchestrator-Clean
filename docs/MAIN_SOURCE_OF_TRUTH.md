# Main = sellable product source

## Rule

`main` holds **unique product source** intended for commercial delivery and runtime:

- `apps/`, `services/`, `packages/`, `sql/migrations/`, `config/` (runtime contracts)
- Root packaging: `package.json`, lockfile, `vercel.json`, Docker sales compose as applicable

## Not the primary job of `main`

Long-form audit narratives, experimental cleanup, and divergent review-only work live on named branches (`docs/*`, `review/*`, `cleanup/*`, `fix/*`) until promoted by PR after green checks.

## Neon / Vercel

- SQL migrations on `main` must match what production may apply; apply only after non-prod validation when risk is high.
- Vercel production deploys from `main` SHA.
