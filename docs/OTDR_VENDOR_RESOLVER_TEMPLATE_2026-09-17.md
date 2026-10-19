# OTDR Vendor Resolver Registration Template

**Standards**
- Binary `.SOR` structure: **Telcordia SR-4731 / Bellcore** (Map block → named blocks).
- **ITU-T G.988** = OMCI (ONU management). Not used for `.SOR` parsing.

## How to register a real vendor (when you have the layout)

```js
const { registerVendorResolver } = require('../packages/adapters/src/global/otdrVendorRegistry');

registerVendorResolver('EXFO', (scanResult, buffer) => {
  // ONLY after you have the real per-revision byte table from the vendor or SR-4731 field list.
  // Example shape — offsets below are PLACEHOLDERS and must be replaced:
  // const fxd = scanResult.blockOffsets.FxdParams;
  // const groupIndex = buffer.readUInt16LE(fxd + REAL_OFFSET);
  // ...
  return {
    rxPowerDbm: null, // real extracted value
    events: [],       // optional KeyEvents-derived list
    meta: { revision: 'replace-me', layoutSource: 'vendor-sdk-or-SR-4731-table' }
  };
});
```

## What must NOT be done
- Do not hard-code offsets from blog posts or guesses.
- Do not return synthetic loss profiles to “make the chart work”.
- Until a resolver is registered, `processOtdrBuffer` correctly returns `fieldsParsed: false`.

## API
- `POST /v1/ftth-advisory/otdr-standards` → standards note + registered vendors
- `POST /v1/ftth-advisory/otdr-process` body: `{ fileBase64, declaredVendor }`

---
*Resolver registration is the only path to real OTDR numbers in this package.*
