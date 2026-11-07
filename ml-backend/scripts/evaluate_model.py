import json
from app.config import MODELS

if __name__ == "__main__":
    metadata = json.loads((MODELS / "metadata.json").read_text(encoding="utf-8"))
    for name, metrics in metadata["metrics"].items():
        print(name, {key: metrics[key] for key in ("accuracy", "macro_precision", "macro_recall", "macro_f1", "weighted_f1")})
        print((MODELS / "reports" / f"{name}.txt").read_text(encoding="utf-8"))
