"""Read-only client for Kalshi's free public market data (no API key needed)."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Iterator, List, Optional

import requests

BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"


def _num(v) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _cents(market: dict, key: str) -> Optional[int]:
    """Prices arrive as dollar strings (yes_ask_dollars) or, in older responses, integer cents (yes_ask)."""
    d = _num(market.get(f"{key}_dollars"))
    if d is not None:
        return int(round(d * 100))
    c = _num(market.get(key))
    return int(round(c)) if c is not None else None


def _valid(c: Optional[int]) -> Optional[int]:
    return c if c is not None and 1 <= c <= 99 else None


def parse_ts(v) -> Optional[int]:
    """ISO date-time or unix seconds -> unix seconds."""
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def normalize(m: dict) -> dict:
    yes_bid = _valid(_cents(m, "yes_bid"))
    no_bid = _valid(_cents(m, "no_bid"))
    # Buying NO = selling YES, so NO's ask is 100 - YES bid when not listed (and vice versa).
    yes_ask = _valid(_cents(m, "yes_ask")) or (100 - no_bid if no_bid else None)
    no_ask = _valid(_cents(m, "no_ask")) or (100 - yes_bid if yes_bid else None)
    volume = _num(m.get("volume_fp"))
    if volume is None:
        volume = _num(m.get("volume")) or 0
    return {
        "ticker": m.get("ticker"),
        "event_ticker": m.get("event_ticker"),
        "series_ticker": m.get("series_ticker"),
        "label": m.get("yes_sub_title") or m.get("subtitle") or m.get("title") or m.get("ticker"),
        "title": m.get("title"),
        "yes_ask": yes_ask, "no_ask": no_ask, "yes_bid": yes_bid, "no_bid": no_bid,
        "volume": int(volume),
        "close_time": m.get("close_time"),
        "close_ts": parse_ts(m.get("close_time")),
        "result": (m.get("result") or "").lower(),
        "status": m.get("status"),
    }


class KalshiError(RuntimeError):
    pass


class KalshiClient:
    def __init__(self, base_url: str = BASE_URL, session: Optional[requests.Session] = None,
                 pause: float = 0.25, retries: int = 4):
        self.base_url = base_url.rstrip("/")
        self.s = session or requests.Session()
        self.pause = pause      # stay well under public rate limits
        self.retries = retries
        self.last_fetch: Optional[float] = None   # unix time of the last successful response

    def _get(self, path: str, params: Optional[dict] = None, allow_404: bool = False) -> Optional[dict]:
        """GET with retries: backs off on 429/5xx and network errors, honours Retry-After."""
        delay = 1.0
        for attempt in range(self.retries + 1):
            try:
                r = self.s.get(f"{self.base_url}{path}", params=params, timeout=20)
            except requests.RequestException as e:
                if attempt == self.retries:
                    raise KalshiError(f"network error: {e}") from e
                time.sleep(delay); delay *= 2
                continue
            if r.status_code == 404 and allow_404:
                return None
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == self.retries:
                    raise KalshiError(f"Kalshi returned {r.status_code} after {self.retries} retries")
                wait = _num(r.headers.get("Retry-After")) or delay
                time.sleep(min(wait, 30)); delay *= 2
                continue
            if r.status_code >= 400:
                raise KalshiError(f"Kalshi returned {r.status_code}: {r.text[:200]}")
            self.last_fetch = time.time()
            return r.json()
        raise KalshiError("unreachable")

    def iter_markets(self, status: Optional[str] = "open", event_ticker: Optional[str] = None,
                     series_ticker: Optional[str] = None, max_pages: int = 20, **extra) -> Iterator[dict]:
        """Every page of markets, following Kalshi's cursor."""
        params = {"limit": 1000, **extra}
        if status:
            params["status"] = status
        if event_ticker:
            params["event_ticker"] = event_ticker
        if series_ticker:
            params["series_ticker"] = series_ticker
        cursor = None
        for _ in range(max_pages):
            if cursor:
                params["cursor"] = cursor
            data = self._get("/markets", params) or {}
            for m in data.get("markets", []):
                yield normalize(m)
            cursor = data.get("cursor")
            if not cursor:
                break
            time.sleep(self.pause)

    def market(self, ticker: str) -> Optional[dict]:
        data = self._get(f"/markets/{ticker}", allow_404=True)
        m = (data or {}).get("market")
        return normalize(m) if m else None

    def candlesticks(self, series_ticker: str, ticker: str, start_ts: int, end_ts: int,
                     period_interval: int = 60) -> List[dict]:
        """Hourly (default) bid/ask history. Older settled markets live under /historical."""
        params = {"start_ts": start_ts, "end_ts": end_ts, "period_interval": period_interval,
                  "include_latest_before_start": "true"}
        data = self._get(f"/series/{series_ticker}/markets/{ticker}/candlesticks", params, allow_404=True)
        if not data or not data.get("candlesticks"):
            data = self._get(f"/historical/markets/{ticker}/candlesticks", params, allow_404=True)
        time.sleep(self.pause)
        return (data or {}).get("candlesticks") or []
