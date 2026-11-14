"""Verdict states: each reached by a constructed case (contract §4)."""

import random

from sim.chain import evaluate_series, recommend

BASE = dict(orderDelay=1, shipDelay=2, holdingCost=0.5, backlogCost=1.0,
            costModel="backlog", infoSharing=False, serviceLevel=0.95)
STEP = [4] * 4 + [8] * 32


def _random_series_set():
    rng = random.Random(7)
    return [[max(0, round(rng.gauss(8, 3))) for _ in range(36)] for _ in range(20)]


def test_good_verdict_when_a_rule_wins_clearly():
    """Random demand around a steady mean, at the retailer: passing
    orders through is a base-stock policy with its target fixed at the
    opening, the right rule when the mean holds still, and it wins by
    more than the tie band while filling most orders."""
    ev = evaluate_series(BASE, _random_series_set(), 0)
    rec = ev["recommendation"]
    assert rec["rule"] == "pass"
    assert rec["cls"] == "good"
    assert ev["rules"]["pass"]["fillRate"] >= 0.75


def test_accent_verdict_on_a_tie():
    """Steady demand: the chain opens in steady state, so every rule
    keeps it there at no cost and the verdict is a neutral tie."""
    ev = evaluate_series(BASE, [[6] * 36], 0)
    rec = ev["recommendation"]
    assert rec["tie"] is True
    assert rec["cls"] == "accent"


def test_warn_verdict_when_even_the_best_rule_stocks_out():
    """The classic step: after demand doubles, even the best rule
    leaves more than a quarter of orders unfilled over the game."""
    ev = evaluate_series(BASE, [STEP], 0)
    rec = ev["recommendation"]
    assert rec["cls"] == "warn"
    assert ev["rules"][rec["rule"]]["fillRate"] < 0.75


def test_recommend_picks_lowest_cost_and_flags_ties():
    fake = {"rules": {
        "out": {"yourCost": 100.0, "fillRate": 0.95},
        "pass": {"yourCost": 101.0, "fillRate": 0.95},
        "smooth": {"yourCost": 130.0, "fillRate": 0.95},
    }}
    rec = recommend(fake)
    assert rec["rule"] == "out"
    assert rec["tie"] is True
    assert rec["cls"] == "accent"
    fake["rules"]["pass"]["yourCost"] = 120.0
    rec = recommend(fake)
    assert rec["tie"] is False
    assert rec["cls"] == "good"
