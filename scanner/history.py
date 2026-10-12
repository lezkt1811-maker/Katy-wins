"""Historical check: were Kalshi prices well calibrated, and did any simple
price-band strategy make money after fees, using prices you could have paid?

Method
------
For each settled market we take the YES bid/ask from the last hourly candle
that closed at least N hours before the market closed ("entry"). We then ask:

* Calibration: of markets whose mid price was 70-80c at entry, how many
  actually resolved YES?
* Simulated P&L: what if you had bought 1 YES (at the ask) or 1 NO
  (at 100 - YES bid) in every market in that band, paying Kalshi's fee?
* Consistency: does the same band make money in BOTH the earlier half and
  the later half of the data? A pattern that only shows up once is likely luck.

Limits (shown in every report): hourly candle closes approximate the price you
would really have got; bigger orders move the price; the fee rate is assumed;
the past is not the future.
"""
from __future__ import annotations

import csv
import math
from typing import Dict, Iterable, List, Optional

from .fees import DEFAULT_FEE_RATE, fee_cents

BANDS = [(i, i + 10) for i in range(0, 100, 10)]
MIN_BAND_N = 30          # below this a band's numbers are mostly noise
# We test 10 bands x 2 sides = 20 strategies at once, so some will look
# profitable by luck alone. A band only counts if its average profit is at
# least MIN_Z standard errors above the no-edge case (about a 1-in-700 fluke per test).
MIN_Z = 3.0
SNAPSHOT_FIELDS = ["ticker", "series_ticker", "close_ts", "entry_ts", "yes_ask", "yes_bid", "result"]


def _close_cents(side: Optional[dict]) -> Optional[int]:
    """Close price of a candlestick bid/ask object, in cents (or None)."""
    if not side:
        return None
    v = side.get("close_dollars")
    if v in (None, ""):
        v = side.get("close")
        return int(round(float(v))) if v not in (None, "") else None
    return int(round(float(v) * 100))


def entry_snapshot(candles: Iterable[dict], entry_ts: int) -> Optional[Dict[str, int]]:
    """Last candle ending at/before entry_ts that has both a YES bid and ask."""
    best = None
    for c in candles:
        ts = c.get("end_period_ts")
        if ts is None or ts > entry_ts:
            continue
        ask, bid = _close_cents(c.get("yes_ask")), _close_cents(c.get("yes_bid"))
        if ask is None or bid is None or not (1 <= ask <= 99) or not (1 <= bid <= 99) or bid > ask:
            continue
        if best is None or ts > best["ts"]:
            best = {"ts": ts, "yes_ask": ask, "yes_bid": bid}
    return best


def _band_of(mid_cents: float):
    for lo, hi in BANDS:
        if lo <= mid_cents < hi or (hi == 100 and mid_cents == 100):
            return lo, hi
    return None


def _side_pnl(price: int, won: bool, rate: float) -> int:
    """Profit in cents from buying 1 contract at `price`, fee included."""
    cost = price + fee_cents(price, 1, rate)
    return (100 if won else 0) - cost


def _strategy(rows: List[dict], side: str, rate: float) -> Dict[str, Optional[float]]:
    """Buy 1 contract on `side` in every market. z = how many standard errors the
    profit sits above what you'd expect if the market's own price were the true
    chance (the "no edge" case). Using the market's odds for the spread keeps the
    test honest even when a sample happens to contain no losses."""
    pnl, cost, n, var = 0, 0, 0, 0.0
    for r in rows:
        price = r["yes_ask"] if side == "YES" else 100 - r["yes_bid"]
        if not (1 <= price <= 99):
            continue
        won = (r["result"] == "yes") == (side == "YES")
        pnl += _side_pnl(price, won, rate)
        cost += price + fee_cents(price, 1, rate)
        p_fair = r["mid"] / 100 if side == "YES" else 1 - r["mid"] / 100
        var += p_fair * (1 - p_fair) * 100 * 100     # win/lose swing is always 100c
        n += 1
    z = pnl / math.sqrt(var) if var > 0 else None
    # Smallest per-contract edge (in cents = percentage points) this sample could reveal.
    min_visible = MIN_Z * math.sqrt(var) / n if n and var > 0 else None
    return {"n": n, "pnl_cents": pnl, "roi": pnl / cost if cost else None, "z": z, "min_visible_pts": min_visible}


