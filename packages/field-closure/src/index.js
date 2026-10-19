'use strict';
module.exports = Object.assign(
  {},
  require('../../domain/src/fieldClosure'),
  { realityGate: require('../../domain/src/realityGate') },
  { opticalSource: require('../../domain/src/opticalSource') },
  { sourceMap: require('../../domain/src/sourceMap') }
);
