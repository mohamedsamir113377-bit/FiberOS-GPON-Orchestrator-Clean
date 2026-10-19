'use strict';

module.exports = Object.assign({}, require('./logger'), {
  ...require('./degradedReads')
});
