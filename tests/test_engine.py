"""Engine tests: textbook cases and the spec's required checks."""

import math

from sim.chain import (
    STERMAN_ALPHA,
    STERMAN_BETA,
    STERMAN_THETA,
    create_game,
    norm_cdf,
    norm_inv,
    policy_order,
    simulate,
    stage_target,
    target_for,
)

BASE = dict(orderDelay=1, shipDelay=2, holdingCost=0.5, backlogCost=1.0,
            costModel="backlog", infoSharing=False, serviceLevel=0.95)
STEP = [4] * 4 + [8] * 32
OUT = {"type": "out", "alpha": 1.0}
PASS = {"type": "passthrough"}


def test_norm_functions():
    assert abs(norm_cdf(0.0) - 0.5) < 1e-6
    assert abs(norm_inv(0.95) - 1.644854) < 1e-4
    assert abs(norm_inv(norm_cdf(1.3)) - 1.3) < 1e-5


def test_target_formula():
    # mu 8/week, sigma 2, lead 3, 95% service: 24 + 1.644854 * 2 * sqrt(3)
    assert target_for(8.0, 2.0, 3, norm_inv(0.95)) == 30
    # zero nominal lead still covers the one week goods need to land
    assert target_for(8.0, 0.0, 0, norm_inv(0.95)) == 8


def test_out_zero_lead_time_zero_backlog():
    """Spec: order-up-to with zero lead time and known demand gives
    zero backlog."""
    cfg = dict(BASE, orderDelay=0, shipDelay=0)
    r = simulate(cfg, [4] * 36, [OUT] * 4)
    for s in r["stages"]:
        assert sum(s["backlogEnd"]) == 0
        assert s["fillRate"] == 1.0


def test_passthrough_bullwhip_textbook():
    """Spec: the bullwhip ratio of pass-through equals the textbook
    value on a constructed case. The retailer's incoming order is the
    demand itself, so its orders are the demand series and the ratio
    is exactly 1; at every stage, pass-through orders equal the orders
    that came in, element for element."""
    r = simulate(BASE, STEP, [PASS] * 4)
    assert r["stages"][0]["bullwhip"] == 1.0
    for s in r["stages"]:
        assert s["orders"] == s["incoming"]


def test_smoothing_factor_one_equals_out():
    """Spec: smoothing factor 1 equals plain order-up-to. The plain
    rule is the default (no alpha given); alpha scales the gap to the
    target, so alpha 1 must reproduce it exactly, order for order."""
    plain = simulate(BASE, STEP, [{"type": "out"}] * 4)
    smoothed = simulate(BASE, STEP, [{"type": "out", "alpha": 1.0}] * 4)
    assert plain == smoothed

    state = create_game(dict(BASE, infoSharing=True), STEP,
                        [{"type": "out", "alpha": 1.0}] * 4)
    state["inv"][0] = 4
    state["supply"][0] = 3
    state["backlog"][0] = 1
    gap = stage_target(state, 0) - (4 + 3 - 1)
    assert gap > 0
    assert policy_order(state, 0) == gap
    state["policies"][0] = {"type": "out", "alpha": 0.5}
    assert policy_order(state, 0) == math.floor(0.5 * gap + 0.5)


def test_scripted_game_is_exact():
    """A fully scripted game: every stage orders exactly the demand,
    so with full shelves nothing is ever owed at week's end."""
    cfg = dict(BASE, orderDelay=0, shipDelay=0)
    demand = [5] * 12
    pols = [{"type": "scripted", "orders": list(demand)} for _ in range(4)]
    r = simulate(cfg, demand, pols)
    for s in r["stages"]:
        assert s["orders"] == demand
        assert sum(s["backlogEnd"]) == 0
        assert s["fillRate"] == 1.0


def test_sterman_parameters_and_formula():
    """The bot uses Sterman's (1989) estimated parameters, and its
    order matches the published rule on a constructed state."""
    assert (STERMAN_THETA, STERMAN_ALPHA, STERMAN_BETA) == (0.36, 0.26, 0.34)
    cfg = dict(BASE, infoSharing=True)
    state = create_game(cfg, STEP, [{"type": "sterman"}] * 4)
    state["lastIncoming"][0] = 10
    state["hist"][0] = [10]
    state["inv"][0] = 6
    state["supply"][0] = 9
    state["dHat"][0] = 4.0
    target = stage_target(state, 0)
    d_hat = STERMAN_THETA * 10 + (1 - STERMAN_THETA) * 4.0
    expected = max(0, math.floor(d_hat + STERMAN_ALPHA * (target - 6 - STERMAN_BETA * 9) + 0.5))
    assert policy_order(state, 0) == expected


def test_lost_sales_cancels_instead_of_backlogging():
    """With the factory producing nothing, a lost-sales chain never
    carries a backlog (unfilled orders are cancelled and counted as
    lost), while a backlog chain piles the same orders up."""
    pols = [{"type": "passthrough"}] * 3 + [{"type": "scripted", "orders": [0] * 36}]
    lost = simulate(dict(BASE, costModel="lost"), STEP, pols)
    for s in lost["stages"]:
        assert sum(s["backlogEnd"]) == 0
    assert lost["stages"][0]["lost"] > 0
    back = simulate(BASE, STEP, pols)
    assert sum(back["stages"][0]["backlogEnd"]) > 0


def test_information_sharing_lowers_factory_bullwhip():
    """Lee, Padmanabhan and Whang (1997): sharing end-customer demand
    with upstream stages cuts the amplification at the factory."""
    off = simulate(BASE, STEP, [OUT] * 4)
    on = simulate(dict(BASE, infoSharing=True), STEP, [OUT] * 4)
    assert on["stages"][3]["bullwhip"] < off["stages"][3]["bullwhip"]
    assert on["chainCost"] < off["chainCost"]
