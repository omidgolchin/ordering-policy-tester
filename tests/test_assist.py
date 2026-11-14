"""The AI assist's plumbing: prompt, reply parsing, quote checks, test set.

The model itself is scored separately by scripts/eval_assist.js (needs an
API key); these tests need none.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not available")


def _node(js: str):
    proc = subprocess.run([NODE, "-e", js], capture_output=True, text=True, timeout=60, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_prompt_lists_every_field_and_the_text():
    out = _node(
        "const T=require('./docs/tool-common.js'),C=require('./docs/assist-config.js');"
        "const p=T._buildPrompt(C,'We order from a distributor, three weeks to arrive.');"
        "console.log(JSON.stringify({p, keys:C.fields.map(f=>f.key)}))")
    for k in out["keys"]:
        assert '"%s"' % k in out["p"]
    assert "We order from a distributor" in out["p"]
    assert "do not compute results" in out["p"].lower()


def test_reply_parsing_quotes_and_coercion():
    out = _node(
        "const T=require('./docs/tool-common.js');"
        "const r=T._parseReply('Sure!\\n```json\\n{\"fields\":{\"holdingCost\":{\"value\":\"0.40\",\"quote\":\"$0.40 a unit per week\"}},\"questions\":[]}\\n```');"
        "console.log(JSON.stringify({v:T._coerce({type:'number'},r.fields.holdingCost.value),"
        "q1:T._quoteFound('holding costs us $0.40   a unit per week',r.fields.holdingCost.quote),q2:T._quoteFound('nothing',r.fields.holdingCost.quote)}))")
    assert out == {"v": 0.4, "q1": True, "q2": False}


def test_bad_reply_raises():
    proc = subprocess.run([NODE, "-e", "require('./docs/tool-common.js')._parseReply('no json here')"],
                          capture_output=True, text=True, cwd=ROOT)
    assert proc.returncode != 0


def test_testset_uses_only_known_fields():
    keys = set(_node("console.log(JSON.stringify(require('./docs/assist-config.js').fields.map(f=>f.key)))"))
    items = json.loads((ROOT / "assist" / "testset.json").read_text())
    assert len(items) == 20
    for it in items:
        assert set(it["expected"]) <= keys, it["id"]
