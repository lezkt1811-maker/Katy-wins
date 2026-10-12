# KATY WINS

Free tool for Kalshi prediction markets. Upload a screenshot (or pull live prices) and see, for every Yes and No:

- what it costs **with Kalshi's fee**
- what you get back if it wins
- the chance it **needs** to win just to break even
- if you add **your own %**, the expected profit, with every bet ranked best to worst

Everything is free. There's no API key, no account, and no paid service. Screenshots are read **on your own phone or computer** and never uploaded anywhere.

## Use it

**Web app (phone or computer):** https://lezkt1811-maker.github.io/Katy-wins/

1. **Screenshots tab.** Tap the pink box and pick one or more Kalshi screenshots (or paste one). Tap **READ SCREENSHOTS**.
2. **Check the numbers.** Fix any digit the reader got wrong. Prices are the **Buy** prices.
3. **Add YOUR %** for any outcome you have an opinion on (your chance it's a YES).
4. Set your **stake per bet** and **how unsure** you are (± points). **Best options** ranks every side by the *cautious* expected return: if you say 70% ± 5, it uses 65%, so shaky edges sink.
5. Tap **SAVE PICK** on anything you bet (or would have bet). When it settles, mark **WON** or **LOST**. **Track record** then shows your net profit, your accuracy vs. the market's (Brier score), and calibration: when you said 60–80%, how often you were right. After about 30 settled picks this tells you whether you really have an edge. Picks are stored only in your browser; use **EXPORT CSV** to keep a copy.

The **Live Kalshi** tab can pull current prices from a market link or ticker. Some browsers block that request; if yours does, use screenshots or the scanner below.

## Why "highest chance" isn't "best bet"

A contract at 95¢ wins often but risks 95¢ to make 5¢. One loss erases 19 wins. A screenshot shows the **market's** odds, and on their own those always look about fair, minus fees. A bet only has value when **your** chance is higher than the break-even chance. Katy Wins shows market-only odds separately and won't call them "best."

## Fee math

Kalshi's general trading fee is `ceil(0.07 × contracts × price × (1 − price))`, rounded up to the next cent, with price in dollars. Some product families use a different rate, so you can change **FEE RATE** in the app or pass `--fee-rate` to the scanner.

## Live scanner (optional, for a computer)

Needs Python 3.9+.

```bash
pip install -r requirements.txt
python scan.py --event KXHIGHCHI-26OCT12          # one event
python scan.py --series KXHIGHCHI --stake 25      # every open event in a series
python scan.py --event KXHIGHCHI-26OCT12 --probs my_odds.csv --uncertainty 5
python scan.py --series KXHIGHCHI --min-volume 100 --max-spread 6 --hide-flagged
```

The scanner flags wide bid-ask spreads, missing bids (stale prices), and thin volume, so you don't trust a price you can't actually get. Add `--hide-flagged` to drop them.

`my_odds.csv` holds your own YES chances:

```csv
ticker,prob
KXHIGHCHI-26OCT12-B85.5,48
```

The event ticker is the last part of a Kalshi market link.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `app.js` | The web app (screenshot upload, table, results) |
| `katy-math.js` | Fee math, break-even, ranking, screenshot text parsing |
| `scan.py`, `scanner/` | Command-line live scanner using Kalshi's public API |
| `tests/` | `node tests/math.test.js` and `pytest tests` |

## Turn on the free website (one time)

GitHub → this repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch **main**, folder **/ (root)** → Save. The link above goes live in about a minute.

---

**Not financial advice.** Prediction markets can lose your whole stake. Prices move fast, so check the live price on Kalshi before buying.
