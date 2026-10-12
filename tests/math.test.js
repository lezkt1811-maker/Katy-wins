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

// Conservative estimate
const c = M.analyzeSide(58, 0.70, { contracts: 1, uncertainty: 0.07 });
assert.ok(Math.abs(c.consProb - 0.63) < 1e-9);
assert.ok(c.consEvCents < c.evCents && c.consEvCents > 0);   // 63 - 60 = +3

// Track record
const log = [
  { prob: 0.7, marketProb: 0.6, won: true, totalCost: 62, contracts: 1 },
  { prob: 0.7, marketProb: 0.6, won: false, totalCost: 62, contracts: 1 },
  { prob: 0.2, marketProb: 0.3, won: false, totalCost: 32, contracts: 1 },
  { prob: 0.5, marketProb: 0.5, won: null, totalCost: 52, contracts: 1 },
];
const s = M.trackSummary(log);
assert.strictEqual(s.settled, 3); assert.strictEqual(s.open, 1); assert.strictEqual(s.wins, 1);
assert.strictEqual(s.pnlCents, 38 - 62 - 32);
assert.ok(Math.abs(s.brierYou - (0.09 + 0.49 + 0.04) / 3) < 1e-9);
assert.ok(Math.abs(s.brierMarket - (0.16 + 0.36 + 0.09) / 3) < 1e-9);
assert.strictEqual(s.calibration[3].n, 2);
console.log('track record tests passed');

// ---- phase 2 ----
// Log loss: coin-flip forecast = ln 2
assert.ok(Math.abs(M.logLoss([{ p: 0.5, won: true }, { p: 0.5, won: false }], 'p') - Math.log(2)) < 1e-9);
// Confident miss is punished hard but stays finite
assert.ok(M.logLoss([{ p: 1, won: false }], 'p') > 10);

// Fill price overrides saved cost (prediction at 60c, actually paid 67c)
const fe = { contracts: 10, totalCost: 607, fillPrice: 67 };
assert.strictEqual(M.entryCost(fe), 670 + M.feeCents(67, 10));

// Drawdown: +38, -62, -32, +38 => peak 38, trough -56 => 94
const dd = [
  { id: 1, date: '2026-10-01', prob: .6, contracts: 1, totalCost: 62, won: true },
  { id: 2, date: '2026-10-02', prob: .6, contracts: 1, totalCost: 62, won: false },
  { id: 3, date: '2026-10-03', prob: .6, contracts: 1, totalCost: 32, won: false },
  { id: 4, date: '2026-10-04', prob: .6, contracts: 1, totalCost: 62, won: true },
];
assert.strictEqual(M.maxDrawdown(dd), 94);

// Categories + trades split
const t2 = M.trackSummary([
  { prob: .7, marketProb: .6, won: true, totalCost: 62, contracts: 1, category: 'Weather', kind: 'trade' },
  { prob: .4, marketProb: .5, won: false, totalCost: 52, contracts: 1, category: 'Sports', kind: 'prediction' },
]);
assert.deepStrictEqual(t2.byCategory.map(c => [c.category, c.n]), [['Sports', 1], ['Weather', 1]]);
assert.strictEqual(t2.trades.n, 1);
assert.strictEqual(t2.trades.pnlCents, 38);
assert.ok(Math.abs(t2.expectedCents - ((70 - 62) + (40 - 52))) < 1e-9);

// Reading checks: flags suspicious rows, never invents prices
const bad = M.parseScreenshotText('Rain in KC?\nYes 61¢ No 11¢\nSnow 45% 38¢');
assert.ok(bad[0].warn.some(w => w.includes('Yes + No')));
assert.ok(bad[1].warn.includes('only one price found'));
assert.strictEqual(bad[1].noAsk, null);
assert.strictEqual(M.parseScreenshotText(real).every(o => o.warn.length === 0), true);

// Skip reasons
assert.ok(M.reasonsToSkip({ anyYourProb: false, settledPicks: 0 }).length >= 2);
assert.strictEqual(M.reasonsToSkip({ anyYourProb: true, anyCautiousPositive: true, settledPicks: 40, brierYou: .18, brierMarket: .2 }).length, 0);
console.log('phase 2 tests passed');

// Kalshi browse screen: payout multiplier + chance, volume lines, no Yes/No buttons
const browse = M.parseScreenshotText(`Before Jan 1, 2028 6.73x 12%
$40,094,376
Las Vegas 1.76x 54%
$290,994 2.64K
College Station 1.73x 57%
Up 11% Down 89%`);
assert.deepStrictEqual(browse.map(o => [o.label, o.yesAsk, o.noAsk, o.chancePct]),
  [['Before Jan 1, 2028', 15, null, 12], ['Las Vegas', 57, null, 54], ['College Station', 58, null, 57]]);
assert.ok(browse[1].warn[0].includes('1.76x payout'));
console.log('payout-screen parsing passed');

// Real Tesseract word-box output (TSV) from phone-size mock screenshots.
// Tesseract reads columns separately; rowsFromTsv must put each outcome back on one line.
const fs = require('fs'), path = require('path');
const fx = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const b2 = M.parseScreenshotText(M.rowsFromTsv(fx('browse_screen.tsv')));
assert.deepStrictEqual(b2.map(o => [o.label, o.yesAsk, o.chancePct]),
  [['Before Jan 1, 2028', 15, 12], ['Las Vegas', 57, 54], ['College Station', 58, 57], ['Above 90°F', 25, 24]]);
const y2 = M.parseScreenshotText(M.rowsFromTsv(fx('yesno_screen.tsv')));
assert.deepStrictEqual(y2.map(o => [o.yesAsk, o.noAsk]), [[43, 59], [32, 70], [13, 89]]);
assert.strictEqual(M.rowsFromTsv(''), '');
console.log('real OCR word-box fixtures passed');
