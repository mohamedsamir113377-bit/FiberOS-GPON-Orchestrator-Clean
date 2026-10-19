# FiberOS R14.1 — Buyer Evaluation Mode (30 days)

This release adds an **opt-in buyer evaluation mode** to the existing web consoles.

## Activation

Open:

- `/evaluation.html`
- `/ops/?mode=evaluation`
- `/ops/enterprise-command.html?mode=evaluation`
- `/field/?mode=evaluation`

## What it does

Evaluation Mode intercepts the web console's known API calls **only in evaluation mode** and returns deterministic local demonstration fixtures. This allows a buyer to exercise the existing UI flows without requiring the seller to provision PostgreSQL/PostGIS, Redis, OIDC/JWKS, PSTN, NMS/OTDR, object storage or other external production systems before initial review.

State-changing demonstration actions are kept in browser memory for the current tab/session. They are not presented as production writes.

## Truth boundary

Every evaluation response is marked with `evaluationMode: true`, `demo: true` where applicable, and `syntheticData: true` for the operational overview/health surfaces. Production mode is unchanged and continues to use the configured live API/runtime path.

The field closure workflow explicitly reports `persisted: false` and states that no production ticket was closed.

## 30-day window

The browser records the first evaluation-mode access in local storage and exposes a 30-day convenience window. After the window, demo API calls return `410 EVALUATION_WINDOW_EXPIRED`.

This is intentionally **not** a license-security boundary. A buyer-side browser can clear storage or otherwise alter client state. Production licensing/entitlement enforcement must remain server-side in the sold deployment.

## Validation performed

- Evaluation API smoke tests: 3/3 passing.
- Existing repository JavaScript syntax gate: passing.
- Existing live/production path is not modified by the evaluation interceptor unless `mode=evaluation` is explicitly selected.
