# i18n commercial priority

Policy: `i18n/QUALITY_POLICY.json` (`verifiedStatusOnly` for activation).

## Buyer demo priority

1. **en / source** — canonical engineering copy  
2. **ar** — default locale in quality policy  
3. Other locales stay machine-draft until human verification (Weblate / `i18n/` pipeline)

Never mark a catalog `verified` without human review.  
Gate: `npm run verify:i18n:quality`.
