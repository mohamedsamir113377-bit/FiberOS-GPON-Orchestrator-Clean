'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePortalBillingInterval,
  normalizePortalReportType,
  normalizePortalRecipients,
  validatePortalReportWindow,
  nextPortalRunAt
}=require('../src');

describe('customer portal commercial primitives',function(){
  it('accepts only weekly/monthly/yearly cadences',function(){
    assert.equal(normalizePortalBillingInterval('MONTHLY'),'monthly');
    assert.throws(()=>normalizePortalBillingInterval('daily'),/PORTAL_BILLING_INTERVAL_INVALID/);
  });
  it('validates report types and bounded windows',function(){
    assert.equal(normalizePortalReportType('Engineering'),'engineering');
    assert.throws(()=>normalizePortalReportType('profit-forecast'),/PORTAL_REPORT_TYPE_INVALID/);
    const end=new Date('2026-10-08T00:00:00Z');
    const ok=validatePortalReportWindow('2026-10-01T00:00:00Z',end,end);
    assert.equal(ok.from.toISOString(),'2026-10-01T00:00:00.000Z');
    assert.throws(()=>validatePortalReportWindow('2025-09-01T00:00:00Z',end,end),/PORTAL_REPORT_WINDOW_TOO_LARGE/);
  });
  it('bounds recipients and normalizes addresses',function(){
    const list=normalizePortalRecipients(['OPS@example.com','ops@example.com']);
    assert.deepEqual(list,['ops@example.com']);
    assert.throws(()=>normalizePortalRecipients([]),/PORTAL_RECIPIENTS_INVALID/);
    assert.throws(()=>normalizePortalRecipients(Array.from({length:11},(_,i)=>'u'+i+'@example.com')),/PORTAL_RECIPIENTS_INVALID/);
  });
  it('computes timezone-aware schedule candidates',function(){
    const base=new Date('2026-10-08T00:00:00Z');
    const weekly=nextPortalRunAt({cadence:'weekly',weekday:4,hour:8,minute:0,timezone:'Africa/Cairo'},base);
    assert.equal(weekly.getTime()>base.getTime(),true);
    const monthly=nextPortalRunAt({cadence:'monthly',dayOfMonth:15,hour:8,minute:30,timezone:'Africa/Cairo'},base);
    assert.equal(monthly.toISOString().slice(0,10),'2026-10-15');
    const yearly=nextPortalRunAt({cadence:'yearly',monthOfYear:12,dayOfMonth:1,hour:9,minute:0,timezone:'Africa/Cairo'},base);
    assert.equal(yearly.toISOString().slice(0,10),'2026-12-01');
  });
});
