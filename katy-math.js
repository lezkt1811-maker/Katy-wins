/*
 * Katy Wins — contract math and screenshot text parsing.
 * Pure functions, no DOM, so they run in the browser and in Node tests.
 *
 * Prices are in cents (1–99). A winning contract pays 100 cents.
 */
(function (root) {
  'use strict';

  // Kalshi's general trading fee: ceil(rate × C × P × (1 − P)), P in dollars,
  // rounded UP to the next whole cent for the whole order.
  // Some product families use a different rate, so it is a parameter.
  const DEFAULT_FEE_RATE = 0.07;

  function feeCents(priceCents, contracts, rate) {
    if (rate === undefined) rate = DEFAULT_FEE_RATE;
    if (!(priceCents > 0 && priceCents < 100) || !(contracts > 0)) return 0;
    const p = priceCents / 100;
    const dollars = rate * contracts * p * (1 - p);
    // Round to 1e-9 first so floating-point noise (e.g. 1.0000000002) doesn't add a cent.
    return Math.ceil(Math.round(dollars * 100 * 1e6) / 1e6);
  }

  /**
   * Analyse buying one side of a contract.
   * @param {number} priceCents  what you pay per contract (the ask)
   * @param {number|null} yourProb  your own probability 0–1, or null
   * @param {object} opts  {contracts, feeRate}
   */
  function analyzeSide(priceCents, yourProb, opts) {
    opts = opts || {};
    const contracts = Math.max(1, Math.floor(opts.contracts || 1));
    const rate = opts.feeRate === undefined ? DEFAULT_FEE_RATE : opts.feeRate;
    if (!(priceCents >= 1 && priceCents <= 99)) return null;

    const totalFee = feeCents(priceCents, contracts, rate);
    const costPer = priceCents + totalFee / contracts;      // cents, incl. fee
    const totalCost = priceCents * contracts + totalFee;    // cents
    const profitIfWin = 100 * contracts - totalCost;        // cents
    const breakEven = costPer / 100;                        // probability needed
    const marketProb = priceCents / 100;

    const out = {
      priceCents, contracts, totalFee, costPer, totalCost, profitIfWin,
      breakEven, marketProb,
      payoutMultiple: (100 * contracts) / totalCost,         // $ back per $1 if it wins
      yourProb: null, edge: null, evCents: null, roi: null,
      consProb: null, consEvCents: null, consRoi: null,
    };
    if (yourProb !== null && yourProb !== undefined && yourProb >= 0 && yourProb <= 1) {
      out.yourProb = yourProb;
      out.edge = yourProb - breakEven;                       // + means worth it
      out.evCents = yourProb * 100 * contracts - totalCost;  // expected profit
      out.roi = out.evCents / totalCost;                     // expected profit per $ risked
      // Conservative view: the low end of the range you say you're unsure by.
      const u = Math.max(0, Math.min(1, opts.uncertainty || 0));
      out.consProb = Math.max(0, yourProb - u);
      out.consEvCents = out.consProb * 100 * contracts - totalCost;
      out.consRoi = out.consEvCents / totalCost;
    }
    return out;
  }

  // ---------- Track record scoring ----------
  // entry: {prob (your chance this side wins), marketProb, won (true/false), totalCost, contracts}

  // Brier score: mean squared gap between forecast and result (1 or 0). Lower is better.
  function brier(entries, key) {
    const s = entries.filter(e => typeof e.won === 'boolean' && e[key] != null);
    if (!s.length) return null;
    return s.reduce((t, e) => t + Math.pow(e[key] - (e.won ? 1 : 0), 2), 0) / s.length;
  }

  // Group settled picks into probability bands and compare predicted vs actual win rate.
  function calibration(entries, bands) {
    bands = bands || [[0, .2], [.2, .4], [.4, .6], [.6, .8], [.8, 1.0001]];
    return bands.map(([lo, hi]) => {
      const s = entries.filter(e => typeof e.won === 'boolean' && e.prob >= lo && e.prob < hi);
      return {
        lo, hi: Math.min(hi, 1), n: s.length,
        predicted: s.length ? s.reduce((t, e) => t + e.prob, 0) / s.length : null,
        actual: s.length ? s.filter(e => e.won).length / s.length : null,
      };
    });
  }

  // Log loss punishes confident misses hard. Lower is better; 0.693 = coin flip.
  function logLoss(entries, key) {
    const s = entries.filter(e => typeof e.won === 'boolean' && e[key] != null);
    if (!s.length) return null;
    const eps = 1e-6;
    return -s.reduce((t, e) => {
      const p = Math.min(1 - eps, Math.max(eps, e[key]));
      return t + (e.won ? Math.log(p) : Math.log(1 - p));
    }, 0) / s.length;
  }

  // What a pick really cost: the price you actually paid if you entered one.
  function entryCost(e) {
    if (e.fillPrice >= 1 && e.fillPrice <= 99) {
      return e.fillPrice * e.contracts + feeCents(e.fillPrice, e.contracts, e.feeRate);
    }
    return e.totalCost;
  }
  const entryPnl = e => (e.won ? 100 * e.contracts : 0) - entryCost(e);
  const entryEv = e => e.prob * 100 * e.contracts - entryCost(e);

  // Largest peak-to-trough fall in running profit, in settle order.
  function maxDrawdown(settled) {
    const seq = settled.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.id || 0) - (b.id || 0));
    let run = 0, peak = 0, dd = 0;
    for (const e of seq) { run += entryPnl(e); peak = Math.max(peak, run); dd = Math.max(dd, peak - run); }
    return dd;
  }

  function groupStats(settled) {
    if (!settled.length) return null;
    const pnl = settled.reduce((t, e) => t + entryPnl(e), 0);
    const staked = settled.reduce((t, e) => t + entryCost(e), 0);
    return {
      n: settled.length, wins: settled.filter(e => e.won).length,
      pnlCents: pnl, stakedCents: staked, returnPct: staked ? pnl / staked : null,
      expectedCents: settled.reduce((t, e) => t + entryEv(e), 0),
      brierYou: brier(settled, 'prob'), brierMarket: brier(settled, 'marketProb'),
    };
  }

  function trackSummary(entries) {
    const settled = entries.filter(e => typeof e.won === 'boolean');
    const all = groupStats(settled) || { n: 0, wins: 0, pnlCents: 0, stakedCents: 0, returnPct: null, expectedCents: 0, brierYou: null, brierMarket: null };
    const cats = {};
    for (const e of settled) (cats[(e.category || 'Uncategorized').trim() || 'Uncategorized'] ||= []).push(e);
    const trades = settled.filter(e => e.kind === 'trade');
    return {
      total: entries.length, settled: settled.length, open: entries.length - settled.length,
      wins: all.wins, pnlCents: all.pnlCents, stakedCents: all.stakedCents, returnPct: all.returnPct,
      expectedCents: all.expectedCents,
      brierYou: all.brierYou, brierMarket: all.brierMarket,
      logLossYou: logLoss(settled, 'prob'), logLossMarket: logLoss(settled, 'marketProb'),
      maxDrawdownCents: maxDrawdown(settled),
      calibration: calibration(settled),
      byCategory: Object.keys(cats).sort().map(k => Object.assign({ category: k }, groupStats(cats[k]))),
      trades: groupStats(trades),
    };
  }

  // ---------- Honest "should I bet at all?" check ----------
  // Returns plain-language reasons NOT to bet. An empty list means none found.
  function reasonsToSkip(ctx) {
    const r = [];
    if (!ctx.anyYourProb) r.push('You haven\'t entered YOUR % anywhere, so nothing here can be called a good bet. The price is just the crowd\'s guess.');
    if (ctx.anyYourProb && !ctx.anyCautiousPositive) {
      r.push(ctx.anyBestGuessPositive
        ? 'Your best guess shows an edge, but it disappears at the cautious end of your range.'
        : 'Every option loses money on average once fees are included.');
    }
    if (ctx.uncertainRows) r.push(ctx.uncertainRows === 1
      ? '1 row looks misread (marked ⚠). Fix it before trusting the results.'
      : `${ctx.uncertainRows} rows look misread (marked ⚠). Fix them before trusting the results.`);
    if (ctx.staleMinutes !== null && ctx.staleMinutes !== undefined && ctx.staleMinutes >= 10) r.push(`Live prices are ${ctx.staleMinutes} minutes old. Refresh before buying.`);
    if (ctx.settledPicks < 30) r.push(`Your track record has ${ctx.settledPicks} settled pick${ctx.settledPicks === 1 ? '' : 's'}. There's no evidence yet that your % beats the market.`);
    else if (ctx.brierYou !== null && ctx.brierMarket !== null && ctx.brierYou >= ctx.brierMarket) r.push('So far the market\'s prices have been more accurate than your probabilities.');
    return r;
  }

  /**
   * Turn a list of outcomes into ranked bets.
   * outcome: {label, yesAsk, noAsk, yourYesProb (0–1 or null)}
   * Returns every buyable side, sorted best first.
   * With your probability: ranked by expected return per dollar.
   * Without it: no side can be called "best value", so it is ranked by
   * chance of winning and flagged as market-only.
   */
  function rankOutcomes(outcomes, opts) {
    const rows = [];
    for (const o of outcomes) {
      const yp = o.yourYesProb;
      const hasProb = yp !== null && yp !== undefined && !Number.isNaN(yp);
      if (o.yesAsk) {
        const a = analyzeSide(o.yesAsk, hasProb ? yp : null, opts);
        if (a) rows.push(Object.assign({ label: o.label, side: 'YES' }, a));
      }
      if (o.noAsk) {
        const a = analyzeSide(o.noAsk, hasProb ? 1 - yp : null, opts);
        if (a) rows.push(Object.assign({ label: o.label, side: 'NO' }, a));
      }
    }
    const withProb = rows.filter(r => r.roi !== null);
    const marketOnly = rows.filter(r => r.roi === null);
    withProb.sort((a, b) => b.roi - a.roi);
    marketOnly.sort((a, b) => b.marketProb - a.marketProb);
    return { ranked: withProb, marketOnly };
  }

  /**
   * Sum of YES asks across mutually exclusive outcomes, in cents.
   * Above 100 = the market's built-in cut; buying every YES loses money.
   */
  function overround(outcomes) {
    const asks = outcomes.map(o => o.yesAsk).filter(v => v > 0);
    if (asks.length < 2) return null;
    return asks.reduce((s, v) => s + v, 0);
  }

  // ---------- Screenshot text parsing ----------

  /**
   * Plain-language reasons a row read from a screenshot may be wrong.
   * Kalshi's Yes ask + No ask is normally 100¢ plus a small spread.
   */
  function checkReading(o) {
    const w = [];
    const y = o.yesAsk, n = o.noAsk;
    if (!o.label || /^Outcome \d+$/.test(o.label)) w.push('outcome name not read');
    if (y && n && (y + n < 98 || y + n > 115)) w.push(`Yes + No = ${y + n}¢ (normally 100–110¢)`);
    if ((y && !n) || (!y && n)) w.push('only one price found');
    if (o.chancePct != null && y && Math.abs(o.chancePct - y) > 15) w.push(`chance ${o.chancePct}% doesn't match Yes ${y}¢`);
    return w;
  }

  // OCR often reads ¢ as c, e, ¢, or drops it. Accept "62¢", "62c", "62 ¢".
  const CENT_RE = /(\d{1,2})\s*(?:¢|c\b|e\b|C\b)/g;
  const PCT_RE = /(\d{1,3})\s*%/;
  // "(?![a-z])" instead of \b so OCR output like "No59¢" (no space) still matches.
  const YES_RE = /\byes(?![a-z])[^\d]{0,6}(\d{1,2})\s*(?:¢|c|e|C)?/i;
  const NO_RE = /\bno(?![a-z])[^\d]{0,6}(\d{1,2})\s*(?:¢|c|e|C)?/i;
  const OCR_DIGIT = { A: '4', O: '0', o: '0', S: '5', s: '5', I: '1', l: '1', B: '8', Z: '2' };

  // Fix letters OCR commonly swaps for digits, but only inside a number right
  // before % or ¢ (e.g. "A2%" -> "42%", "5O¢" -> "50¢").
  function fixOcrDigits(line) {
    return line.replace(/(^|[\s(])([0-9AOoSsIlBZ]{2,3})(?=\s*([%¢]))/g, (m, pre, tok, sym) => {
      if (!/\d/.test(tok)) return m;
      const max = sym === '%' ? 100 : 99;
      const fixed = tok.replace(/[AOoSsIlBZ]/g, ch => OCR_DIGIT[ch]);
      if (+fixed <= max) return pre + fixed;
      // Out of range: the letter was stray noise ("s89¢"), not a digit. Drop it.
      const trimmed = tok.replace(/^[AOoSsIlBZ]+/, '');
      return /^\d+$/.test(trimmed) && +trimmed <= max ? pre + trimmed : m;
    });
  }
  const DOLLAR_RE = /\$\s?0?\.(\d{2})/g;

  function cleanLabel(s) {
    return s
      .replace(YES_RE, ' ').replace(NO_RE, ' ')
      .replace(/\b(?:yes|no)\s*\S?\d{1,2}\s*[¢ce]?/gi, ' ')
      .replace(/\d{1,3}\s*%/g, ' ')
      .replace(/\d{1,2}\s*(?:¢|c\b|e\b)/g, ' ')
      .replace(/\$\s?0?\.\d{2}/g, ' ')
      .replace(/\b(buy|sell|chance|yes|no)\b/gi, ' ')
      .replace(/[|•·<>»«©®™_=~*]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Best-effort parse of OCR text from a Kalshi screenshot.
   * Finds lines that carry prices and pulls out label, Yes price, No price,
   * and the displayed chance %. Always review the result: OCR misreads.
   */
  function parseScreenshotText(text) {
    const lines = text.split(/\r?\n/).map(l => fixOcrDigits(l.trim())).filter(Boolean);
    const outcomes = [];
    let pendingLabel = '';

    for (const line of lines) {
      const yes = line.match(YES_RE);
      const no = line.match(NO_RE);
      const cents = [...line.matchAll(CENT_RE)].map(m => +m[1]);
      const dollars = [...line.matchAll(DOLLAR_RE)].map(m => +m[1]);
      const pct = line.match(PCT_RE);

      let yesAsk = yes ? +yes[1] : null;
      let noAsk = no ? +no[1] : null;
      const priceList = cents.length ? cents : dollars;
      if (yesAsk === null && noAsk === null && priceList.length >= 2) {
        yesAsk = priceList[0]; noAsk = priceList[1];
      } else if (yesAsk === null && noAsk === null && priceList.length === 1 && pct) {
        yesAsk = priceList[0];
      }

      const hasPrice = yesAsk !== null || noAsk !== null;
      const label = cleanLabel(line);

      if (!hasPrice) {
        // A line with no price is probably the outcome name for the next price line.
        if (label.length >= 2 && !pct) pendingLabel = label;
        else if (pct && outcomes.length === 0) pendingLabel = label || pendingLabel;
        continue;
      }

      const finalLabel = label.length >= 2 ? label : (pendingLabel || `Outcome ${outcomes.length + 1}`);
      const valid = v => (v !== null && v >= 1 && v <= 99 ? v : null);
      outcomes.push({
        label: finalLabel,
        yesAsk: valid(yesAsk),
        noAsk: valid(noAsk),
        chancePct: pct ? Math.min(100, +pct[1]) : null,
        yourYesProb: null,
      });
      pendingLabel = '';
    }

    // Merge a "Yes" line followed by a separate "No" line for the same outcome.
    const merged = [];
    for (const o of outcomes) {
      const prev = merged[merged.length - 1];
      if (prev && prev.noAsk === null && o.yesAsk === null && o.noAsk !== null) {
        prev.noAsk = o.noAsk;
        continue;
      }
      merged.push(o);
    }
    merged.forEach(o => { o.warn = checkReading(o); });
    return merged;
  }

  const api = {
    DEFAULT_FEE_RATE, feeCents, analyzeSide, rankOutcomes, overround,
    parseScreenshotText, brier, calibration, trackSummary, logLoss, maxDrawdown,
    entryCost, reasonsToSkip, checkReading,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KatyMath = api;
})(typeof self !== 'undefined' ? self : this);
