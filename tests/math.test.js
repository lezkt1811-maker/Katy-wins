const assert = require('assert');
const M = require('../katy-math.js');

// Fee: 1 contract at 50c -> 0.07*0.25 = $0.0175 -> rounds up to 2c
assert.strictEqual(M.feeCents(50, 1), 2);
// 100 contracts at 50c -> $1.75 -> 175c
assert.strictEqual(M.feeCents(50, 100), 175);
// 10 contracts at 90c -> 0.07*10*0.9*0.1 = $0.063 -> 7c
assert.strictEqual(M.feeCents(90, 10), 7);
assert.strictEqual(M.feeCents(0, 10), 0);

// Break-even includes fee
const a = M.analyzeSide(60, 0.70, { contracts: 1 });
assert.strictEqual(a.totalFee, 2);              // 0.07*.6*.4=.0168 -> 2c
assert.strictEqual(a.totalCost, 62);
assert.ok(Math.abs(a.breakEven - 0.62) < 1e-9);
assert.ok(Math.abs(a.evCents - 8) < 1e-9);      // 70 - 62
assert.ok(a.edge > 0);

// Ranking: higher ROI first; NO side uses 1 - p
const r = M.rankOutcomes([
  { label: 'A', yesAsk: 80, noAsk: 22, yourYesProb: 0.85 },
  { label: 'B', yesAsk: 20, noAsk: 81, yourYesProb: 0.30 },
], { contracts: 1 });
assert.ok(r.ranked[0].roi >= r.ranked[1].roi);
assert.strictEqual(r.ranked[0].label + r.ranked[0].side, 'BYES'); // 30% vs ~22c
assert.strictEqual(r.marketOnly.length, 0);

// No probability -> market-only, sorted by chance
const m = M.rankOutcomes([{ label: 'X', yesAsk: 30, noAsk: 71, yourYesProb: null }]);
assert.strictEqual(m.ranked.length, 0);
assert.strictEqual(m.marketOnly[0].side, 'NO');

assert.strictEqual(M.overround([{yesAsk:55},{yesAsk:48}]), 103);

// OCR parsing: typical Kalshi multi-outcome screen
const txt = `Highest temperature in Chicago today?
85° to 86°
42% Yes 43¢ No 59¢
87° to 88°
31% Yes 32c No 70c
Above 88°
12% Yes 13¢ No 89¢`;
const p = M.parseScreenshotText(txt);
assert.strictEqual(p.length, 3);
assert.deepStrictEqual([p[0].label, p[0].yesAsk, p[0].noAsk, p[0].chancePct], ['85° to 86°', 43, 59, 42]);
assert.strictEqual(p[1].noAsk, 70);
assert.strictEqual(p[2].label, 'Above 88°');

// Yes and No on separate lines
const p2 = M.parseScreenshotText(`Will it rain in KC?\nBuy Yes 61¢\nBuy No 41¢`);
assert.strictEqual(p2.length, 1);
assert.strictEqual(p2[0].yesAsk, 61); assert.strictEqual(p2[0].noAsk, 41);
assert.strictEqual(p2[0].label, 'Will it rain in KC?');

console.log('all math tests passed');

// Real Tesseract output from a dark-mode mock screenshot (OCR quirks kept)
const real = `Highest temperature in Chicago today?

85° to 86° A2% Yes 43¢ No59¢

87° to 88° 31% Yes 32¢ No 70¢

Above 88° 12% Yes 13¢ No s89¢`;
const pr = M.parseScreenshotText(real);
assert.deepStrictEqual(pr.map(o => [o.label, o.yesAsk, o.noAsk, o.chancePct]),
  [['85° to 86°', 43, 59, 42], ['87° to 88°', 32, 70, 31], ['Above 88°', 13, 89, 12]]);
console.log('real OCR sample parsed');
