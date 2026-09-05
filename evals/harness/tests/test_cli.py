import json
import os
import shutil
from pathlib import Path

import pytest
from fib_evals.cli import main
from fib_service.providers import fake_provider
from fib_service.settings import get_settings

REPO_ROOT = Path(__file__).resolve().parents[3]
CASES_DIR = REPO_ROOT / "evals" / "synthetic" / "cases"
FORMS_DIR = REPO_ROOT / "configs" / "forms"

EXPECTED_FIELD_KEYS = [
    "issuerName",
    "dealAmount",
    "currency",
    "settlementDate",
    "isConfidential",
    "feeType",
    "parties.partyName",
    "parties.role",
    "parties.amount",
]


@pytest.fixture(autouse=True)
def _restore_config_env():
    """main() mutates CONFIGS_DIR and the settings cache; undo that after each test."""
    saved = os.environ.get("CONFIGS_DIR")
    yield
    if saved is None:
        os.environ.pop("CONFIGS_DIR", None)
    else:
        os.environ["CONFIGS_DIR"] = saved
    get_settings.cache_clear()


def test_synthetic_golden_set_meets_full_accuracy(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(
            [
                "--forms",
                str(FORMS_DIR),
                "--golden",
                str(CASES_DIR),
                "--provider",
                "fake",
                "--min-accuracy",
                "1.0",
                "--out",
                str(tmp_path),
            ]
        )
    assert excinfo.value.code == 0

    report = json.loads((tmp_path / "report.json").read_text())
    assert report["met"] is True
    form = report["forms"]["fixtureDeal"]
    fields = {field["field"]: field for field in form["fields"]}
    assert sorted(fields) == sorted(EXPECTED_FIELD_KEYS)
    for key in EXPECTED_FIELD_KEYS[:6]:  # main-group fields: one observation per case
        assert fields[key]["n"] == 3
        assert fields[key]["exactPct"] == 100.0
    for key in EXPECTED_FIELD_KEYS[6:]:  # parties rows: 1 + 1 + 2 observations
        assert fields[key]["n"] == 4
        assert fields[key]["citationValidPct"] == 100.0
    assert form["overall"]["n"] == 30
    assert form["overall"]["exactPct"] == 100.0

    markdown = (tmp_path / "report.md").read_text()
    assert "## fixtureDeal" in markdown
    assert "| field | n | exact % | normalised % | fuzzy % | citation-valid % |" in markdown
    assert "| **overall** | 30 | 100.0 | 100.0 | 100.0 | 100.0 |" in markdown


def test_wrong_expected_value_in_temp_copy_exits_one(tmp_path: Path) -> None:
    golden_copy = tmp_path / "golden"
    shutil.copytree(CASES_DIR, golden_copy)
    expected_path = golden_copy / "fixtureDeal" / "basic-usd" / "expected.json"
    expected = json.loads(expected_path.read_text())
    expected["fields"]["issuerName"] = "Morgan Stanley Limited"
    expected_path.write_text(json.dumps(expected))

    with pytest.raises(SystemExit) as excinfo:
        main(
            [
                "--forms",
                str(FORMS_DIR),
                "--golden",
                str(golden_copy),
                "--provider",
                "fake",
                "--min-accuracy",
                "1.0",
                "--out",
                str(tmp_path / "out"),
            ]
        )
    assert excinfo.value.code == 1


def test_min_accuracy_zero_passes_empty_expectations(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    golden = tmp_path / "golden" / "fixtureDeal" / "empty"
    golden.mkdir(parents=True)
    (golden / "documentSet.json").write_text(
        json.dumps(
            {
                "setId": "set-1",
                "sources": [{"sourceId": "s1", "kind": "upload", "name": "a.pdf", "mime": "application/pdf"}],
                "manifest": [{"mergedPage": 1, "sourceId": "s1", "sourcePage": 1}],
                "pages": [
                    {
                        "mergedPage": 1,
                        "width": 612,
                        "height": 792,
                        "items": [{"id": "p1i0", "text": "nothing", "x": 0, "y": 0, "w": 1, "h": 1}],
                    }
                ],
            }
        )
    )
    (golden / "expected.json").write_text(json.dumps({"fields": {}, "groups": {}}))

    # Extraction still runs (and needs canned responses), but nothing is expected, so
    # every field comes back null; the fixtures live in a throwaway dir.
    fixtures_dir = tmp_path / "fixtures"
    fixtures_dir.mkdir()
    null_cell = {"value": None, "itemIds": [], "quote": "", "confidence": 0.0, "reason": None}
    (fixtures_dir / "fixtureDeal_main__empty.json").write_text(
        json.dumps({field_id: null_cell for field_id in ("issuerName", "dealAmount", "currency", "settlementDate", "isConfidential", "feeType")})
    )
    (fixtures_dir / "fixtureDeal_parties__empty.json").write_text(json.dumps([]))
    monkeypatch.setattr(fake_provider, "DEFAULT_FIXTURES_DIR", fixtures_dir)

    with pytest.raises(SystemExit) as excinfo:
        main(
            [
                "--forms",
                str(FORMS_DIR),
                "--golden",
                str(tmp_path / "golden"),
                "--provider",
                "fake",
                "--out",
                str(tmp_path / "out"),
            ]
        )
    assert excinfo.value.code == 0
