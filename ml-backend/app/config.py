import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT.parent / "FINALDATA.xlsx"
MODELS = Path(os.environ.get("ML_MODEL_DIR", ROOT / "models")).resolve()
VERSION = "1.0.0"
