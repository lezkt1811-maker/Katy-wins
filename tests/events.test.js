const assert = require('assert');
const M = require('../katy-math.js');

// priceCents: whole cents, dollar strings, and missing values
assert.strictEqual(M.priceCents({ yes_ask: 43 }, 'yes_ask'), 43);
assert.strictEqual(M.priceCents({ yes_ask_dollars: '0.4300' }, 'yes_ask'), 43);
assert.strictEqual(M.priceCents({ yes_ask: 0 }, 'yes_ask'), 0);
assert.strictEqual(M.priceCents({}, 'yes_ask'), null);

// marketsFromEvents: one game with two outcomes, one game with no markets (dropped)
const groups = M.marketsFromEvents([
  {
    event_ticker: 'KXNBAGAME-26OCT27LALBOS',
    title: 'Lakers vs Celtics',
    markets: [
      { ticker: 'KXNBAGAME-26OCT27LALBOS-LAL', yes_sub_title: 'Lakers', yes_ask: 41, yes_bid: 39, no_ask: 61, volume: 1200, close_time: '2026-10-27T23:00:00Z' },
      // No no_ask listed: NO costs 100 - YES bid
      { ticker: 'KXNBAGAME-26OCT27LALBOS-BOS', subtitle: 'Celtics', yes_ask_dollars: '0.6000', yes_bid_dollars: '0.5800', volume: 800, close_time: '2026-10-27T23:00:00Z' },
    ],
  },
  { event_ticker: 'KXNBAGAME-EMPTY', title: 'No markets yet', markets: [] },
]);
assert.strictEqual(groups.length, 1);
assert.strictEqual(groups[0].title, 'Lakers vs Celtics');
assert.strictEqual(groups[0].eventTicker, 'KXNBAGAME-26OCT27LALBOS');
const [lal, bos] = groups[0].markets;
assert.deepStrictEqual(
  { label: lal.label, yes: lal.yes, no: lal.no, volume: lal.volume, close: lal.close },
  { label: 'Lakers', yes: 41, no: 61, volume: 1200, close: '2026-10-27T23:00:00Z' }
);
assert.strictEqual(bos.label, 'Celtics');
assert.strictEqual(bos.yes, 60);
assert.strictEqual(bos.no, 42);       // 100 - 58 YES bid

// Missing or empty input is safe
assert.deepStrictEqual(M.marketsFromEvents(undefined), []);
assert.deepStrictEqual(M.marketsFromEvents([{ event_ticker: 'X', markets: [{ ticker: 'X-1' }] }])[0].markets[0].yes, null);

console.log('events parsing tests passed');
