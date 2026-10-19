# Deep GIS + Fault Command Workflows — 2026-10-07

## Implemented

### Fault command
The commercial candidate now has a database-backed fault workflow with:

1. Fault intake with service/landline/customer/provider/contact/address/cabinet/box/site coordinates.
2. Call-center verification of the reported site and fault context.
3. Appointment scheduling.
4. Nearest active technician selection from current persisted GPS, same-tenant scope, freshness window and open-work exclusion.
5. Technician acceptance and work start.
6. Field photo/video/optical evidence with SHA-256 and explicit storage status.
7. Customer acceptance, rating and feedback.
8. Database-authoritative resolution gates.
9. Tokenized customer tracking with expiry/revocation and narrow RLS visibility.

### Deep operational GIS
The operations console now has a MapLibre-based deep GIS surface with:

- technicians;
- active installations;
- active faults with severity/status filtering;
- network assets;
- fiber cable geometry;
- duct geometry;
- construction evidence points;
- nearest-technician analysis;
- network asset impact analysis;
- provider-backed real route projection when the configured routing provider returns GeoJSON geometry.

The GIS API is bbox-bounded, tenant-derived from the authenticated database session, and returns only operational-safe fields.

## Security / truth boundary

No component fabricates:

- customer coordinates;
- technician coordinates;
- route geometry;
- ETA;
- WhatsApp delivery;
- stored media;
- provider verification;
- optical measurements.

Route calculation fails closed when `ROUTING_BASE_URL` is absent or the configured provider is not attested.

Fault and installation evidence remains non-durable until a real evidence/object-storage provider verifies the stored object and matching SHA-256. The source tree intentionally does not claim provider delivery or production runtime verification.

## Production topology recommendation

For production, use an operator-controlled or contracted map tile/style service rather than depending on the public OpenFreeMap instance as a service-level dependency. The public style is a real map source and commercially usable, but its public service carries no SLA; self-hosting or an enterprise provider is the hardened deployment boundary.

Use a real OSRM or Valhalla deployment behind the existing outbound attestation controls for routing. The current API already fails closed on missing/unauthorized routing endpoints.
