import hashlib
import json
import csv
from datetime import datetime, timezone

import joblib
import numpy as np
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix,
                             f1_score, precision_score, recall_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.svm import LinearSVC

from app.config import DATASET, MODELS, VERSION
from scripts.validate_dataset import validate


def build_model():
    return Pipeline([
        ("features", FeatureUnion([
            ("word_tfidf", TfidfVectorizer(analyzer="word", ngram_range=(1, 2),
                                            max_features=50000, sublinear_tf=True)),
            ("char_tfidf", TfidfVectorizer(analyzer="char", ngram_range=(3, 5),
                                            max_features=50000, sublinear_tf=True)),
        ])),
        ("svm", LinearSVC(C=1.0, class_weight="balanced", random_state=42, max_iter=10000)),
    ])


def train(dataset=DATASET, output=MODELS):
    df = validate(dataset)
    counts = df.category.value_counts()
    if counts.min() < 2 or len(counts) > int(np.ceil(len(df) * 0.2)):
        raise ValueError("Insufficient category support for stratified 80/20 split")
    train_ids, test_ids = train_test_split(np.arange(len(df)), test_size=0.2,
                                          random_state=42, stratify=df.category)
    for field in ("classification", "category"):
        if set(df.iloc[train_ids][field]) != set(df.iloc[test_ids][field]):
            raise ValueError(f"Split omits {field} labels on one side")
    # Detect highly similar template variants before fitting on held-out narratives.
    checker = TfidfVectorizer(analyzer="char", ngram_range=(3, 5))
    matrix = checker.fit_transform(df.complaint_text)
    similarities = matrix[train_ids] @ matrix[test_ids].T
    overlaps = int((similarities >= 0.98).sum())
    if overlaps:
        raise ValueError(f"{overlaps} near-duplicate train/test pairs (char TF-IDF >= 0.98); review dataset/split")

    output.mkdir(parents=True, exist_ok=True)
    reports = output / "reports"
    reports.mkdir(exist_ok=True)
    metrics = {}
    targets = {"broad_classification": "classification", "specific_category": "category"}
    for name, field in targets.items():
        labels = sorted(df[field].unique().tolist())
        model = build_model()
        model.fit(df.complaint_text.iloc[train_ids], df[field].iloc[train_ids])
        actual = df[field].iloc[test_ids]
        predicted = model.predict(df.complaint_text.iloc[test_ids])
        metrics[name] = {
            "accuracy": float(accuracy_score(actual, predicted)),
            "macro_precision": float(precision_score(actual, predicted, average="macro", zero_division=0)),
            "macro_recall": float(recall_score(actual, predicted, average="macro", zero_division=0)),
            "macro_f1": float(f1_score(actual, predicted, average="macro", zero_division=0)),
            "weighted_f1": float(f1_score(actual, predicted, average="weighted", zero_division=0)),
            "classification_report": classification_report(actual, predicted, labels=labels,
                                                               zero_division=0, output_dict=True),
            "confusion_matrix": confusion_matrix(actual, predicted, labels=labels).tolist(),
        }
        matrix_values = confusion_matrix(actual, predicted, labels=labels)
        with (reports / f"{name}_confusion.csv").open("w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["actual \\ predicted", *labels])
            writer.writerows([[label, *row] for label, row in zip(labels, matrix_values)])
        (reports / f"{name}.txt").write_text(
            f"Held-out 80/20 classification report ({len(test_ids)} records)\n"
            + classification_report(actual, predicted, labels=labels, zero_division=0)
            + f"\nLabels (rows actual, columns predicted): {labels}\n"
            + f"Full confusion matrix: {name}_confusion.csv"
            + "\n", encoding="utf-8")
        joblib.dump(model, output / f"{name}_svm.joblib")
    metadata = {
        "model_version": VERSION, "algorithm": "word + character TF-IDF FeatureUnion + LinearSVC",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "training_records": len(train_ids), "testing_records": len(test_ids),
        "labels": {name: sorted(df[field].unique().tolist()) for name, field in targets.items()},
        "metrics": metrics, "scikit_learn_version": sklearn.__version__,
        "near_duplicate_threshold": 0.98, "near_duplicate_cross_split_pairs": overlaps,
        "random_state": 42, "test_size": 0.2,
    }
    (output / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({name: {key: value for key, value in result.items()
                              if key not in ("classification_report", "confusion_matrix")}
                      for name, result in metrics.items()}, indent=2))
    return metadata


if __name__ == "__main__":
    train()
