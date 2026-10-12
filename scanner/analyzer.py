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


def rank(markets: Iterable[dict], probs: Dict[str, float], stake_cents: int = 1000,
         rate: float = DEFAULT_FEE_RATE, min_volume: int = 0) -> Dict[str, List[dict]]:
    valued: List[dict] = []
    market_only: List[dict] = []
    for m in markets:
        if (m.get("volume") or 0) < min_volume:
            continue
        p_yes = probs.get((m.get("ticker") or "").upper())
        for side, price, p in (
            ("YES", m.get("yes_ask"), p_yes),
            ("NO", m.get("no_ask"), None if p_yes is None else 1 - p_yes),
        ):
            if not price or not (1 <= price <= 99):
                continue
            n = contracts_for_stake(stake_cents, price, rate)
            a = analyze_side(price, p, n, rate)
            if a is None:
                continue
            row = {"ticker": m["ticker"], "label": m["label"], "title": m.get("title"), "side": side, **a.__dict__}
            (valued if a.roi is not None else market_only).append(row)
    valued.sort(key=lambda r: r["roi"], reverse=True)
    market_only.sort(key=lambda r: r["market_prob"], reverse=True)
    return {"valued": valued, "market_only": market_only}
