# FiberOS R14.1 — Developer Onboarding Map

This is the shortest safe path into the monorepo. Start from the contract you need to change; do not begin by reading every package.

## Where to start

| Need | Start here | Then inspect |
|---|---|---|
| HTTP/API behavior | `services/api/src` | matching route test + domain package |
| Ticket lifecycle / authority | `packages/domain` | `sql/migrations` authority functions |
| Optical/math behavior | `packages/engineering` | `packages/ftth-measurements`, scientific-validity |
| Field closure | `packages/field-closure`, `services/api/src/routes/fieldClose.js` | evidence + DB authority |
| Dispatch | `packages/domain/src/dispatchEngine.js`, `packages/dispatch` | skills eligibility + authorization |
| Security policy | `packages/security*`, `packages/signing-port` | API auth + DB RLS migrations |
| Localization | `i18n/source.json`, `i18n/catalogs`, `tools/validate-translation.js` | Weblate mirrors + quality gate |
| Deployment | `deploy/*` | runtime gates + migration chain |
| UI/static operations | `apps/field-web/public`, `apps/ops-web/public` | static web contract tests |

## Safe change loop

1. Identify the authoritative layer.
2. Read the nearest test before changing behavior.
3. Keep pure math/data transformations free of I/O.
4. Route all authoritative state transitions through the existing DB/security boundaries.
5. Add or update a focused test before broad verification.
6. Run `npm test` and the narrow gate for the modified subsystem.
7. Regenerate derived manifests/maps rather than hand-editing them.

## Cognitive-load controls added in R14.1 work

`ARCHITECTURE_MAP.json` provides a generated package dependency view.

`scripts/verify-architecture-boundaries.js` rejects package-to-service/app imports and service-to-app imports.

`docs/ARCHITECTURE_MAP.md` defines the intended layers and the compute boundary.

The goal is not to make the monorepo smaller by deleting intentional mirrors. The goal is to make the dependency rules explicit and machine-checkable so the tree can remain large without becoming unbounded in coupling.
