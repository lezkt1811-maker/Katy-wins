/* Katy Wins — page logic. Math lives in katy-math.js. */
(function () {
  'use strict';
  const M = window.KatyMath;
  const $ = s => document.querySelector(s);
  const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

  const state = { shots: [], rows: [] };
  try {
    const saved = JSON.parse(localStorage.getItem('katywins.rows') || '[]');
    if (Array.isArray(saved)) state.rows = saved;
  } catch (e) { /* storage unavailable: start empty */ }
  const save = () => { try { localStorage.setItem('katywins.rows', JSON.stringify(state.rows)); } catch (e) {} };
  state.track = [];
  try {
    const t = JSON.parse(localStorage.getItem('katywins.track') || '[]');
    if (Array.isArray(t)) state.track = t;
  } catch (e) { /* storage unavailable */ }
  const saveTrack = () => { try { localStorage.setItem('katywins.track', JSON.stringify(state.track)); } catch (e) {} };

  // ---------- tabs ----------
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === t));
    ['shots', 'live', 'research', 'how'].forEach(n => $('#tab-' + n).classList.toggle('hidden', n !== t.dataset.tab));
  }));

  // ---------- screenshot upload ----------
  const drop = $('#drop'), fileIn = $('#file');
  drop.addEventListener('click', () => fileIn.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener('change', () => { addFiles(fileIn.files); fileIn.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  window.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
    if (files.length) addFiles(files);
  });

  function addFiles(list) {
    for (const f of list) {
      if (!f || !f.type.startsWith('image/')) continue;
      state.shots.push({ file: f, url: URL.createObjectURL(f), status: 'ready', done: false });
    }
    renderShots();
  }
  function renderShots() {
    const box = $('#thumbs');
    box.innerHTML = '';
    state.shots.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = `<img alt="Screenshot ${i + 1}"><span class="st"></span><button class="x" aria-label="Remove">×</button>`;
      d.querySelector('img').src = s.url;
      d.querySelector('.st').textContent = s.status;
      d.querySelector('.x').onclick = () => { URL.revokeObjectURL(s.url); state.shots.splice(i, 1); renderShots(); };
      box.appendChild(d);
    });
    $('#readBtn').disabled = !state.shots.some(s => !s.done || s.status === 'couldn\'t read');
  }
  $('#clearShots').onclick = () => { state.shots.forEach(s => URL.revokeObjectURL(s.url)); state.shots = []; renderShots(); };

  // Grayscale + invert dark mode + boost contrast. Small images are enlarged, but
  // big phone screenshots are shrunk to 1600px wide: enlarging a 1080x2400
  // screenshot made a canvas too big for phone memory and crashed the reader.
  function prepImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = img.width < 800 ? 2 : img.width > 1600 ? 1600 / img.width : 1;
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114;
        const darkBg = sum / (px.length / 4) < 128;
        for (let i = 0; i < px.length; i += 4) {
          let y = px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114;
          if (darkBg) y = 255 - y;                       // dark mode -> dark text on light
          y = Math.max(0, Math.min(255, (y - 128) * 1.6 + 128));
          px[i] = px[i + 1] = px[i + 2] = y;
        }
        g.putImageData(d, 0, 0);
        res(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image could not be opened')); };
      img.src = url;
    });
  }

  let worker = null;
  async function getWorker(bar) {
    if (worker) return worker;
    $('#ocrNote').textContent = 'Loading the free text-reader (first time only)…';
    worker = await Tesseract.createWorker('eng', 1, {
      logger: m => { if (m.status === 'recognizing text') bar.style.width = Math.round(m.progress * 100) + '%'; },
    });
    return worker;
  }

  $('#readBtn').onclick = async () => {
    const btn = $('#readBtn'), prog = $('#prog'), bar = prog.firstElementChild, note = $('#ocrNote');
    btn.disabled = true; prog.style.display = 'block';
    const rawTexts = [];
    let found = 0, failed = 0, dupes = 0;
    try {
      if (typeof Tesseract === 'undefined') throw new Error('offline');
      await getWorker(bar);
    } catch (err) {
      console.error(err);
      note.textContent = navigator.onLine === false
        ? 'You\'re offline. The text-reader downloads once (about 10 MB), so connect and try again. You can still type prices in below.'
        : 'The text-reader didn\'t load. Refresh the page and try again. You can still type prices in below.';
      note.className = 'note warn';
      prog.style.display = 'none'; renderShots();
      return;
    }
    for (const s of state.shots.filter(x => !x.done || x.status === 'couldn\'t read')) {
      try {
        s.status = 'reading…'; renderShots(); bar.style.width = '0';
        const canvas = await prepImage(s.file);
        // tsv = word positions, used to rebuild rows the way they look on screen.
        const { data } = await worker.recognize(canvas, {}, { text: true, tsv: true });
        canvas.width = canvas.height = 0;            // free memory before the next image
        const rowsText = data.tsv ? M.rowsFromTsv(data.tsv) : '';
        let outs = rowsText ? M.parseScreenshotText(rowsText) : [];
        if (!outs.length) outs = M.parseScreenshotText(data.text || '');
        rawTexts.push(rowsText || data.text || '');
        // Overlapping screenshots repeat outcomes; skip exact duplicates.
        const key = r => `${String(r.label).toLowerCase()}|${r.yes}|${r.no}`;
        const have = new Set(state.rows.map(key));
        let added = 0;
        outs.forEach(o => {
          const row = { label: o.label, yes: o.yesAsk ?? '', no: o.noAsk ?? '', mine: '', chance: o.chancePct, warn: o.warn };
          if (have.has(key(row))) return;
          have.add(key(row)); state.rows.push(row); added++;
        });
        found += added;
        dupes += outs.length - added;
        s.status = outs.length ? (added ? `✓ ${added} found` : '✓ already added') : 'no prices found';
      } catch (err) {
        console.error(err);
        failed++;
        s.status = 'couldn\'t read';
        // A crashed worker can't be reused; start a fresh one for the next image.
        try { await worker.terminate(); } catch (e) {}
        worker = null;
        try { await getWorker(bar); } catch (e) { break; }
      }
      s.done = true;
      renderShots();
    }
    let msg = found
      ? `Found ${found} new outcome${found > 1 ? 's' : ''}. Check them below; rows marked ⚠ need a look. Missing prices are left blank, never guessed.`
      : dupes
      ? `Everything in ${dupes > 1 ? 'these screenshots is' : 'this screenshot is'} already in your table below, so nothing new was added.`
      : 'No prices recognized. Screens that show a market\'s price list work best: Yes/No buttons, or payouts like "1.76x 54%". You can also type prices in below.';
    if (found && dupes) msg += ` ${dupes} already in the table were skipped.`;
    if (failed) msg += ` ${failed} screenshot${failed > 1 ? 's' : ''} couldn't be read; try ${failed > 1 ? 'them' : 'it'} again alone.`;
    note.textContent = msg;
    note.className = (found || dupes) && !failed ? 'note' : 'note warn';
    prog.style.display = 'none';
    if (rawTexts.length) { $('#raw').textContent = rawTexts.join('\n\n———\n\n'); $('#rawBox').classList.remove('hidden'); }
    renderShots(); save(); renderTable(); compute();
  };

  // ---------- research links ----------
  const nwsUrl = city => 'https://forecast.weather.gov/zipcity.php?inputstring=' + encodeURIComponent(city);
  let cities = ['College Station, TX', 'Las Vegas, NV', 'Kansas City, MO'];
  try {
    const c = JSON.parse(localStorage.getItem('katywins.cities') || 'null');
    if (Array.isArray(c)) cities = c;
  } catch (e) { /* storage unavailable: use defaults */ }
  const saveCities = () => { try { localStorage.setItem('katywins.cities', JSON.stringify(cities)); } catch (e) {} };
  function renderCities() {
    const box = $('#cityChips');
    box.innerHTML = '';
    if (!cities.length) { box.innerHTML = '<span class="note">No saved cities yet.</span>'; return; }
    cities.forEach(c => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const a = document.createElement('a');
      a.href = nwsUrl(c); a.target = '_blank'; a.rel = 'noopener'; a.textContent = c;
      const x = document.createElement('button');
      x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + c);
      x.onclick = () => { cities = cities.filter(v => v !== c); saveCities(); renderCities(); };
      chip.append(a, x);
      box.appendChild(chip);
    });
  }
  $('#cityGo').onclick = () => {
    const c = $('#cityIn').value.trim();
    if (c) window.open(nwsUrl(c), '_blank', 'noopener');
  };
  $('#cityIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#cityGo').click(); });
  $('#citySave').onclick = () => {
    const c = $('#cityIn').value.trim();
    if (c && !cities.some(v => v.toLowerCase() === c.toLowerCase())) { cities.push(c); saveCities(); renderCities(); }
    $('#cityIn').value = '';
  };
  renderCities();

  // ---------- live Kalshi ----------
  function tickerFrom(input) {
    const s = input.trim();
    if (!s) return '';
    try {
      const u = new URL(s.startsWith('http') ? s : 'https://' + s);
      if (u.hostname.includes('kalshi')) {
        const parts = u.pathname.split('/').filter(Boolean);
        return (parts[parts.length - 1] || '').toUpperCase();
      }
    } catch (e) { /* not a URL */ }
    return s.toUpperCase();
  }
  const cents = M.priceCents;
  // Add live rows at Buy prices, stamped with the time they were fetched.
  function addLiveRows(list, fetchedAt) {
    list.forEach(m => state.rows.push({ label: m.label, yes: m.yes || '', no: m.no || '', mine: '', fetchedAt }));
    save(); renderTable(); compute();
  }
  $('#liveBtn').onclick = async () => {
    const t = tickerFrom($('#ticker').value), note = $('#liveNote');
    if (!t) { note.textContent = 'Paste a link or ticker first.'; return; }
    note.className = 'note'; note.textContent = 'Fetching ' + t + '…';
    try {
      let markets = [];
      let r = await fetch(`${KALSHI_API}/markets?event_ticker=${encodeURIComponent(t)}&status=open&limit=200`);
      if (r.ok) markets = (await r.json()).markets || [];
      if (!markets.length) {
        r = await fetch(`${KALSHI_API}/markets/${encodeURIComponent(t)}`);
        if (r.ok) { const j = await r.json(); if (j.market) markets = [j.market]; }
      }
      if (!markets.length) { note.className = 'note warn'; note.textContent = 'No open markets found for ' + t + '. Check the ticker.'; return; }
      const fetchedAt = Date.now();
      addLiveRows(markets.map(m => {
        const yesBid = cents(m, 'yes_bid');
        // Buying NO = selling YES, so NO's ask is 100 - YES bid when Kalshi doesn't list it.
        return {
          label: m.yes_sub_title || m.subtitle || m.title || m.ticker,
          yes: cents(m, 'yes_ask'), no: cents(m, 'no_ask') || (yesBid ? 100 - yesBid : null),
        };
      }), fetchedAt);
      note.textContent = `Added ${markets.length} market${markets.length > 1 ? 's' : ''} at Buy prices as of ${new Date(fetchedAt).toLocaleTimeString()}. Prices move; refresh before buying.`;
    } catch (err) {
      note.className = 'note warn';
      note.textContent = 'Your browser blocked the direct request to Kalshi. Use screenshots instead, or run the free scanner.py on a computer (see README).';
    }
  };

  // ---------- browse a series' open games ----------
  $('#browseBtn').onclick = async () => {
    const s = $('#series').value.trim().toUpperCase(), note = $('#browseNote'), box = $('#gameList');
    box.innerHTML = '';
    if (!s) { note.className = 'note warn'; note.textContent = 'Enter a series ticker first.'; return; }
    note.className = 'note'; note.textContent = 'Loading open games in ' + s + '…';
    let games;
    try {
      const r = await fetch(`${KALSHI_API}/events?series_ticker=${encodeURIComponent(s)}&status=open&with_nested_markets=true&limit=100`);
      if (!r.ok) { note.className = 'note warn'; note.textContent = 'Kalshi returned ' + r.status + ' for ' + s + '. Check the series ticker.'; return; }
      games = M.marketsFromEvents((await r.json()).events);
    } catch (err) {
      note.className = 'note warn';
      note.textContent = 'Your browser blocked the request to Kalshi. Use screenshots instead, or run the free scanner.py on a computer (see README).';
      return;
    }
    if (!games.length) { note.className = 'note warn'; note.textContent = 'No open games found in ' + s + '.'; return; }
    note.textContent = `${games.length} open game${games.length > 1 ? 's' : ''} in ${s}. Buy prices shown; add the ones you want to the table.`;
    games.forEach(g => {
      const vol = g.markets.reduce((a, m) => a + m.volume, 0);
      const close = g.markets.map(m => m.close).filter(Boolean).sort()[0];
      const div = document.createElement('div');
      div.className = 'game';
      div.innerHTML = `<div class="gh"><strong></strong><button class="btn cyan">ADD TO TABLE</button></div><div class="gm"></div><ul></ul>`;
      div.querySelector('strong').textContent = g.title;
      div.querySelector('.gm').textContent = `${vol.toLocaleString()} contracts traded` + (close ? ' · closes ' + new Date(close).toLocaleString() : '');
      const ul = div.querySelector('ul');
      g.markets.forEach(m => {
        const li = document.createElement('li'), name = document.createElement('span'), px = document.createElement('span');
        name.textContent = m.label;
        px.textContent = `YES ${m.yes ?? '—'}¢ · NO ${m.no ?? '—'}¢`;
        li.append(name, px);
        ul.appendChild(li);
      });
      div.querySelector('button').onclick = () => {
        addLiveRows(g.markets.map(m => ({ label: m.label, yes: m.yes, no: m.no })), Date.now());
        note.textContent = 'Added ' + g.title + ' to the table.';
      };
      box.appendChild(div);
    });
  };

  // ---------- table ----------
  function renderTable() {
    const tb = $('#tbody');
    tb.innerHTML = '';
    state.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="lbl" data-h="OUTCOME"><input data-k="label" placeholder="Outcome name"></td>
        <td class="num" data-h="YES ¢"><input data-k="yes" type="number" min="1" max="99" inputmode="numeric"></td>
        <td class="num" data-h="NO ¢"><input data-k="no" type="number" min="1" max="99" inputmode="numeric"></td>
        <td class="num" data-h="YOUR %"><input data-k="mine" type="number" min="0" max="100" inputmode="decimal" placeholder="optional"></td>
        <td><button class="del" aria-label="Delete row">✕</button></td>`;
      const lbl = tr.querySelector('td.lbl');
      const wn = document.createElement('div');
      wn.className = 'rowwarn';
      lbl.appendChild(wn);
      const showWarn = () => {
        const w = r.warn || [];
        wn.textContent = w.length ? '⚠ ' + w.join(' · ') : '';
        if (r.fetchedAt) wn.textContent += (w.length ? ' · ' : '') + 'live @ ' + new Date(r.fetchedAt).toLocaleTimeString();
      };
      showWarn();
      tr.querySelectorAll('input').forEach(inp => {
        inp.value = r[inp.dataset.k] ?? '';
        inp.addEventListener('input', () => {
          r[inp.dataset.k] = inp.value;
          if (r.warn && inp.dataset.k !== 'mine') {
            // Re-check once she edits a misread row.
            r.warn = M.checkReading({ label: r.label, yesAsk: +r.yes || null, noAsk: +r.no || null, chancePct: r.chance ?? null });
            showWarn();
          }
          if (inp.dataset.k !== 'mine' && r.fetchedAt) { delete r.fetchedAt; showWarn(); } // edited = no longer live
          save(); compute();
        });
      });
      tr.querySelector('.del').onclick = () => { state.rows.splice(i, 1); save(); renderTable(); compute(); };
      tb.appendChild(tr);
    });
  }
  $('#addRow').onclick = () => { state.rows.push({ label: '', yes: '', no: '', mine: '' }); renderTable(); compute(); };
  $('#clearRows').onclick = () => {
    if (state.rows.length && confirm('Remove every row from the table?')) { state.rows = []; save(); renderTable(); compute(); }
  };
  // Fills only the YOUR % boxes that are blank; numbers already typed stay as they are.
  $('#fillBlank').onclick = () => {
    const pct = parseFloat($('#fillPct').value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
    state.rows.forEach(r => { if (r.mine === '' || r.mine == null) r.mine = String(pct); });
    save(); renderTable(); compute();
  };
  $('#stake').addEventListener('input', compute);
  $('#feeRate').addEventListener('input', compute);
  $('#unsure').addEventListener('input', compute);
  try { $('#category').value = localStorage.getItem('katywins.category') || ''; } catch (e) {}
  $('#category').addEventListener('input', () => { try { localStorage.setItem('katywins.category', $('#category').value); } catch (e) {} });

  // ---------- results ----------
  const $$ = c => '$' + (c / 100).toFixed(2);
  const pct = x => (x * 100).toFixed(1) + '%';

  // Most contracts you can buy with the stake, fee included.
  function contractsFor(stakeCents, price, rate) {
    let n = Math.floor(stakeCents / price);
    while (n > 0 && price * n + M.feeCents(price, n, rate) > stakeCents) n--;
    return Math.max(1, n);
  }

  function compute() {
    const stakeCents = Math.max(100, (parseFloat($('#stake').value) || 10) * 100);
    const rateIn = parseFloat($('#feeRate').value);
    const rate = Number.isFinite(rateIn) && rateIn >= 0 ? rateIn : 0.07;
    const uIn = parseFloat($('#unsure').value);
    const uncertainty = Number.isFinite(uIn) && uIn > 0 ? Math.min(uIn, 50) / 100 : 0;
    const outcomes = state.rows
      .map(r => ({
        label: (r.label || '').trim() || 'Unnamed',
        yesAsk: +r.yes >= 1 && +r.yes <= 99 ? +r.yes : null,
        noAsk: +r.no >= 1 && +r.no <= 99 ? +r.no : null,
        yourYesProb: r.mine !== '' && +r.mine >= 0 && +r.mine <= 100 ? +r.mine / 100 : null,
      }))
      .filter(o => o.yesAsk || o.noAsk);

    const box = $('#results');
    box.innerHTML = '';
    const over = M.overround(outcomes);
    const on = $('#overNote');
    // Only meaningful for outcomes of ONE event (exactly one can win). A sum far above
    // 100 means the rows are separate markets, so the note would mislead.
    if (over && over > 100 && over <= 130 && outcomes.length > 2) {
      on.textContent = `YES prices add up to ${over}¢ across ${outcomes.length} outcomes, so the market keeps about ${over - 100}¢ per full set (only valid if exactly one outcome can win).`;
      on.classList.remove('hidden');
    } else on.classList.add('hidden');

    if (!outcomes.length) { box.innerHTML = '<p class="note">Upload a screenshot or add a row to see results.</p>'; return; }

    // Analyse each side at the number of contracts the stake buys.
    const sides = [];
    // Rows flagged misread (⚠) are never ranked: a garbled price would look like a bet.
    const trusted = outcomes.filter(o => !(o.warn || []).length);
    const skippedMisread = outcomes.length - trusted.length;
    for (const o of trusted) {
      [['YES', o.yesAsk, o.yourYesProb], ['NO', o.noAsk, o.yourYesProb === null ? null : 1 - o.yourYesProb]].forEach(([side, price, p]) => {
        if (!price) return;
        const a = M.analyzeSide(price, p, { contracts: contractsFor(stakeCents, price, rate), feeRate: rate, uncertainty });
        if (a) sides.push(Object.assign({ label: o.label, side, feeRate: rate }, a));
      });
    }
    // Ranked by the cautious end of your range, so shaky edges sink.
    const valued = sides.filter(s => s.roi !== null).sort((a, b) => b.consRoi - a.consRoi);
    // Market-only rows: sorted by price, not by chance, so a 1¢ long shot never reads as "best".
    const market = sides.filter(s => s.roi === null).sort((a, b) => b.marketProb - a.marketProb);

    // Verdict first: the tool's main job is telling her when NOT to bet.
    const ages = state.rows.filter(r => r.fetchedAt).map(r => Date.now() - r.fetchedAt);
    const track = M.trackSummary(state.track);
    const skip = M.reasonsToSkip({
      anyYourProb: valued.length > 0,
      anyCautiousPositive: valued.some(v => v.consEvCents > 0),
      anyBestGuessPositive: valued.some(v => v.evCents > 0),
      uncertainRows: state.rows.filter(r => (r.warn || []).length).length,
      staleMinutes: ages.length ? Math.floor(Math.max(...ages) / 60000) : null,
      settledPicks: track.settled, brierYou: track.brierYou, brierMarket: track.brierMarket,
    });
    if (skippedMisread) skip.push(`${skippedMisread} misread row${skippedMisread === 1 ? ' was' : 's were'} left out of the ranking. Fix ⚠ rows to include them.`);
    const cautiousPos = valued.some(v => v.consEvCents > 0);
    const head = !valued.length ? 'NO RECOMMENDATION'
      : !cautiousPos ? 'SKIP: NO VALUE BET RIGHT NOW'
      : skip.length ? 'POSSIBLE VALUE, WITH WARNINGS' : 'STRONGEST CANDIDATE BELOW';
    const vb = document.createElement('div');
    vb.className = 'pick ' + (!cautiousPos ? 'bad' : skip.length ? 'warnbox' : '');
    vb.innerHTML = `<h3>${head}</h3>`;
    if (skip.length) {
      const ul = document.createElement('ul');
      ul.className = 'reasons';
      skip.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      vb.appendChild(ul);
    } else {
      vb.insertAdjacentHTML('beforeend', '<p class="note" style="margin:0">No red flags found. The #1 pick is the strongest candidate under your numbers, not a sure thing.</p>');
    }
    box.appendChild(vb);

    if (valued.length) {
      valued.forEach((s, i) => box.appendChild(card(s, i + 1, s.consEvCents > 0 ? '' : 'bad')));
    }
    if (market.length) {
      box.insertAdjacentHTML('beforeend', `<p class="note" style="margin:6px 0 0">${valued.length ? 'No YOUR % entered for these, so they show market odds only:' : 'These are the <b>market\'s</b> odds only. Add YOUR % to rank by value; high chance is not the same as a good bet.'}</p>`);
      market.forEach(s => box.appendChild(card(s, null, 'mkt')));
    }
  }

  function card(s, rank, cls) {
    const d = document.createElement('div');
    d.className = 'pick ' + (cls || '');
    const h = document.createElement('h3');
    h.innerHTML = (rank ? `<span class="rank">#${rank}</span>` : '') + `<span class="side ${s.side}">${s.side}</span>`;
    h.appendChild(document.createTextNode(s.label));
    d.appendChild(h);
    const stats = [
      ['Buy at', s.priceCents + '¢ × ' + s.contracts],
      ['Total cost (with fee)', $$(s.totalCost) + ` <small>(fee ${$$(s.totalFee)})</small>`],
      ['You get if it wins', $$(100 * s.contracts), 'good'],
      ['Profit if it wins', $$(s.profitIfWin), s.profitIfWin > 0 ? 'good' : 'neg'],
      ['Need it to happen', pct(s.breakEven)],
      ['Market says', pct(s.marketProb)],
    ];
    if (s.yourProb !== null) {
      stats.push(['You say', pct(s.yourProb)]);
      stats.push(['Expected profit', (s.evCents >= 0 ? '+' : '−') + $$(Math.abs(s.evCents)), s.evCents > 0 ? 'good' : 'neg']);
      stats.push(['Return per $1', (s.roi >= 0 ? '+' : '') + (s.roi * 100).toFixed(1) + '%', s.roi > 0 ? 'good' : 'neg']);
      if (s.consProb !== s.yourProb) {
        stats.push(['Cautious chance', pct(s.consProb)]);
        stats.push(['Cautious profit', (s.consEvCents >= 0 ? '+' : '−') + $$(Math.abs(s.consEvCents)), s.consEvCents > 0 ? 'good' : 'neg']);
      }
    }
    const g = document.createElement('div');
    g.className = 'stats';
    g.innerHTML = stats.map(([k, v, c]) => `<div class="stat"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
    d.appendChild(g);
    if (s.yourProb !== null) {
      const b = document.createElement('button');
      b.className = 'mini save';
      b.textContent = 'SAVE PICK TO TRACK RECORD';
      b.onclick = () => {
        state.track.unshift({
          id: Date.now() + Math.random(), date: new Date().toISOString().slice(0, 10),
          label: s.label, side: s.side, price: s.priceCents, contracts: s.contracts,
          totalCost: s.totalCost, prob: s.yourProb, marketProb: s.marketProb, won: null,
          category: ($('#category').value || '').trim(), kind: 'prediction', fillPrice: null, feeRate: s.feeRate,
        });
        saveTrack(); renderTrack();
        b.textContent = 'SAVED ✓'; b.disabled = true;
      };
      d.appendChild(b);
    }
    return d;
  }

  // ---------- track record ----------
  const money = c => (c >= 0 ? '+' : '−') + $$(Math.abs(c));
  const signCls = v => (v > 0 ? 'good' : v < 0 ? 'neg' : '');
  const statGrid = rows => {
    const g = document.createElement('div');
    g.className = 'stats';
    g.innerHTML = rows.map(([k, v, c]) => `<div class="stat"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
    return g;
  };

  function renderTrack() {
    const box = $('#track');
    box.innerHTML = '';
    if (!state.track.length) {
      box.innerHTML = '<p class="note">No picks saved yet. Enter YOUR % on an outcome and tap SAVE PICK on its card.</p>';
      return;
    }
    const s = M.trackSummary(state.track);
    const f3 = v => (v === null ? '-' : v.toFixed(3));
    box.appendChild(statGrid([
      ['Settled', `${s.settled} <small>(${s.open} open)</small>`],
      ['Won', s.settled ? `${s.wins} / ${s.settled}` : '-'],
      ['Net profit', s.settled ? money(s.pnlCents) : '-', signCls(s.pnlCents)],
      ['Return on staked', s.returnPct === null ? '-' : (s.returnPct * 100).toFixed(1) + '%', signCls(s.returnPct)],
      ['Expected (your %)', s.settled ? money(Math.round(s.expectedCents)) : '-'],
      ['Worst drop (drawdown)', s.settled ? '−' + $$(s.maxDrawdownCents) : '-', s.maxDrawdownCents > 0 ? 'neg' : ''],
      ['Brier: you / market', `${f3(s.brierYou)} / ${f3(s.brierMarket)}`],
      ['Log loss: you / market', `${f3(s.logLossYou)} / ${f3(s.logLossMarket)}`],
    ]));

    let verdict;
    if (s.settled < 30) verdict = `Only ${s.settled} settled pick${s.settled === 1 ? '' : 's'}: far too few to tell skill from luck.`;
    else if (s.settled < 200) verdict = (s.brierYou < s.brierMarket
      ? 'So far your probabilities beat the market\'s. Encouraging, but '
      : 'So far the market\'s prices beat your probabilities. Bet smaller or not at all; ') + `${s.settled} picks is an early checkpoint, not proof. Hundreds are needed.`;
    else verdict = s.brierYou < s.brierMarket
      ? `Across ${s.settled} picks your probabilities beat the market's. That's real evidence of an edge. Keep checking it holds.`
      : `Across ${s.settled} picks the market has been more accurate than you. The evidence says you don't have an edge here.`;
    box.insertAdjacentHTML('beforeend', `<p class="note">${verdict} Lower Brier and log loss = more accurate (coin-flip guessing scores 0.250 and 0.693). "Expected" is what your % predicted you'd make; if actual profit keeps falling short, your % runs too high.</p>`);

    if (s.trades) {
      box.insertAdjacentHTML('beforeend', '<p class="note" style="margin-bottom:0"><b>Real trades only</b> (picks marked REAL, using the price you actually paid):</p>');
      box.appendChild(statGrid([
        ['Settled', s.trades.n], ['Net profit', money(s.trades.pnlCents), signCls(s.trades.pnlCents)],
        ['Return on staked', (s.trades.returnPct * 100).toFixed(1) + '%', signCls(s.trades.returnPct)],
      ]));
    }

    const cal = document.createElement('div');
    cal.className = 'calib';
    cal.innerHTML = s.calibration.map(b =>
      `<div>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%<b>${b.n ? Math.round(b.actual * 100) + '%' : '-'}</b>won · ${b.n}</div>`).join('');
    box.insertAdjacentHTML('beforeend', '<p class="note" style="margin-bottom:0">Calibration: when you said this range, how often it actually won. Bands with under 10 picks are mostly noise.</p>');
    box.appendChild(cal);

    if (s.byCategory.length > 1 || (s.byCategory[0] && s.byCategory[0].category !== 'Uncategorized')) {
      const t = document.createElement('table');
      t.className = 'tbl cat';
      t.innerHTML = '<thead><tr><th>CATEGORY</th><th>PICKS</th><th>PROFIT</th><th>BRIER YOU / MKT</th></tr></thead>';
      const tb = document.createElement('tbody');
      s.byCategory.forEach(c => {
        const tr = document.createElement('tr');
        const td = document.createElement('td'); td.textContent = c.category; tr.appendChild(td);
        tr.insertAdjacentHTML('beforeend', `<td>${c.n} <small>(${c.wins} won)</small></td><td class="${signCls(c.pnlCents)}">${money(c.pnlCents)}</td><td>${f3(c.brierYou)} / ${f3(c.brierMarket)}</td>`);
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      box.insertAdjacentHTML('beforeend', '<p class="note" style="margin-bottom:0">By category: where your edge is (or isn\'t).</p>');
      box.appendChild(t);
    }

    state.track.forEach(e => {
      const it = document.createElement('div');
      it.className = 'tr-item';
      const what = document.createElement('div');
      what.className = 'what';
      what.innerHTML = `<span class="side ${e.side}">${e.side}</span>`;
      what.appendChild(document.createTextNode(e.label));
      const sm = document.createElement('small');
      const paid = e.fillPrice ? ` · paid ${e.fillPrice}¢` : '';
      sm.textContent = `${e.date}${e.category ? ' · ' + e.category : ''} · ${e.contracts} @ ${e.price}¢${paid} · cost ${$$(M.entryCost(e))} · you ${pct(e.prob)} · market ${pct(e.marketProb)}`;
      what.appendChild(sm);
      it.appendChild(what);
      const btns = document.createElement('div');
      btns.className = 'row';
      const kind = document.createElement('button');
      kind.className = 'mini kind' + (e.kind === 'trade' ? ' on' : '');
      kind.textContent = e.kind === 'trade' ? 'REAL' : 'PAPER';
      kind.title = 'PAPER = a prediction you tracked. REAL = you actually bought it.';
      kind.onclick = () => { e.kind = e.kind === 'trade' ? 'prediction' : 'trade'; saveTrack(); renderTrack(); };
      btns.appendChild(kind);
      if (e.kind === 'trade') {
        const fill = document.createElement('input');
        fill.type = 'number'; fill.min = 1; fill.max = 99; fill.className = 'fill';
        fill.placeholder = 'paid ¢'; fill.title = 'Price you actually paid per contract';
        fill.value = e.fillPrice ?? '';
        fill.addEventListener('change', () => { const v = +fill.value; e.fillPrice = v >= 1 && v <= 99 ? v : null; saveTrack(); renderTrack(); });
        btns.appendChild(fill);
      }
      [['WON', true, 'won'], ['LOST', false, 'lost']].forEach(([t, v, c]) => {
        const b = document.createElement('button');
        b.className = `mini ${c}` + (e.won === v ? ' on' : '');
        b.textContent = t;
        b.onclick = () => { e.won = e.won === v ? null : v; saveTrack(); renderTrack(); compute(); };
        btns.appendChild(b);
      });
      const rm = document.createElement('button');
      rm.className = 'mini rm'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove pick');
      rm.onclick = () => { state.track = state.track.filter(x => x !== e); saveTrack(); renderTrack(); compute(); };
      btns.appendChild(rm);
      it.appendChild(btns);
      box.appendChild(it);
    });
  }

  // ---------- backup, export, restore ----------
  const CSV_HEAD = ['date', 'outcome', 'side', 'price_cents', 'contracts', 'total_cost_cents', 'your_prob', 'market_prob',
    'result', 'category', 'kind', 'fill_price_cents', 'fee_rate'];
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#clearTrack').onclick = () => {
    if (state.track.length && confirm('Delete your whole track record? Export a backup first if you want to keep it.')) {
      state.track = []; saveTrack(); renderTrack(); compute();
    }
  };
  $('#exportTrack').onclick = () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = state.track.map(e => [e.date, q(e.label), e.side, e.price, e.contracts, e.totalCost, e.prob, e.marketProb,
      e.won === null ? 'open' : e.won ? 'won' : 'lost', q(e.category || ''), e.kind || 'prediction', e.fillPrice ?? '', e.feeRate ?? ''].join(','));
    download('katy-wins-track-record.csv', [CSV_HEAD.join(','), ...lines].join('\n'), 'text/csv');
  };

  // Minimal CSV reader for our own export (quoted fields, doubled quotes).
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length > 1);
  }
  $('#restoreTrack').onclick = () => $('#restoreFile').click();
  $('#restoreFile').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    try {
      const rows = parseCsv(await f.text());
      const h = rows.shift().map(x => x.trim());
      const idx = k => h.indexOf(k);
      if (idx('outcome') < 0 || idx('your_prob') < 0) throw new Error('not a Katy Wins CSV');
      const num = v => (v === '' || v == null ? null : +v);
      const loaded = rows.map((r, i) => ({
        id: Date.now() + i, date: r[idx('date')], label: r[idx('outcome')], side: r[idx('side')],
        price: num(r[idx('price_cents')]), contracts: num(r[idx('contracts')]), totalCost: num(r[idx('total_cost_cents')]),
        prob: num(r[idx('your_prob')]), marketProb: num(r[idx('market_prob')]),
        won: r[idx('result')] === 'won' ? true : r[idx('result')] === 'lost' ? false : null,
        category: idx('category') >= 0 ? r[idx('category')] : '', kind: idx('kind') >= 0 ? r[idx('kind')] || 'prediction' : 'prediction',
        fillPrice: idx('fill_price_cents') >= 0 ? num(r[idx('fill_price_cents')]) : null,
        feeRate: idx('fee_rate') >= 0 ? num(r[idx('fee_rate')]) ?? undefined : undefined,
      })).filter(e => e.label && e.prob != null && e.contracts > 0 && e.totalCost > 0);
      if (!loaded.length) throw new Error('no valid picks');
      const replace = state.track.length && confirm(`Restore ${loaded.length} picks.\nOK = replace your current ${state.track.length} picks\nCancel = add them to your current picks`);
      state.track = replace ? loaded : loaded.concat(state.track);
      saveTrack(); renderTrack(); compute();
    } catch (err) {
      alert('Could not restore that file: ' + err.message + '. Use a CSV exported from Katy Wins.');
    }
  });

  renderTable(); compute(); renderShots(); renderTrack();
})();
