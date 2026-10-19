'use strict';
module.exports = Object.assign(
  {},
  require('./registry'),
  require('./nmsReadOnly'),
  require('./huaweiNms'),
  require('./nokiaNms')
);
module.exports.global = require('./global/orgRegistryFactory');
module.exports.globalTypes = require('./global/types');
