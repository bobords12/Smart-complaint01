import json
from pathlib import Path

import joblib


def load_models(directory: Path):
    """Only deserialize trusted locally trained artifacts from the configured directory."""
    metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
    models = {}
    for name in ("broad_classification", "specific_category"):
        models[name] = joblib.load(directory / f"{name}_svm.joblib")
        if set(models[name].classes_) != set(metadata["labels"][name]):
            raise ValueError("Model labels disagree with metadata")
    return models, metadata
