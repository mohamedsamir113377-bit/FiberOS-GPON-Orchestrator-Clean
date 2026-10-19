# FiberOS Application Authorization Boundary

## Status

`packages/security/src/authorization.js` is the canonical application authorization model and is now actively used by `services/api/src/authorizationMiddleware.js` on protected HTTP paths.

The middleware performs a fail-closed **application-role admission** check: the authenticated principal must carry a recognized application role with a non-empty canonical permission set. Fine-grained resource/action authorization is intentionally not duplicated here when ownership, tenant scope, lifecycle state, or database authority is already enforced by the route handler and PostgreSQL/RLS layer.

## What the canonical module provides

The module defines role-to-permission mappings and exposes:

- `hasPermission(principal, permission)`
- `authorize(principal, resource, action)`
- `authorizeSelf(principal, resource, action)`
- `hasAnyRole(principal, roles)`
- `permissionsForRole(role)`

`authorize()` evaluates generic, `:any`, `:tenant`, and `:team` permissions. It does not grant `:self`. `authorizeSelf()` only checks explicit self permission; the caller must still verify resource ownership.

## HTTP enforcement order

Protected requests traverse the following layers in order:

1. HTTP security headers / CORS / firewall / framing / abuse boundary;
2. verified principal acquisition;
3. `authorizationMiddleware.js` canonical application-role admission;
4. production runtime/database gate;
5. route-specific authorization, ownership, tenant checks, and PostgreSQL/RLS authority.

## Explicit exceptions

The following remain outside the role-admission middleware by design:

- `/health`
- `/v1/meta`
- `/v1/lifecycle/self-test`
- provider IVR webhook `/v1/call-center/ivr/inbound`, which has its own provider-specific authentication boundary inside the route handler
- `/v1/customer/tickets`, which remains principal/tenant-handler scoped because the canonical role model does not define a dedicated customer role.

## Buyer integration boundary

Buyers may add tighter route-to-permission mappings, but those mappings must preserve the handler/DB source of truth and include regression tests for every affected route. The presence of this middleware does not certify the buyer's live tenant isolation, OIDC provider, TLS, rate limiting, backups, or other external infrastructure.
