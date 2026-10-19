# Calibrated Likelihood Pack Guide

**Status:** Structure ready. Production numbers must come from the buyer’s operational history.

## How to replace the example pack

1. Export historical OTDR events with confirmed root cause labels.
2. Estimate priors P(H) per fault class for your network.
3. Estimate likelihoods P(E|H) for measurement bins (loss dB, reflectance dB).
4. Implement `buildEvidenceLikelihoods(observation)` to return those calibrated tables.
5. Version the pack (`packId`, `version`) and store under tenant config.
6. Call `POST /v1/engineering/calibrated-diagnosis` with `{ pack, observation }` or register the pack server-side.

## Rules
- Never ship the example pack as production truth (`EXAMPLE_PACK_NOT_FOR_PRODUCTION_WITHOUT_CALIBRATION`).
- Output remains `advisory: true` — operator confirms any work order.
- Document the dataset window and sample size with the pack version.

---
*Guide 2026-09-17*