def analyze(snapshots: List[dict], rate: float = DEFAULT_FEE_RATE) -> dict:
    rows = [r for r in snapshots if r.get("result") in ("yes", "no")
            and r.get("yes_ask") and r.get("yes_bid")]
    rows.sort(key=lambda r: r.get("close_ts") or 0)
    for r in rows:
        r["mid"] = (r["yes_ask"] + r["yes_bid"]) / 2
        r["p"] = r["mid"] / 100
        r["y"] = 1 if r["result"] == "yes" else 0

    n = len(rows)
    half = n // 2
    early_ids = {id(r) for r in rows[:half]}

    eps = 1e-6
    brier = sum((r["p"] - r["y"]) ** 2 for r in rows) / n if n else None
    logloss = (-sum(math.log(min(1 - eps, max(eps, r["p"]))) if r["y"] else math.log(min(1 - eps, max(eps, 1 - r["p"])))
                    for r in rows) / n) if n else None

    bands = []
    for lo, hi in BANDS:
        b = [r for r in rows if _band_of(r["mid"]) == (lo, hi)]
        entry = {"lo": lo, "hi": hi, "n": len(b),
                 "avg_price": sum(r["mid"] for r in b) / len(b) / 100 if b else None,
                 "yes_rate": sum(r["y"] for r in b) / len(b) if b else None,
                 "enough_data": len(b) >= MIN_BAND_N}
        for side in ("YES", "NO"):
            all_ = _strategy(b, side, rate)
            early = _strategy([r for r in b if id(r) in early_ids], side, rate)
            late = _strategy([r for r in b if id(r) not in early_ids], side, rate)
            entry[side] = {**all_, "roi_early": early["roi"], "roi_late": late["roi"],
                           "n_early": early["n"], "n_late": late["n"]}
            entry[side]["consistent_profit"] = bool(
                entry["enough_data"] and all_["z"] is not None and all_["z"] >= MIN_Z
                and early["roi"] is not None and late["roi"] is not None
                and early["roi"] > 0 and late["roi"] > 0 and early["n"] >= 15 and late["n"] >= 15)
        bands.append(entry)

    by_series: Dict[str, dict] = {}
    for r in rows:
        s = by_series.setdefault(r.get("series_ticker") or "?", {"n": 0, "sq": 0.0})
        s["n"] += 1
        s["sq"] += (r["p"] - r["y"]) ** 2
    series = [{"series": k, "n": v["n"], "brier": v["sq"] / v["n"]} for k, v in sorted(by_series.items())]

    return {"n": n, "excluded": len(snapshots) - n, "brier": brier, "log_loss": logloss,
            "bands": bands, "series": series,
            "candidates": [(b["lo"], b["hi"], side) for b in bands for side in ("YES", "NO")
                           if b[side]["consistent_profit"]],
            "lucky_looking": [(b["lo"], b["hi"], side) for b in bands for side in ("YES", "NO")
                              if not b[side]["consistent_profit"] and b[side]["roi"] is not None
                              and b[side]["roi"] > 0 and (b[side]["roi_early"] or 0) > 0 and (b[side]["roi_late"] or 0) > 0]}


def save_snapshots(path: str, snapshots: List[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=SNAPSHOT_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(snapshots)


def load_snapshots(path: str) -> List[dict]:
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                out.append({"ticker": r["ticker"], "series_ticker": r.get("series_ticker", ""),
                            "close_ts": int(float(r["close_ts"])), "entry_ts": int(float(r["entry_ts"])),
                            "yes_ask": int(float(r["yes_ask"])), "yes_bid": int(float(r["yes_bid"])),
                            "result": r["result"].strip().lower()})
            except (KeyError, ValueError):
                continue   # skip malformed rows rather than guess
    return out
