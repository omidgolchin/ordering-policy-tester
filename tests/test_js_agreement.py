"""The JavaScript engine against the Python reference on three fixed
games (spec: JS and Python engines agree on 3 fixed games), plus the
full comparison on the classic game."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from sim.chain import evaluate_series, simulate

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not available")

GAMES = [
    (dict(orderDelay=1, shipDelay=2, holdingCost=0.5, backlogCost=1.0, costModel="backlog", infoSharing=False, serviceLevel=0.95),
     [4] * 4 + [8] * 32, [{"type": "out", "alpha": 1.0}] * 4),
    (dict(orderDelay=0, shipDelay=1, holdingCost=0.25, backlogCost=2.0, costModel="lost", infoSharing=False, serviceLevel=0.9, forecastWeeks=5),
     [5, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12, 12, 9, 5, 2, 2, 5, 9, 12],
     [{"type": "sterman"}, {"type": "passthrough"}, {"type": "out", "alpha": 0.5}, {"type": "scripted", "orders": [7] * 36}]),
    (dict(orderDelay=0, shipDelay=0, holdingCost=1.0, backlogCost=0.75, costModel="backlog", infoSharing=True, serviceLevel=0.99),
     [0, 3, 0, 6, 2, 0, 0, 9, 4, 4, 1, 0, 7, 7, 2, 0, 3, 3, 0, 5, 8, 1, 1, 0, 0, 4, 6, 2, 9, 0, 1, 1, 3, 0, 2, 5],
     [{"type": "out", "alpha": 0.4}, {"type": "sterman"}, {"type": "passthrough"}, {"type": "out", "alpha": 1.0}]),
]


def _close(a, b, path=""):
    if isinstance(a, dict):
        assert set(a) == set(b), path
        for k in a:
            _close(a[k], b[k], path + "/" + str(k))
    elif isinstance(a, list):
        assert len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            _close(x, y, path + "/" + str(i))
    elif isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            assert a == b, (path, a, b)
        else:
            assert abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b)), (path, a, b)
    else:
        assert a == b, (path, a, b)


def test_js_and_python_agree():
    proc = subprocess.run([NODE, str(ROOT / "sim" / "js_check.mjs")],
                          capture_output=True, text=True, timeout=120, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    js = json.loads(proc.stdout)
    py_games = [simulate(c, d, p) for c, d, p in GAMES]
    _close(js["games"], py_games, "games")
    ev = evaluate_series(GAMES[0][0], [GAMES[0][1]], 0)
    py_ev = {"rules": ev["rules"], "recommendation": ev["recommendation"],
             "target": ev["target"], "sharingAlt": ev["sharingAlt"],
             "altModelBest": ev["altModelBest"], "smoothCurve": ev["smoothCurve"]}
    _close(js["ev"], py_ev, "ev")
