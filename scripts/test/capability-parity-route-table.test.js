'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractRoutes, routeExists } = require('../verify-capability-parity');

test('capability parity recognizes explicit route-table management entries', () => {
  const routes = extractRoutes([
    (() => {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiberos-cap-parity-'));
      const file = path.join(dir, 'routes.js');
      fs.writeFileSync(file, [
        "const routes = [",
        "  ['/v1/company/operating-system', ROLES.management, () => companyOperatingSystem()],",
        "];",
        "module.exports = routes;"
      ].join('\n'));
      return file;
    })()
  ]);
  assert.equal(routeExists(routes, 'GET', '/v1/company/operating-system'), true);
});
