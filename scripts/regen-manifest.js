#!/usr/bin/env node
'use strict';

// Compatibility entry point.
//
// There is exactly one release-provenance implementation. It derives the
// manifest counters, the per-file SHA-256 values, the migration range and the
// release documents from the same source tree, so those numbers cannot drift
// apart. Do not reintroduce a second generator here.
const { runProvenance } = require('./release-provenance.js');
runProvenance();
