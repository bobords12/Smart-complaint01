import argparse

import pandas as pd

from app.config import DATASET
from app.preprocessing import clean_text

REQUIRED = {"record_id", "complaint_text", "classification", "category", "language", "verified"}
BROAD = {"CIVIL", "CRIMINAL", "Administrative"}


def validate(path=DATASET):
    df = pd.read_excel(path, engine="openpyxl")
    missing = REQUIRED - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns: {sorted(missing)}")
    for column in ("complaint_text", "classification", "category"):
        if df[column].isna().any() or (df[column].astype(str).str.strip() == "").any():
            raise ValueError(f"Empty {column} values; correct dataset before training")
    if not set(df.classification.unique()) <= BROAD:
        raise ValueError(f"Unknown broad labels: {set(df.classification.unique()) - BROAD}")
    if df.record_id.isna().any() or df.record_id.duplicated().any():
        raise ValueError("Missing or duplicate record identifiers")
    verified = df.verified.map(lambda v: str(v).strip().casefold())
    if not verified.isin(["yes", "no", "true", "false", "1", "0"]).all():
        raise ValueError("Invalid verified field")
    if not verified.isin(["yes", "true", "1"]).all():
        raise ValueError("Unverified records require review before training")
    df = df.copy()
    df["complaint_text"] = df.complaint_text.map(clean_text)
    normalized = df.complaint_text.str.casefold().str.replace(r"\s+", " ", regex=True)
    if normalized.duplicated().any():
        raise ValueError(f"Duplicate narratives: {int(normalized.duplicated().sum())}")
    mapping = df.groupby("category").classification.nunique()
    if (mapping > 1).any():
        print(f"WARNING: categories with multiple broad labels (review source): {mapping[mapping > 1].index.tolist()}")
    counts = df.category.value_counts()
    print(f"Records: {len(df)}; broad: {df.classification.value_counts().to_dict()}")
    print(f"Languages: {df.language.value_counts(dropna=False).to_dict()}")
    print(f"Verified: {df.verified.value_counts(dropna=False).to_dict()}")
    print(f"Categories ({len(counts)}): {counts.to_dict()}")
    print(f"Imbalance (max/min category): {counts.max() / counts.min():.2f}; minimum: {counts.min()}")
    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=DATASET)
    args = parser.parse_args()
    validate(args.dataset)
