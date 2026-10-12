#!/usr/bin/env python3
"""Katy Wins history check: have Kalshi prices in a category been beatable?

Examples:
  python history.py --series KXHIGHCHI                    # Chicago high-temp markets
  python history.py --series KXHIGHCHI,KXHIGHNY --hours-before 6 --max-markets 400
  python history.py --from-csv snapshots.csv              # re-analyze saved data, no internet

Fetched entry prices are saved to snapshots.csv so you can re-run for free.
Not financial advice: past results don't guarantee future ones.
"""
from __future__ import annotations

import argparse
import sys
import time

from scanner.fees import DEFAULT_FEE_RATE
from scanner.history import MIN_BAND_N, MIN_Z, analyze, entry_snapshot, load_snapshots, save_snapshots
from scanner.kalshi_client import KalshiClient, KalshiError


def collect(client, series_list, hours_before, max_markets, log=print):
    snaps = []
    for series in series_list:
        markets = []
        for m in client.iter_markets(status="settled", series_ticker=series):
            if m["result"] in ("yes", "no") and m["close_ts"]:
                markets.append(m)
            if len(markets) >= max_markets:
                break
        log(f"{series}: {len(markets)} settled markets; reading prices {hours_before}h before close…")
        missing = 0
        for i, m in enumerate(markets, 1):
            entry_ts = m["close_ts"] - int(hours_before * 3600)
            candles = client.candlesticks(series, m["ticker"], entry_ts - 12 * 3600, entry_ts)
            snap = entry_snapshot(candles, entry_ts)
            if not snap:
                missing += 1
                continue
            snaps.append({"ticker": m["ticker"], "series_ticker": series, "close_ts": m["close_ts"],
                          "entry_ts": snap["ts"], "yes_ask": snap["yes_ask"], "yes_bid": snap["yes_bid"],
                          "result": m["result"]})
            if i % 25 == 0:
                log(f"  {i}/{len(markets)}")
        if missing:
            log(f"  {missing} skipped: no bid/ask at entry time (not guessed)")
    return snaps


def pct(v):
    return "  -  " if v is None else f"{v * 100:5.1f}%"


def report(res, hours_before, rate):
    print("\n=== KATY WINS · HISTORY CHECK ===")
    if not res["n"]:
        print("No usable markets. Try another series or a smaller --hours-before.")
        return
    print(f"{res['n']} settled markets with a real bid/ask {hours_before}h before close"
          + (f" ({res['excluded']} excluded)" if res["excluded"] else ""))
    print(f"Market accuracy at entry: Brier {res['brier']:.3f} · log loss {res['log_loss']:.3f}"
          "  (lower = better; to beat the market your % must score lower than this)\n")

    print("PRICE    MARKETS  WON-YES  | BUY YES at ask: return  early / late | BUY NO at ask: return  early / late | CAN SEE EDGE ≥")
    for b in res["bands"]:
        if not b["n"]:
            continue
        y, n = b["YES"], b["NO"]
        flag = "" if b["enough_data"] else "  ← too few to trust"
        print(f"{b['lo']:>2}-{b['hi']:<3}¢ {b['n']:>7}  {pct(b['yes_rate'])}  |"
              f"  {pct(y['roi'])}  {pct(y['roi_early'])} / {pct(y['roi_late'])}  |"
              f"  {pct(n['roi'])}  {pct(n['roi_early'])} / {pct(n['roi_late'])}  |"
              f"  {y['min_visible_pts']:4.0f} pts{flag}")

    if len(res["series"]) > 1:
        print("\nBy series (market Brier, lower = harder to beat):")
        for s in res["series"]:
            print(f"  {s['series']:<20} {s['n']:>5} markets  Brier {s['brier']:.3f}")

    print()
    if res["candidates"]:
        print("Bands that made money after fees in both halves AND by too much to be easy luck")
        print("(worth researching, not proof):")
        for lo, hi, side in res["candidates"]:
            b = next(x for x in res["bands"] if x["lo"] == lo)
            print(f"  • buy {side} when price is {lo}-{hi}¢  ({b[side]['roi'] * 100:+.1f}% per $1, strength {b[side]['z']:.1f})")
    else:
        print(f"No price band beat fees by a clear margin (strength ≥ {MIN_Z:g}) in both halves of the data.")
    if res.get("lucky_looking"):
        names = ", ".join(f"{side} {lo}-{hi}¢" for lo, hi, side in res["lucky_looking"])
        print(f"Looked profitable but too weak to trust (likely luck, since {len(res['bands']) * 2} bands were tested): {names}")
    if not res["candidates"]:
        print("That's a useful answer: in this category, blindly following prices hasn't paid. Any edge has to come")
        print("from YOUR probabilities beating the market's, and your track record is how you check that.")
    print("\nCAN SEE EDGE: a band can only reveal an edge bigger than this many points per contract (after fees).")
    print("A smaller real edge would be hidden by luck, so 'nothing found' with few markets means 'not enough data',")
    print("not 'no edge'. Confirming a 10-point edge takes roughly 400 markets in one band.")
    print(f"\nAssumptions: fee rate {rate}, 1 contract per market, hourly candle close as the entry price.")
    print(f"Bands with under {MIN_BAND_N} markets are marked; real fills on bigger orders are usually worse.")
    print("Not financial advice. The past doesn't guarantee the future.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Check how Kalshi prices in a category have performed historically.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--series", help="Comma-separated series tickers, e.g. KXHIGHCHI,KXHIGHNY")
    src.add_argument("--from-csv", help="Re-analyze a saved snapshots CSV (no internet)")
    ap.add_argument("--hours-before", type=float, default=24, help="Entry time before close (default 24h)")
    ap.add_argument("--max-markets", type=int, default=300, help="Per series (default 300)")
    ap.add_argument("--save", default="snapshots.csv", help="Where to save fetched entry prices")
    ap.add_argument("--fee-rate", type=float, default=DEFAULT_FEE_RATE)
    a = ap.parse_args(argv)

    if a.from_csv:
        snaps = load_snapshots(a.from_csv)
    else:
        client = KalshiClient()
        try:
            snaps = collect(client, [s.strip().upper() for s in a.series.split(",") if s.strip()],
                            a.hours_before, a.max_markets)
        except KalshiError as e:
            print(f"Could not reach Kalshi: {e}")
            return 1
        if snaps:
            save_snapshots(a.save, snaps)
            print(f"Saved {len(snaps)} entry prices to {a.save} at {time.strftime('%Y-%m-%d %H:%M')}")
    report(analyze(snaps, a.fee_rate), a.hours_before, a.fee_rate)
    return 0


if __name__ == "__main__":
    sys.exit(main())
