import random

import history as history_cli
from scanner import kalshi_client
from scanner.history import analyze, entry_snapshot, load_snapshots, save_snapshots


def candle(ts, ask, bid):
    return {"end_period_ts": ts,
            "yes_ask": {"close_dollars": None if ask is None else f"{ask / 100:.4f}"},
            "yes_bid": {"close_dollars": None if bid is None else f"{bid / 100:.4f}"}}


def test_entry_snapshot_uses_last_real_quote_before_entry():
    cs = [candle(100, 60, 55), candle(200, 62, 58), candle(300, None, None), candle(400, 90, 85)]
    s = entry_snapshot(cs, entry_ts=350)
    assert s == {"ts": 200, "yes_ask": 62, "yes_bid": 58}   # skips empty 300 and future 400
    assert entry_snapshot([candle(500, 50, 45)], entry_ts=350) is None   # never guesses
    assert entry_snapshot([candle(100, 40, 45)], entry_ts=350) is None   # crossed quote rejected


def _snaps(n, price, win_rate, seed, t0=0):
    rnd = random.Random(seed)
    return [{"ticker": f"T{t0 + i}", "series_ticker": "S", "close_ts": t0 + i, "entry_ts": t0 + i,
             "yes_ask": price + 1, "yes_bid": price - 1,
             "result": "yes" if rnd.random() < win_rate else "no"} for i in range(n)]


def test_fairly_priced_market_shows_no_edge_after_fees():
    res = analyze(_snaps(400, 75, 0.75, seed=1))
    band = next(b for b in res["bands"] if b["lo"] == 70)
    assert band["n"] == 400 and band["enough_data"]
    assert res["candidates"] == []          # fair prices + fees = no consistent profit
    assert abs(band["yes_rate"] - 0.75) < 0.06


def test_underpriced_band_is_found_only_if_it_holds_in_both_halves():
    res = analyze(_snaps(200, 75, 0.95, seed=2))
    assert (70, 80, "YES") in res["candidates"]
    # Profitable early, losing late -> not a candidate
    mixed = _snaps(100, 75, 1.0, seed=3) + _snaps(100, 75, 0.3, seed=4, t0=1000)
    assert (70, 80, "YES") not in analyze(mixed)["candidates"]


def test_small_bands_flagged_and_no_candidates():
    res = analyze(_snaps(10, 35, 1.0, seed=5))
    band = next(b for b in res["bands"] if b["lo"] == 30)
    assert not band["enough_data"] and res["candidates"] == []


def test_snapshot_csv_round_trip_skips_malformed_rows(tmp_path):
    p = tmp_path / "s.csv"
    save_snapshots(str(p), _snaps(3, 50, 0.5, seed=6))
    with open(p, "a") as f:
        f.write("BAD,S,notanumber,1,50,48,yes\n")
    assert len(load_snapshots(str(p))) == 3


def test_normalize_new_dollar_fields_and_derived_no_ask():
    m = kalshi_client.normalize({"ticker": "X", "yes_ask_dollars": "0.6100", "yes_bid_dollars": "0.5800",
                                 "volume_fp": "1234.00", "close_time": "2026-10-12T15:00:00Z", "result": "Yes"})
    assert m["yes_ask"] == 61 and m["no_ask"] == 42      # 100 - 58
    assert m["volume"] == 1234 and m["result"] == "yes" and m["close_ts"] > 0
    empty = kalshi_client.normalize({"ticker": "Y", "yes_ask_dollars": "", "yes_bid_dollars": "0"})
    assert empty["yes_ask"] is None and empty["no_ask"] is None   # missing stays missing


def test_client_retries_on_rate_limit(monkeypatch):
    monkeypatch.setattr(kalshi_client.time, "sleep", lambda s: None)

    class Resp:
        def __init__(self, code, body=None):
            self.status_code, self._b, self.headers, self.text = code, body or {}, {"Retry-After": "1"}, ""
        def json(self):
            return self._b

    class Sess:
        def __init__(self):
            self.calls = 0
        def get(self, *a, **k):
            self.calls += 1
            return Resp(429) if self.calls < 3 else Resp(200, {"markets": [{"ticker": "OK"}], "cursor": ""})

    s = Sess()
    c = kalshi_client.KalshiClient(session=s, pause=0)
    assert [m["ticker"] for m in c.iter_markets()] == ["OK"] and s.calls == 3
    assert c.last_fetch is not None


def test_collect_end_to_end_with_fake_client(capsys):
    class Fake:
        def iter_markets(self, **kw):
            yield {"ticker": "A", "result": "yes", "close_ts": 100_000}
            yield {"ticker": "B", "result": "no", "close_ts": 200_000}
            yield {"ticker": "C", "result": "", "close_ts": 300_000}     # unsettled: ignored
        def candlesticks(self, series, ticker, start, end, period_interval=60):
            return [] if ticker == "B" else [candle(end - 10, 70, 66)]
    snaps = history_cli.collect(Fake(), ["S"], 24, 50, log=lambda *a: None)
    assert [s["ticker"] for s in snaps] == ["A"]          # B had no quote -> skipped, not guessed
    history_cli.report(analyze(snaps), 24, 0.07)
    out = capsys.readouterr().out
    assert "too few to trust" in out and "Not financial advice" in out


def test_fair_prices_across_all_bands_do_not_produce_false_alarms():
    # Many datasets where price == true chance: there is no edge to find.
    # Testing 20 bands at once, a rare fluke is allowed but must stay rare.
    alarms = 0
    for seed in range(20):
        r = random.Random(seed)
        snaps = []
        for i in range(600):
            p = r.randint(3, 97)
            snaps.append({"ticker": f"T{i}", "series_ticker": "S", "close_ts": i, "entry_ts": i,
                          "yes_ask": min(99, p + 1), "yes_bid": max(1, p - 1),
                          "result": "yes" if r.random() < p / 100 else "no"})
        alarms += bool(analyze(snaps)["candidates"])
    assert alarms <= 1


def test_big_real_edge_with_enough_data_is_detected():
    hits = 0
    for seed in range(10):
        r = random.Random(seed)
        snaps = []
        for i in range(400):
            p = r.randint(60, 69)
            snaps.append({"ticker": f"T{i}", "series_ticker": "S", "close_ts": i, "entry_ts": i,
                          "yes_ask": p + 1, "yes_bid": p - 1,
                          "result": "yes" if r.random() < p / 100 + 0.20 else "no"})
        res = analyze(snaps)
        hits += (60, 70, "YES") in res["candidates"]
        band = next(b for b in res["bands"] if b["lo"] == 60)
        assert 5 < band["YES"]["min_visible_pts"] < 10
    assert hits >= 9
