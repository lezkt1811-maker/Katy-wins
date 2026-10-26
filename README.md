# KATY WINS

Free tool for Kalshi prediction markets. Upload a screenshot (or pull live prices) and see, for every Yes and No:

- what it costs **with Kalshi's fee**
- what you get back if it wins
- the chance it **needs** to win just to break even
- if you add **your own %**, the expected profit, with every bet ranked best to worst

Everything is free. There's no API key, no account, and no paid service. Screenshots are read **on your own phone or computer** and never uploaded anywhere.

**Its main job is telling you when NOT to bet.** Every result opens with a verdict that lists any reason to skip: no probability of your own, an edge that disappears after fees or caution, misread prices, stale live prices, or a track record too short to prove anything. Often the right answer is zero bets.

Katy Wins does not claim to find profitable bets. It does the math honestly and helps you test whether *your* judgment beats the market.

## Use it

**Web app (phone or computer):** https://lezkt1811-maker.github.io/Katy-wins/

1. **Screenshots tab.** Tap the pink box and pick one or more Kalshi screenshots (or paste one). Tap **READ SCREENSHOTS**. It understands both kinds of Kalshi screen: market pages with **Yes 43¢ / No 59¢** buttons, and browse screens showing a payout and chance like **1.76x 54%** (the Yes price is worked out from the payout; No isn't shown there, so it's left blank). Overlapping screenshots won't add duplicates. The first read downloads the free text-reader once (about 10 MB).
2. **Check the numbers.** Rows that look misread are marked ⚠ (for example, Yes + No not adding up to about 100–110¢). Fix them, and the warning clears. Missing prices are left blank, never guessed. Prices are the **Buy** prices.
3. **Add YOUR %** for any outcome you have an opinion on (your chance it's a YES).
4. Set your **stake per bet** and **how unsure** you are (± points). **Best options** ranks every side by the *cautious* expected return: if you say 70% ± 5, it uses 65%, so shaky edges sink.
5. Set a **CATEGORY** (Weather, Sports…) and tap **SAVE PICK** on anything you bet or would have bet. Tap **PAPER** to switch it to **REAL** if you actually bought it, and type the price you really paid; slippage counts. When it settles, mark **WON** or **LOST**.
6. **Track record** shows net profit, expected vs. actual profit, worst drawdown, your accuracy vs. the market's (Brier score and log loss), calibration by probability range, results by category, and real trades separately from paper picks. 30 picks is an early checkpoint, not proof; it takes hundreds.
7. Picks live only in this browser. Use **EXPORT / BACKUP CSV** to save them and **RESTORE FROM CSV** to load them on another device.

The **Live Kalshi** tab can pull current prices from a market link or ticker and stamps each row with the time it was fetched. Prices older than 10 minutes trigger a warning. Some browsers block that request; if yours does, use screenshots or the scanner below.

The **Browse a league's games** section lists every open game in a Kalshi series (enter its series ticker, for example `KXHIGHCHI`) with Buy prices and trading volume, and adds a game's outcomes to the table with one tap. Kalshi's public data has no scores, so the app shows volume and close time instead.

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

## History check: has this category ever been beatable? (for a computer)

Before trusting any strategy, check the past. `history.py` downloads settled markets in a series, finds the bid and ask you could actually have traded at N hours before close (not the final price), and reports:

- **Calibration:** of markets priced 70–80¢, how often they really won.
- **Simulated profit after fees:** buying every YES at the ask, or every NO, in each price range.
- **Consistency:** each range is checked in the earlier half and the later half of the data separately.
- **Strength:** a range only counts if its profit is about 3 standard errors above what fair prices would produce by luck. With 20 ranges tested at once, weaker "winners" are usually flukes, and the report labels them that way.
- **Can see edge ≥:** the smallest edge each range's sample could reveal. With about 60 markets only huge edges show up; confirming a 10-point edge takes roughly 400 markets in one range.

```bash
python history.py --series KXHIGHCHI                        # one series
python history.py --series KXHIGHCHI,KXHIGHNY --hours-before 6
python history.py --from-csv snapshots.csv                  # re-run on saved data, no internet
```

Fetched prices are saved to `snapshots.csv`, so you only download once. The most likely and most useful result is "no range beat fees." That means following the price alone doesn't pay, and any edge has to come from your own probabilities, which the track record measures.

Limits: hourly candle closes approximate real fills; bigger orders get worse prices; the fee rate is assumed; the past doesn't guarantee the future.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `app.js` | The web app (screenshot upload, table, results) |
| `katy-math.js` | Fee math, break-even, ranking, screenshot text parsing |
| `scan.py`, `scanner/` | Command-line live scanner using Kalshi's public API (retries, rate-limit backoff, timestamps) |
| `history.py`, `scanner/history.py` | Historical calibration and fee-aware backtest by price range |
| `tests/` | `node tests/math.test.js`, `node tests/events.test.js` and `pytest tests` (fees, EV, parser, track record, history, malformed data) |

## Turn on the free website (one time)

GitHub → this repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch **main**, folder **/ (root)** → Save. The link above goes live in about a minute.

---

**Not financial advice.** Prediction markets can lose your whole stake. Prices move fast, so check the live price on Kalshi before buying.
