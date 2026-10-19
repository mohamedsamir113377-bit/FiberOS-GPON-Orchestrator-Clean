# Optical Engineering Mathematics — FiberOS

## Purpose

FiberOS contains a deterministic optical-engineering mathematics layer for calculations that can be performed from explicitly supplied numerical measurements or design parameters.
It is deliberately separated from instrument/file parsing and from production measurement evidence.

## Implemented mathematics

### Power and dB

- P_mW = 10^(P_dBm / 10)
- P_dBm = 10 * log10(P_mW)
- Delta_dB = P1_dBm - P2_dBm
- dB = 10 * log10(P2 / P1) when a positive power ratio is supplied.

### Rx / optical link budget

For explicitly declared gains and losses:

  P_rx = P_tx + sum(gains) - sum(losses)

Receiver margin:

  M_sensitivity = P_rx - P_sensitivity

Overload headroom:

  H_overload = P_overload - P_rx

No fibre, splice, connector, splitter, or engineering-margin coefficient is invented by the mathematics layer. Those quantities are supplied as inputs or governed parameter bindings.

### OTDR distance

For round-trip propagation time t and group refractive index n_g:

  d = c * t / (2 * n_g)

d is one-way fibre distance. c is the exact SI speed of light in vacuum, 299792458 m/s.

The implementation does not infer n_g from a guessed SOR byte offset.

### OTDR backscatter attenuation

For two ordered backscatter levels represented in dBm at one-way positions z1 and z2:

  alpha = (P1_dBm - P2_dBm) / (2 * (z2 - z1))

When expressed in dB/km:

  alpha_dB_per_km = 500 * (P1_dBm - P2_dBm) / (z2 - z1)

The factor of two accounts for the OTDR round trip. A negative fitted or two-point slope is preserved and flagged for review; it is never silently converted to a positive loss.

### OTDR trace regression

For decoded numeric points (z_i, P_i), FiberOS computes the ordinary least-squares line:

  P_i = a + b * z_i + residual_i

and derives:

  alpha_dB_per_km = -500 * b

The result includes residual sum of squares, residual variance when degrees of freedom permit it, slope uncertainty, attenuation uncertainty, and R^2 when the observed power variance is non-zero.

This is a mathematical analysis of supplied trace points. It is not a vendor-specific SOR parser.

### OTDR event loss

For a measured level immediately before and after an event:

  L_event = P_before_dBm - P_after_dBm

### Reflectance

For positive incident and reflected optical powers:

  R_dB = 10 * log10(P_reflected / P_incident)

When both levels are already represented in dBm:

  R_dB = P_reflected_dBm - P_incident_dBm

Passive-event validation rejects a reflected power greater than the incident power instead of returning a physically misleading value.

### First-order uncertainty propagation

Where independent standard uncertainties are explicitly supplied, FiberOS propagates them by the first-order law:

  Var(f) ~= sum((df/dx_i)^2 * Var(x_i))

For OTDR distance:

  Var(d) ~= (c/(2*n_g))^2 Var(t) + (c*t/(2*n_g^2))^2 Var(n_g)

For two-point backscatter attenuation, uncertainty is propagated from endpoint power and distance uncertainties.

For reflectance from dBm levels:

  u_R = sqrt(u_reflected^2 + u_incident^2)

No covariance term is invented. Where correlations matter, the caller must use a model that explicitly supplies the covariance.

## Important engineering boundary

ITU-T G.650.1 (01/2024) includes the backscattering technique as an alternative method for characterizing attenuation and related fibre attributes. The recommendation also discusses calibration of backscattering equipment. FiberOS therefore distinguishes:

1. deterministic mathematics,
2. decoded instrument/vendor data,
3. calibration and measurement evidence.

A calculation can be mathematically correct while the underlying measurement is still unverified.

## OTDR file parsing boundary

The current .SOR scanner detects the structural block boundary layer. Numeric field extraction is intentionally not guessed because revisions and vendor-specific layouts require authoritative field definitions.

Vendor resolvers may be registered only when their real layout is known. Parser output is not automatically labelled as instrument-verified evidence.

## API surfaces

The engineering route exposes the deterministic calculations as advisory calculated endpoints:

- /v1/engineering/otdr-distance
- /v1/engineering/otdr-distance-uncertainty
- /v1/engineering/otdr-backscatter-attenuation
- /v1/engineering/otdr-backscatter-uncertainty
- /v1/engineering/otdr-trace-fit
- /v1/engineering/otdr-event-loss
- /v1/engineering/otdr-reflectance
- /v1/engineering/otdr-reflectance-uncertainty
- /v1/engineering/rx-power-from-budget
- /v1/engineering/rx-power-margin

These endpoints perform deterministic calculations from caller-supplied values. They do not assert that a physical OTDR, optical power meter, or customer network is connected.

## Verification

The mathematical module has dedicated regression tests for reciprocal conversions, link-budget arithmetic, OTDR timing/distance, two-point attenuation, regression fitting, reflectance, uncertainty propagation, invalid inputs, and non-physical ordering.
