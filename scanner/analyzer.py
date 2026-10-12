"""Rank buyable sides by value (with your probabilities) or by market chance (without)."""
from __future__ import annotations

import csv
from typing import Dict, Iterable, List, Optional

from .fees import DEFAULT_FEE_RATE, analyze_side, contracts_for_stake


def load_probabilities(path: Optional[str]) -> Dict[str, float]:
    """CSV with columns: ticker,prob  (prob = your chance of YES, 0-1 or 0-100)."""
    if not path:
        return {}
    out: Dict[str, float] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            t = (row.get("ticker") or "").strip().upper()
            raw = (row.get("prob") or "").strip().rstrip("%")
            if not t or not raw:
                continue
            p = float(raw)
            out[t] = p / 100 if p > 1 else p
    return out


def quality_flags(spread: Optional[int], volume: int, max_spread: int, min_volume: int) -> List[str]:
    """Reasons to distrust the displayed price. Shown, not hidden."""
    flags = []
    if spread is None:
        flags.append("no bid (price may be stale)")
    elif spread > max_spread:
        flags.append(f"wide spread {spread}¢")
    if volume < min_volume:
        flags.append(f"thin volume {volume}")
    return flags


def rank(markets: Iterable[dict], probs: Dict[str, float], stake_cents: int = 1000,
         rate: float = DEFAULT_FEE_RATE, min_volume: int = 0, uncertainty: float = 0.0,
         max_spread: int = 10, hide_flagged: bool = False) -> Dict[str, List[dict]]:
    valued: List[dict] = []
    market_only: List[dict] = []
    for m in markets:
        volume = m.get("volume") or 0
        p_yes = probs.get((m.get("ticker") or "").upper())
        for side, price, bid, p in (
            ("YES", m.get("yes_ask"), m.get("yes_bid"), p_yes),
            ("NO", m.get("no_ask"), m.get("no_bid"), None if p_yes is None else 1 - p_yes),
        ):
            if not price or not (1 <= price <= 99):
                continue
            spread = price - bid if bid else None
            flags = quality_flags(spread, volume, max_spread, min_volume)
            if hide_flagged and flags:
                continue
            n = contracts_for_stake(stake_cents, price, rate)
            a = analyze_side(price, p, n, rate, uncertainty)
            if a is None:
                continue
            row = {"ticker": m["ticker"], "label": m["label"], "title": m.get("title"), "side": side,
                   "spread": spread, "volume": volume, "flags": flags, **a.__dict__}
            (valued if a.roi is not None else market_only).append(row)
    # Rank by the cautious end of your range so shaky edges sink.
    valued.sort(key=lambda r: r["cons_roi"], reverse=True)
    market_only.sort(key=lambda r: r["market_prob"], reverse=True)
    return {"valued": valued, "market_only": market_only}
