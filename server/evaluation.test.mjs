import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluationReport} from '../worker/evaluation.mjs';

const evaluationBase = Date.parse('2026-10-08T08:00:00Z');
const evaluationNow = evaluationBase + 20000 * 60000;

function observedSeries(count = 140, symbol = 'TEST', assetClass = 'stocks') {
  return Array.from({length:count}, (_, i) => {
    const at = evaluationBase + i * 60000;
    const price = 100 + i * .08 + Math.sin(i / 7) * 1.2;
    return {market_id:'Alpaca:' + symbol, symbol, asset_class:assetClass, at,
      quote_at:new Date(at).toISOString(), price, bid:price * .999, ask:price * 1.001};
  });
}

function evaluate(observations, input = {}) {
  return evaluationReport({observations}, input, evaluationNow);
}

function closeAmount(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} != ${expected}`);
}

test('training selection and training results do not use edited holdout prices', () => {
  const observations = observedSeries();
  const before = evaluate(observations);
  const original = before.symbols[0];
  assert.equal(original.status, 'completed');
  const start = original.split.test.start_at;
  const changed = observations.map((q, i) => q.at < start ? {...q} : {
    ...q, price:200 - i * .8, bid:(200 - i * .8) * .999, ask:(200 - i * .8) * 1.001
  });
  const after = evaluate(changed).symbols[0];
  assert.deepEqual(after.selected, original.selected);
  assert.deepEqual(after.training, original.training);
  assert.deepEqual(after.split, original.split);
  assert.notEqual(after.baseline.net_pnl, original.baseline.net_pnl);
  assert.ok(original.split.train.end_at < original.split.test.start_at);
  assert.equal(original.split.train.samples + original.split.test.samples, original.samples_used);
});

test('buy-and-hold benchmark uses observed ask/bid, fees and adverse slippage on both sides', () => {
  const observations = observedSeries();
  const input = {initial_cash:1000, fee_pct:.2, slippage_bps:20};
  const report = evaluate(observations, input), row = report.symbols[0];
  const first = observations.find(q => q.at === row.split.test.start_at);
  const last = observations.find(q => q.at === row.split.test.end_at);
  const fee = input.fee_pct / 100, slip = input.slippage_bps / 10000;
  const budget = input.initial_cash * .06;
  const quantity = budget / (first.ask * (1 + slip) * (1 + fee));
  const buyGross = quantity * first.ask * (1 + slip);
  const sellGross = quantity * last.bid * (1 - slip);
  const expectedNet = sellGross * (1 - fee) - budget;
  closeAmount(row.baseline.net_pnl, expectedNet, 'benchmark round-trip net');
  closeAmount(row.baseline.fees, (buyGross + sellGross) * fee, 'explicit round-trip fees');
  assert.ok(row.baseline.slippage_cost > 0);
  assert.ok(row.baseline.spread_cost > 0);
  assert.equal(row.baseline.closed_trades, 1);
  closeAmount(row.delta.net_pnl, row.test.net_pnl - row.baseline.net_pnl, 'held-out net delta');
  const lowCost = evaluate(observations, {...input, fee_pct:0, slippage_bps:0}).symbols[0];
  assert.ok(lowCost.baseline.net_pnl > row.baseline.net_pnl);
});

test('frozen holdout decisions do not depend on observations that arrive later', () => {
  const observations = observedSeries(160);
  const cutoff = observations[145].at;
  const first = evaluate(observations).symbols[0];
  const changed = observations.map(q => q.at < cutoff ? {...q} : {
    ...q, price:q.price * .65, bid:q.bid * .65, ask:q.ask * .65
  });
  const second = evaluate(changed).symbols[0];
  assert.deepEqual(second.selected, first.selected);
  assert.deepEqual(second.test.trades.filter(t => t.at < cutoff), first.test.trades.filter(t => t.at < cutoff));
  assert.deepEqual(second.test.curve.filter(p => p.at < cutoff), first.test.curve.filter(p => p.at < cutoff));
  assert.ok(first.test.trades.some(t => t.at < cutoff), 'fixture must exercise an actual held-out entry');
});

test('source timestamp duplicates do not create extra evidence or alter results', () => {
  const observations = observedSeries();
  const expected = evaluate(observations).symbols[0];
  const duplicates = observations.map(q => ({...q, at:q.at + 1000}));
  const actual = evaluate([...observations, ...duplicates]).symbols[0];
  assert.equal(actual.samples_used, expected.samples_used);
  assert.deepEqual(actual.split, expected.split);
  assert.deepEqual(actual.selected, expected.selected);
  assert.deepEqual(actual.training, expected.training);
  assert.deepEqual(actual.test, expected.test);
});

test('distinct books collected at the same instant cannot straddle the holdout boundary', () => {
  const observations = observedSeries();
  observations[98].at = observations[97].at;
  observations[98].quote_at = new Date(observations[97].at - 500).toISOString();
  const row = evaluate(observations).symbols[0];
  if (row.status === 'completed') {
    assert.ok(row.split.train.end_at < row.split.test.start_at, 'training and holdout availability times must be strictly separated');
  } else {
    assert.equal(row.status, 'insufficient_data');
    assert.ok(row.reason);
  }
});

test('unsupported assets, crossed books and future collection/source timestamps cannot train candidates', () => {
  const observations = observedSeries();
  const expected = evaluate(observations).symbols[0];
  const invalid = [
    {...observations[0], at:evaluationNow + 60000, quote_at:new Date(evaluationNow + 60000).toISOString(), price:9000},
    {...observations[0], at:evaluationNow - 60000, quote_at:new Date(evaluationNow + 60000).toISOString(), price:9000},
    {...observations[0], at:evaluationNow + 60000, quote_at:new Date(observations[0].at).toISOString(), price:9000},
    {...observations[0], at:evaluationBase + 141 * 60000, quote_at:new Date(evaluationBase + 141 * 60000).toISOString(), bid:102, ask:101},
    ...observedSeries(140, 'PREDICTION', 'prediction')
  ];
  const report = evaluate([...observations, ...invalid]);
  assert.equal(report.symbols.length, 1);
  const actual = report.symbols[0];
  assert.deepEqual(actual.selected, expected.selected);
  assert.deepEqual(actual.training, expected.training);
  assert.deepEqual(actual.test, expected.test);
  assert.ok(report.data.received > report.data.valid);
});

test('insufficient history reports missing evidence without invented performance', () => {
  const report = evaluate(observedSeries(119));
  assert.equal(report.status, 'insufficient_data');
  assert.equal(report.requirements.min_samples, 120);
  assert.equal(report.symbols[0].status, 'insufficient_data');
  assert.ok(report.symbols[0].reason);
  assert.ok(!report.symbols[0].test);
  assert.ok(!report.symbols[0].selected);
  assert.equal(report.orders_submitted, 0);
});

test('evaluation is a pure isolated report and does not contact providers or change desk state', () => {
  const state = {observations:observedSeries(), cash_cents:75000, config:{ticket_pct:6}, ai_connection:{ciphertext:'private-test-token'}};
  const snapshot = JSON.stringify(state), originalFetch = globalThis.fetch;
  globalThis.fetch = () => {throw Error('Evaluation must not contact providers');};
  try {
    const report = evaluationReport(state, {}, evaluationNow);
    assert.equal(report.orders_submitted, 0);
    assert.equal(JSON.stringify(state), snapshot);
    assert.ok(!JSON.stringify(report).includes('private-test-token'));
    assert.ok(report.limitations.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
