#!/usr/bin/env python3
"""Katy Wins live scanner.

Examples:
  python scan.py --event KXHIGHCHI-26OCT12
  python scan.py --series KXHIGHCHI --stake 25
  python scan.py --event KXHIGHCHI-26OCT12 --probs my_odds.csv

my_odds.csv columns: ticker,prob   (your chance of YES, e.g. 0.42 or 42)
Not financial advice.
"""
from __future__ import annotations

import argparse
import sys

from scanner.analyzer import load_probabilities, rank
from scanner.fees import DEFAULT_FEE_RATE
from scanner.kalshi_client import KalshiClient

C = {"cyan": "\033[96m", "pink": "\033[95m", "lime": "\033[92m", "red": "\033[91m",
     "yel": "\033[93m", "dim": "\033[2m", "end": "\033[0m"}


def money(c: float) -> str:
    return f"${c / 100:,.2f}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Rank Kalshi bets by value, fees included.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--event", help="Event ticker, e.g. KXHIGHCHI-26OCT12")
    g.add_argument("--series", help="Series ticker, e.g. KXHIGHCHI (all its open events)")
    g.add_argument("--market", help="A single market ticker")
    ap.add_argument("--probs", help="CSV of your own YES chances: ticker,prob")
    ap.add_argument("--stake", type=float, default=10, help="Dollars per bet (default 10)")
    ap.add_argument("--fee-rate", type=float, default=DEFAULT_FEE_RATE)
    ap.add_argument("--min-volume", type=int, default=0, help="Flag markets traded fewer contracts than this")
    ap.add_argument("--max-spread", type=int, default=10, help="Flag sides whose bid-ask spread is wider (cents)")
    ap.add_argument("--hide-flagged", action="store_true", help="Drop flagged sides instead of showing them")
    ap.add_argument("--uncertainty", type=float, default=5,
                    help="How unsure your probabilities are, in points (default 5). Ranking uses the cautious end.")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--no-color", action="store_true")
    a = ap.parse_args(argv)
    if a.no_color or not sys.stdout.isatty():
        for k in C:
            C[k] = ""

    client = KalshiClient()
    try:
        if a.market:
            m = client.market(a.market.upper())
            markets = [m] if m else []
        else:
            markets = list(client.iter_markets(event_ticker=a.event and a.event.upper(),
                                               series_ticker=a.series and a.series.upper()))
    except Exception as e:  # network or HTTP error
        print(f"{C['red']}Could not reach Kalshi: {e}{C['end']}")
        return 1
    if not markets:
        print(f"{C['red']}No open markets found. Check the ticker.{C['end']}")
        return 1

    probs = load_probabilities(a.probs)
    res = rank(markets, probs, int(a.stake * 100), a.fee_rate, a.min_volume,
               uncertainty=a.uncertainty / 100, max_spread=a.max_spread, hide_flagged=a.hide_flagged)

    print(f"{C['pink']}=== KATY WINS ==={C['end']}  {len(markets)} markets · stake {money(a.stake * 100)} per bet\n")
    if res["valued"]:
        print(f"{C['yel']}Ranked by cautious expected return per $1 (your % minus {a.uncertainty:g} pts, fees included):{C['end']}")
        for i, r in enumerate(res["valued"][: a.top], 1):
            col = C["lime"] if r["cons_ev_cents"] > 0 else C["red"]
            print(f" {C['pink']}#{i}{C['end']} {r['side']:<3} {r['label']}  {C['dim']}{r['ticker']}{C['end']}")
            print(f"     buy {r['contracts']} @ {r['price_cents']}¢ = {money(r['total_cost'])} (fee {money(r['total_fee'])})"
                  f" · wins {money(100 * r['contracts'])} · need {r['break_even']:.1%} · you say {r['your_prob']:.1%}"
                  f" · EV {'+' if r['ev_cents'] >= 0 else '-'}{money(abs(r['ev_cents']))}"
                  f" · {col}cautious EV {'+' if r['cons_ev_cents'] >= 0 else '-'}{money(abs(r['cons_ev_cents']))}"
                  f" ({r['cons_roi']:+.1%}){C['end']}")
            if r["flags"]:
                print(f"     {C['red']}⚠ {', '.join(r['flags'])}{C['end']}")
        if res["valued"][0]["cons_ev_cents"] <= 0:
            print(f"\n {C['red']}No positive-value bet at your probabilities. Skipping is the winning move.{C['end']}")
        print()
    if res["market_only"]:
        print(f"{C['cyan']}Market odds only (add --probs to rank by value; high chance is not the same as a good bet):{C['end']}")
        for r in res["market_only"][: a.top]:
            print(f"  {r['side']:<3} {r['label'][:48]:<48} {r['price_cents']:>2}¢  chance {r['market_prob']:.0%}"
                  f"  profit if win {money(r['profit_if_win'])} on {money(r['total_cost'])}"
                  + (f"  {C['red']}⚠ {', '.join(r['flags'])}{C['end']}" if r["flags"] else ""))
    print(f"\n{C['dim']}Not financial advice. Prices move; check them on Kalshi before buying.{C['end']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
