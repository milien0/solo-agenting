import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Runtime } from '../src/runtime.js';
import { getConfig } from '../src/config.js';

const startedAt='2026-01-01T00:00:00.000Z';
const inside='2026-01-02T12:00:00.000Z';
const endsAt='2026-01-31T00:00:00.000Z';

function fixture(t:TestContext) {
  const root=mkdtempSync(join(tmpdir(),'solo-accounting-'));
  const store=new Store(':memory:');
  const runtime=new Runtime({...getConfig(root),initialCapitalUsd:200,targetUsd:1000,durationDays:30},{STRIPE_SECRET_KEY:'test-fixture-not-a-credential'},store);
  store.setSetting('challenge.startedAt',startedAt);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  return {store,runtime};
}

test('financial claims are unverified, funding is excluded, and cents/references are validated', t=>{
  const {store,runtime}=fixture(t);
  store.ledgerRecord({type:'income',amountUsd:1000,description:'Unverified report',externalRef:'reported:one',occurredAt:inside});
  store.ledgerRecord({type:'funding',amountUsd:200,description:'Owner confirmed capital',externalRef:'owner:funding',occurredAt:inside},true,'owner');
  assert.equal(runtime.challenge().revenueUsd,0);
  assert.equal(store.totals().fundingUsd,200);
  assert.equal(store.totals().balanceUsd,200);
  for(const amountUsd of [0,-1,NaN,Infinity,0.001]) assert.throws(()=>store.ledgerRecord({type:'income',amountUsd,description:'Invalid',externalRef:'invalid'}));
  assert.throws(()=>store.ledgerRecord({type:'income',amountUsd:1,description:'Invalid',externalRef:'  '}),/Evidence/);
  assert.throws(()=>store.ledgerRecord({type:'income',amountUsd:1,description:'Invalid verification',externalRef:'invalid:verified'},true),/trusted/);
  const cents=store.ledgerRecord({type:'expense',amountUsd:12.345,description:'Rounded evidence',externalRef:'owner:expense'},true,'owner');
  assert.equal(cents.amountUsd,12.35);
});

test('trusted matching evidence upgrades a reported receipt without duplicate income', t=>{
  const {store,runtime}=fixture(t);
  const input={type:'income',amountUsd:25,description:'Receipt evidence',externalRef:'stripe:ch_one'};
  const reported=store.ledgerRecord(input);
  assert.equal(reported.verified,false);
  const verified=store.ledgerRecord({...input,occurredAt:inside,receiptStatus:'valid'},true,'stripe');
  assert.equal(verified.id,reported.id);
  assert.equal(verified.upgraded,true);
  assert.equal(verified.occurredAt,inside);
  assert.equal(runtime.challenge().revenueUsd,25);
  assert.equal(store.ledgerRecord({...input,occurredAt:inside},true,'stripe').duplicate,true);
  assert.equal(store.ledger().length,1);
  assert.throws(()=>store.ledgerRecord({...input,amountUsd:26},true,'stripe'),/Conflicting/);
  assert.throws(()=>store.ledgerRecord({...input,type:'funding'},true,'stripe'),/Conflicting/);
  assert.equal(runtime.challenge().revenueUsd,25);
});

test('challenge uses provider occurrence time and an exclusive deadline, including late reconciliation', t=>{
  const {store,runtime}=fixture(t);
  for(const [externalRef,occurredAt,amountUsd] of [
    ['stripe:before','2025-12-31T23:59:59.999Z',200],
    ['stripe:start',startedAt,20],
    ['stripe:inside',inside,30],
    ['stripe:end',endsAt,400],
    ['stripe:after','2026-02-01T00:00:00.000Z',500],
  ] as const) store.ledgerRecord({type:'income',amountUsd,description:'Provider evidence',externalRef,occurredAt},true,'stripe');
  assert.equal(runtime.challenge().revenueUsd,50);
  assert.equal(runtime.challenge().grossReceiptsUsd,50);
  assert.equal(runtime.challenge().totalRevenueUsd,1150);
  assert.ok(Date.parse(store.ledger()[0].createdAt)>Date.parse(endsAt),'fixture is reconciled after the challenge window');
});

test('successful returns reduce qualifying receipts while operating costs stay separate', t=>{
  const {store,runtime}=fixture(t);
  store.ledgerRecord({type:'income',amountUsd:100,description:'Sale',externalRef:'stripe:ch_sale',occurredAt:inside},true,'stripe');
  store.ledgerRecord({type:'refund',amountUsd:10,description:'First return',externalRef:'stripe:refund:re_one',relatedRef:'stripe:ch_sale',occurredAt:'2026-02-01T00:00:00.000Z'},true,'stripe');
  store.ledgerRecord({type:'refund',amountUsd:20,description:'Second return',externalRef:'stripe:refund:re_two',relatedRef:'stripe:ch_sale',occurredAt:'2026-02-02T00:00:00.000Z'},true,'stripe');
  store.ledgerRecord({type:'refund',amountUsd:20,description:'Second return replay',externalRef:'stripe:refund:re_two',relatedRef:'stripe:ch_sale',occurredAt:'2026-02-02T00:00:00.000Z'},true,'stripe');
  store.ledgerRecord({type:'expense',amountUsd:15,description:'Operating expense',externalRef:'owner:hosting',occurredAt:inside},true,'owner');
  const challenge=runtime.challenge();
  assert.equal(challenge.grossReceiptsUsd,100);
  assert.equal(challenge.refundUsd,30);
  assert.equal(challenge.revenueUsd,70);
  assert.equal(challenge.expenseUsd,15);
  assert.equal(challenge.netProfitUsd,55);
  assert.equal(challenge.balanceUsd,55);
});

