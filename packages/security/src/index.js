'use strict';
module.exports = Object.assign({}, require('./clientGuards'), require('./jwt'), require('./buildJwtClaims'));


module.exports = Object.assign(module.exports, require('./httpHardening'));

module.exports = Object.assign(module.exports, require('./outboundPolicy'));

module.exports = Object.assign(module.exports, require('./authorization'));
module.exports = Object.assign(module.exports, require('./ddosGuard'));

module.exports = Object.assign(module.exports, require('./requestConsumptionGuard'));

module.exports = Object.assign(module.exports, require('./objectAccessGuard'));
