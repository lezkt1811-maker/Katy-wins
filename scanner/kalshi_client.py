"""Read-only client for Kalshi's free public market data (no API key needed)."""
from __future__ import annotations

import time
from typing import Iterator, Optional

import requests

BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"


def _cents(market: dict, key: str) -> Optional[int]:
    """Prices arrive as integer cents (e.g. yes_ask) and/or dollar strings (yes_ask_dollars)."""
    v = market.get(key)
    if v not in (None, ""):
        return int(round(float(v)))
    d = market.get(f"{key}_dollars")
    if d not in (None, ""):
        return int(round(float(d) * 100))
    return None


def normalize(m: dict) -> dict:
    return {
        "ticker": m.get("ticker"),
        "event_ticker": m.get("event_ticker"),
        "label": m.get("yes_sub_title") or m.get("subtitle") or m.get("title") or m.get("ticker"),
        "title": m.get("title"),
        "yes_ask": _cents(m, "yes_ask"),
        "no_ask": _cents(m, "no_ask"),
        "yes_bid": _cents(m, "yes_bid"),
        "no_bid": _cents(m, "no_bid"),
        "volume": m.get("volume") or 0,
        "close_time": m.get("close_time"),
    }


class KalshiClient:
    def __init__(self, base_url: str = BASE_URL, session: Optional[requests.Session] = None, pause: float = 0.25):
        self.base_url = base_url.rstrip("/")
        self.s = session or requests.Session()
        self.pause = pause  # stay well under public rate limits

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        r = self.s.get(f"{self.base_url}{path}", params=params, timeout=20)
        r.raise_for_status()
        return r.json()

    def iter_markets(self, status: str = "open", event_ticker: Optional[str] = None,
                     series_ticker: Optional[str] = None, max_pages: int = 20) -> Iterator[dict]:
        """Every page of markets, following Kalshi's cursor."""
        params = {"status": status, "limit": 1000}
        if event_ticker:
            params["event_ticker"] = event_ticker
        if series_ticker:
            params["series_ticker"] = series_ticker
        cursor = None
        for _ in range(max_pages):
            if cursor:
                params["cursor"] = cursor
            data = self._get("/markets", params)
            for m in data.get("markets", []):
                yield normalize(m)
            cursor = data.get("cursor")
            if not cursor:
                break
            time.sleep(self.pause)

    def market(self, ticker: str) -> Optional[dict]:
        data = self._get(f"/markets/{ticker}")
        m = data.get("market")
        return normalize(m) if m else None
