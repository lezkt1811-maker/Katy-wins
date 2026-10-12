import scan
from scanner import kalshi_client
from scanner.analyzer import rank
from scanner.fees import analyze_side, contracts_for_stake, fee_cents


def test_fee_matches_kalshi_formula():
    assert fee_cents(50, 1) == 2       # $0.0175 -> 2c
    assert fee_cents(50, 100) == 175   # $1.75
    assert fee_cents(90, 10) == 7      # $0.063 -> 7c
    assert fee_cents(0, 5) == 0


def test_break_even_and_ev():
    a = analyze_side(60, 0.70)
    assert a.total_cost == 62
    assert abs(a.break_even - 0.62) < 1e-9
    assert abs(a.ev_cents - 8) < 1e-9


def test_stake_never_exceeds_budget():
    for price in range(1, 100):
        n = contracts_for_stake(1000, price)
        assert price * n + fee_cents(price, n) <= 1000 or n == 1


def test_normalize_handles_dollar_strings():
    m = kalshi_client.normalize({"ticker": "T", "yes_ask_dollars": "0.6200", "no_ask": 40, "yes_sub_title": "85-86"})
    assert m["yes_ask"] == 62 and m["no_ask"] == 40 and m["label"] == "85-86"


MARKETS = [
    {"ticker": "EV-A", "label": "A", "yes_ask": 40, "no_ask": 62, "volume": 500},
    {"ticker": "EV-B", "label": "B", "yes_ask": 30, "no_ask": 72, "volume": 5},
]


def test_rank_with_and_without_probs():
    r = rank(MARKETS, {"EV-A": 0.55}, stake_cents=1000)
    assert r["valued"][0]["ticker"] == "EV-A" and r["valued"][0]["side"] == "YES"
    assert all(x["ticker"] == "EV-B" for x in r["market_only"])
    flagged = rank(MARKETS, {}, min_volume=100)["market_only"]
    assert all("thin volume 5" in r["flags"] for r in flagged if r["ticker"] == "EV-B")
    assert all(r["ticker"] == "EV-A" for r in rank(MARKETS, {}, min_volume=100, hide_flagged=True)["market_only"])


def test_conservative_ranking_sinks_shaky_edges():
    a = analyze_side(58, 0.70, uncertainty=0.07)
    assert abs(a.cons_prob - 0.63) < 1e-9 and a.cons_ev_cents < a.ev_cents


def test_cli_end_to_end(monkeypatch, capsys, tmp_path):
    class FakeClient:
        def iter_markets(self, **kw):
            return iter(MARKETS)
    monkeypatch.setattr(scan, "KalshiClient", FakeClient)
    probs = tmp_path / "p.csv"
    probs.write_text("ticker,prob\nEV-A,55\n")
    assert scan.main(["--event", "EV", "--probs", str(probs), "--no-color"]) == 0
    out = capsys.readouterr().out
    assert "#1 YES A" in out and "Market odds only" in out
