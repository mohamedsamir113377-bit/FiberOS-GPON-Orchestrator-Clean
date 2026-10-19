'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authorize, authorizeSelf, hasPermission } = require('../src/authorization');

describe('authorization C-3', () => {
  const tech = { role: 'technician' };
  const dispatcher = { role: 'dispatcher' };

  it('technician cannot authorize general ticket:transition (self only)', () => {
    assert.equal(authorize(tech, 'ticket', 'transition'), false);
    assert.equal(authorizeSelf(tech, 'ticket', 'transition'), true);
  });

  it('dispatcher can authorize tenant-scoped ticket:transition', () => {
    assert.equal(authorize(dispatcher, 'ticket', 'transition'), true);
  });

  it('team lead cannot authorize an unsupported team-scoped ticket transition', () => {
    const teamLead = { role: 'team_lead' };
    assert.equal(authorize(teamLead, 'ticket', 'transition'), false);
  });

  it('hasPermission still sees self permission string', () => {
    assert.equal(hasPermission(tech, 'ticket:transition:self'), true);
    assert.equal(hasPermission(tech, 'ticket:transition'), false);
  });
});