test('disputed and refunded receipts cannot create progress or double deductions', t=>{
  const {store,runtime}=fixture(t);
  const income={type:'income',amountUsd:1000,description:'Provider payment',externalRef:'stripe:ch_disputed',occurredAt:inside};
  store.ledgerRecord({...income,receiptStatus:'valid'},true,'stripe');
  assert.equal(runtime.challenge().status,'succeeded');
  store.ledgerRecord({...income,receiptStatus:'disputed'},true,'stripe');
  store.ledgerRecord({type:'refund',amountUsd:200,description:'Disputed return',externalRef:'stripe:refund:re_disputed',relatedRef:income.externalRef,occurredAt:inside},true,'stripe');
  const challenge=runtime.challenge();
  assert.equal(challenge.grossReceiptsUsd,1000);
  assert.equal(challenge.disputedReceiptsUsd,1000);
  assert.equal(challenge.refundUsd,200);
  assert.equal(challenge.receiptAdjustmentsUsd,1000);
  assert.equal(challenge.revenueUsd,0);
  assert.equal(challenge.balanceUsd,0);
  assert.notEqual(challenge.status,'succeeded');
});

test('revenue calculation includes every durable receipt rather than a 500-row display cap', t=>{
  const {store,runtime}=fixture(t);
  for(let i=0;i<505;i++) store.ledgerRecord({type:'income',amountUsd:1,description:'Provider receipt',externalRef:`stripe:ch_${i}`,occurredAt:inside},true,'stripe');
  assert.equal(store.ledger().length,505);
  assert.equal(runtime.challenge().revenueUsd,505);
});

test('Stripe reconciliation filters test/uncaptured payments, uses captured amounts, and deduplicates paginated refunds', async t=>{
  const {store,runtime}=fixture(t);
  const created=Date.parse(inside)/1000;
  const base={object:'charge',livemode:true,paid:true,captured:true,status:'succeeded',currency:'usd',amount:10000,amount_captured:8000,amount_refunded:1000,created,disputed:false};
  const charge={...base,id:'ch_real'};
  const refunds=[{id:'re_one',charge:'ch_real',status:'succeeded',currency:'usd',amount:1000,created:created+10}];
  const requests:string[]=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));requests.push(url.toString());
    if(url.pathname==='/v1/charges') return Response.json({has_more:false,data:[charge,{...base,id:'ch_test',livemode:false},{...base,id:'ch_authorized',captured:false},{...base,id:'ch_pending',status:'pending'},{...base,id:'ch_disputed',amount_captured:5000,amount_refunded:0,disputed:true},{...base,id:'ch_before',created:Date.parse(startedAt)/1000-1},{...base,id:'ch_deadline',created:Date.parse(endsAt)/1000}]});
    assert.equal(url.pathname,'/v1/refunds');
    assert.equal(url.searchParams.get('charge'),'ch_real');
    if(refunds.length===1) return Response.json({has_more:false,data:refunds});
    if(!url.searchParams.has('starting_after')) return Response.json({has_more:true,data:[refunds[0]]});
    assert.equal(url.searchParams.get('starting_after'),'re_one');
    return Response.json({has_more:false,data:[...refunds.slice(1),{id:'re_pending',charge:'ch_real',status:'pending',currency:'usd',amount:500,created:created+30}]});
  };
  t.after(()=>{globalThis.fetch=originalFetch;});
  store.ledgerRecord({type:'income',amountUsd:80,description:'Agent claim',externalRef:'stripe:ch_real'});
  const first=await runtime.reconcileStripe();
  assert.equal(first.newReceipts,2);
  assert.equal(first.newRefunds,1);
  assert.equal(first.challenge.grossReceiptsUsd,130);
  assert.equal(first.challenge.revenueUsd,70);
  charge.amount_refunded=3000;
  refunds.push({id:'re_two',charge:'ch_real',status:'succeeded',currency:'usd',amount:2000,created:created+20});
  const next=await runtime.reconcileStripe();
  assert.equal(next.newReceipts,0);
  assert.equal(next.newRefunds,1);
  assert.equal(next.challenge.refundUsd,30);
  assert.equal(next.challenge.revenueUsd,50);
  const replay=await runtime.reconcileStripe();
  assert.equal(replay.newRefunds,0);
  assert.equal(replay.challenge.revenueUsd,50);
  assert.equal(store.ledger().length,4);
  assert.equal(store.ledger().find(entry=>entry.externalRef==='stripe:ch_real')?.occurredAt,inside);
  const request=new URL(requests[0]);
  assert.equal(request.searchParams.get('created[gte]'),String(Date.parse(startedAt)/1000));
  assert.equal(request.searchParams.get('created[lt]'),String(Date.parse(endsAt)/1000));
});
