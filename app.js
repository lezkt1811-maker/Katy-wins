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

  // ---------- tabs ----------
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === t));
    ['shots', 'live', 'how'].forEach(n => $('#tab-' + n).classList.toggle('hidden', n !== t.dataset.tab));
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
    $('#readBtn').disabled = !state.shots.some(s => !s.done);
  }
  $('#clearShots').onclick = () => { state.shots.forEach(s => URL.revokeObjectURL(s.url)); state.shots = []; renderShots(); };

  // Upscale + grayscale + boost contrast: phone screenshots of white-on-dark text read much better.
  function prepImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width < 1400 ? 2 : 1;
        const c = document.createElement('canvas');
        c.width = img.width * scale; c.height = img.height * scale;
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
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  let worker = null;
  $('#readBtn').onclick = async () => {
    const btn = $('#readBtn'), prog = $('#prog'), bar = prog.firstElementChild;
    btn.disabled = true; prog.style.display = 'block';
    const rawTexts = [];
    try {
      if (!worker) {
        $('#ocrNote').textContent = 'Loading the free text-reader…';
        worker = await Tesseract.createWorker('eng', 1, {
          logger: m => { if (m.status === 'recognizing text') bar.style.width = Math.round(m.progress * 100) + '%'; },
        });
      }
      let found = 0;
      for (const s of state.shots.filter(x => !x.done)) {
        s.status = 'reading…'; renderShots(); bar.style.width = '0';
        const canvas = await prepImage(s.file);
        const { data } = await worker.recognize(canvas);
        rawTexts.push(data.text);
        const outs = M.parseScreenshotText(data.text);
        outs.forEach(o => state.rows.push({ label: o.label, yes: o.yesAsk ?? '', no: o.noAsk ?? '', mine: '' }));
        found += outs.length;
        s.done = true; s.status = outs.length ? `✓ ${outs.length} found` : 'no prices found';
        renderShots();
      }
      $('#ocrNote').textContent = found
        ? `Found ${found} outcome${found > 1 ? 's' : ''}. Check the numbers below; the reader can misread a digit.`
        : 'No prices recognized. Try a sharper screenshot, crop to the price list, or type the prices in below.';
      $('#ocrNote').className = found ? 'note' : 'note warn';
    } catch (err) {
      console.error(err);
      $('#ocrNote').textContent = 'The text-reader could not load (needs internet the first time). You can still type prices in below.';
      $('#ocrNote').className = 'note warn';
    } finally {
      prog.style.display = 'none';
      if (rawTexts.length) { $('#raw').textContent = rawTexts.join('\n\n———\n\n'); $('#rawBox').classList.remove('hidden'); }
      renderShots(); save(); renderTable(); compute();
    }
  };

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
  const cents = (m, k) => {
    if (m[k] !== undefined && m[k] !== null && m[k] !== '') return Math.round(+m[k]);
    const d = m[k + '_dollars'];
    return d !== undefined && d !== null && d !== '' ? Math.round(parseFloat(d) * 100) : null;
  };
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
      markets.forEach(m => state.rows.push({
        label: m.yes_sub_title || m.subtitle || m.title || m.ticker,
        yes: cents(m, 'yes_ask') || '', no: cents(m, 'no_ask') || '', mine: '',
      }));
      note.textContent = `Added ${markets.length} market${markets.length > 1 ? 's' : ''} at current Buy prices.`;
      save(); renderTable(); compute();
    } catch (err) {
      note.className = 'note warn';
      note.textContent = 'Your browser blocked the direct request to Kalshi. Use screenshots instead, or run the free scanner.py on a computer (see README).';
    }
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
      tr.querySelectorAll('input').forEach(inp => {
        inp.value = r[inp.dataset.k] ?? '';
        inp.addEventListener('input', () => { r[inp.dataset.k] = inp.value; save(); compute(); });
      });
      tr.querySelector('.del').onclick = () => { state.rows.splice(i, 1); save(); renderTable(); compute(); };
      tb.appendChild(tr);
    });
  }
  $('#addRow').onclick = () => { state.rows.push({ label: '', yes: '', no: '', mine: '' }); renderTable(); compute(); };
  $('#stake').addEventListener('input', compute);
  $('#feeRate').addEventListener('input', compute);

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
    if (over && over > 100 && outcomes.length > 2) {
      on.textContent = `YES prices add up to ${over}¢ across ${outcomes.length} outcomes, so the market keeps about ${over - 100}¢ per full set (only valid if exactly one outcome can win).`;
      on.classList.remove('hidden');
    } else on.classList.add('hidden');

    if (!outcomes.length) { box.innerHTML = '<p class="note">Upload a screenshot or add a row to see results.</p>'; return; }

    // Analyse each side at the number of contracts the stake buys.
    const sides = [];
    for (const o of outcomes) {
      [['YES', o.yesAsk, o.yourYesProb], ['NO', o.noAsk, o.yourYesProb === null ? null : 1 - o.yourYesProb]].forEach(([side, price, p]) => {
        if (!price) return;
        const a = M.analyzeSide(price, p, { contracts: contractsFor(stakeCents, price, rate), feeRate: rate });
        if (a) sides.push(Object.assign({ label: o.label, side }, a));
      });
    }
    const valued = sides.filter(s => s.roi !== null).sort((a, b) => b.roi - a.roi);
    const market = sides.filter(s => s.roi === null).sort((a, b) => b.marketProb - a.marketProb);

    if (valued.length) {
      const best = valued[0];
      if (best.evCents <= 0) {
        box.insertAdjacentHTML('beforeend', `<div class="pick bad"><h3>NO VALUE BET RIGHT NOW</h3><p class="note" style="margin:0">With your chances and the fees, every option loses money on average. Skipping is the winning move here.</p></div>`);
      }
      valued.forEach((s, i) => box.appendChild(card(s, i + 1, s.evCents > 0 ? '' : 'bad')));
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
    }
    const g = document.createElement('div');
    g.className = 'stats';
    g.innerHTML = stats.map(([k, v, c]) => `<div class="stat"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
    d.appendChild(g);
    return d;
  }

  renderTable(); compute(); renderShots();
})();
