"""The "Balanced to my costs" service level: the option's presence in
the page and the level its auto branch computes.

The hint under the select, "How the verdict is decided", the SERVICE
LEVEL check, the README and DECISIONS.md all describe this option, and
the check ends with "Pick 'Balanced to my costs' to use it" — so the
option has to exist in the select, and picking it has to set the level
from the visitor's costs (the critical ratio, shortage / (shortage +
holding), clamped to [0.5, 0.995]). These tests pin both, plus the
decision that 95% stays the default (DECISIONS.md, Product).
"""

import json
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class _SelectOptions(HTMLParser):
    """Collect the options of one <select> by id: value, text, selected."""

    def __init__(self, select_id):
        super().__init__()
        self.select_id = select_id
        self.in_select = False
        self.current = None
        self.options = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "select" and attrs.get("id") == self.select_id:
            self.in_select = True
        elif self.in_select and tag == "option":
            self.current = {"value": attrs.get("value"),
                            "selected": "selected" in attrs, "text": ""}

    def handle_data(self, data):
        if self.current is not None:
            self.current["text"] += data

    def handle_endtag(self, tag):
        if tag == "option" and self.current is not None:
            self.current["text"] = self.current["text"].strip()
            self.options.append(self.current)
            self.current = None
        elif tag == "select":
            self.in_select = False


def _service_level_options():
    parser = _SelectOptions("serviceLevel")
    parser.feed((ROOT / "docs" / "index.html").read_text(encoding="utf-8"))
    return parser.options


def test_balanced_option_exists_in_the_select():
    options = _service_level_options()
    assert [o["value"] for o in options] == ["auto", "0.9", "0.95", "0.99"]
    assert "Balanced to my costs" in options[0]["text"]


def test_95_percent_stays_the_default():
    selected = [o["value"] for o in _service_level_options() if o["selected"]]
    assert selected == ["0.95"]


def _auto_branch_results():
    """Run the page's own criticalRatio/serviceLevelFor in node.

    The two functions are pure, so their source is lifted out of
    docs/app.js and evaluated as shipped; if either goes missing the
    extraction fails and so does the test.
    """
    src = (ROOT / "docs" / "app.js").read_text(encoding="utf-8")
    fns = []
    for name in ("criticalRatio", "serviceLevelFor"):
        m = re.search(r"function %s\([^)]*\) \{[^}]*\}" % name, src)
        assert m, "docs/app.js no longer defines %s" % name
        fns.append(m.group(0))
    cases = [
        # [select value, holding cost, shortage cost]
        ["auto", 0.5, 1.0],    # the placeholder costs: 1 / 1.5
        ["auto", 1.0, 1.0],    # equal costs balance at 50%
        ["auto", 0.1, 3.0],    # dear shortages: 3 / 3.1
        ["auto", 0.25, 2.0],   # 2 / 2.25
        ["auto", 0.0, 1.0],    # ratio 1, clamped to 0.995
        ["auto", 1.0, 0.05],   # ratio under 0.5, clamped to 0.5
        ["0.95", 0.5, 1.0],    # a fixed level passes through untouched
        ["0.9", 0.1, 3.0],
    ]
    grid = [0.0, 0.05, 0.1, 0.5, 1.0, 2.0, 4.0, 100.0]
    js = "\n".join(fns) + """
const cases = %s, grid = %s;
const out = { cases: cases.map(c => serviceLevelFor(c[0], c[1], c[2])), grid: [] };
for (const hc of grid) for (const bc of grid) {
  if (hc === 0 && bc === 0) continue;  // the page rejects both-zero first
  out.grid.push(serviceLevelFor("auto", hc, bc));
}
console.log(JSON.stringify(out));""" % (json.dumps(cases), json.dumps(grid))
    proc = subprocess.run([NODE, "-e", js], capture_output=True, text=True,
                          timeout=60, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


@pytest.mark.skipif(NODE is None, reason="node not available")
def test_auto_branch_computes_the_critical_ratio():
    got = _auto_branch_results()["cases"]
    want = [2 / 3, 0.5, 3 / 3.1, 2 / 2.25, 0.995, 0.5, 0.95, 0.9]
    assert len(got) == len(want)
    for g, w in zip(got, want):
        assert g == pytest.approx(w, abs=1e-9)


@pytest.mark.skipif(NODE is None, reason="node not available")
def test_auto_branch_stays_sane_across_costs():
    grid = _auto_branch_results()["grid"]
    assert len(grid) == 63  # 8 x 8 cost pairs minus both-zero
    for level in grid:
        assert level == level  # never NaN
        assert 0.5 <= level <= 0.995
