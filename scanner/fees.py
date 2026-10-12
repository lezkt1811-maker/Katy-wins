"""Kalshi fee and contract math. Prices are in cents (1-99); a win pays 100 cents."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

# Kalshi's general trading fee: ceil(rate * C * P * (1 - P)) dollars, rounded up
# to the cent. Some product families use a different rate; pass it in.
DEFAULT_FEE_RATE = 0.07


def fee_cents(price_cents: int, contracts: int, rate: float = DEFAULT_FEE_RATE) -> int:
    if not (0 < price_cents < 100) or contracts <= 0:
        return 0
    p = price_cents / 100
    dollars = rate * contracts * p * (1 - p)
    # Strip float noise (1.0000000002) before rounding up.
    return math.ceil(round(dollars * 100, 6))


@dataclass
class SideAnalysis:
    price_cents: int
    contracts: int
    total_fee: int
    total_cost: int          # cents, including fee
    profit_if_win: int       # cents
    break_even: float        # probability needed to break even
    market_prob: float
    your_prob: Optional[float] = None
    edge: Optional[float] = None
    ev_cents: Optional[float] = None
    roi: Optional[float] = None   # expected profit per $1 risked


def analyze_side(price_cents: int, your_prob: Optional[float] = None,
                 contracts: int = 1, rate: float = DEFAULT_FEE_RATE) -> Optional[SideAnalysis]:
    if not (1 <= price_cents <= 99):
        return None
    contracts = max(1, int(contracts))
    total_fee = fee_cents(price_cents, contracts, rate)
    total_cost = price_cents * contracts + total_fee
    a = SideAnalysis(
        price_cents=price_cents,
        contracts=contracts,
        total_fee=total_fee,
        total_cost=total_cost,
        profit_if_win=100 * contracts - total_cost,
        break_even=total_cost / contracts / 100,
        market_prob=price_cents / 100,
    )
    if your_prob is not None and 0 <= your_prob <= 1:
        a.your_prob = your_prob
        a.edge = your_prob - a.break_even
        a.ev_cents = your_prob * 100 * contracts - total_cost
        a.roi = a.ev_cents / total_cost
    return a


def contracts_for_stake(stake_cents: int, price_cents: int, rate: float = DEFAULT_FEE_RATE) -> int:
    """Most contracts the stake can buy once the fee is included (at least 1)."""
    n = stake_cents // price_cents
    while n > 0 and price_cents * n + fee_cents(price_cents, n, rate) > stake_cents:
        n -= 1
    return max(1, n)
