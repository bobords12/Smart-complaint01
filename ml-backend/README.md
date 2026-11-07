# Existing complaint system: notebook SVM integration

## Architecture and prerequisites

```
Resident form / kiosk (encrypted browser IndexedDB queue) / staff-assisted filing
  -> Next.js server routes (/api/classify, /api/classify/attach, /api/kiosk/submit)
  -> private FastAPI ML service (two independently fitted TF-IDF + LinearSVC pipelines)
  -> broad enum suggestion + exact specific category
  -> existing Supabase create_complaint / kiosk_submit_complaint / staff-assisted RPCs
  -> Captain/OIC review in CategorizationTab; secretary read-only
```

Python 3.11 or 3.12 must be installed (install from python.org if necessary; select **Add Python to PATH**). On Windows CMD, starting at the repository root:

```cmd
cd ml-backend
py -3.12 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m scripts.validate_dataset
python -m scripts.train_model
python -m scripts.evaluate_model
python -m pytest -q
set ML_API_KEY=replace-with-a-long-random-secret
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If the `py` launcher is absent, use `python -m venv .venv` after confirming `python --version` says 3.11 or 3.12. Keep this CMD window open. Open `http://127.0.0.1:8000/docs` for Swagger; send `X-ML-API-Key` via Swagger's endpoint header or curl. `/health` reports readiness without a key; `/api/ml/model-info` and `/api/ml/predict` require the key.

From a **second CMD** at the repository root:

```cmd
set ML_SERVICE_URL=http://127.0.0.1:8000
set ML_API_KEY=replace-with-the-same-long-random-secret
npm install
npm run dev
```

The Next server needs its existing `.env` Supabase settings including `SUPABASE_SERVICE_ROLE_KEY` for server-only updates. Never use `NEXT_PUBLIC_` for the ML key or service-role key. Bind the Python API to loopback on a single-host deployment; for multiple hosts use a private authenticated network and HTTPS. Set `ML_CORS_ORIGINS` to comma-separated approved browser origins only if a browser really calls FastAPI directly (the integration here is server-to-server, so the default is no allowed browser origins). Set `ML_MODEL_DIR` only for a trusted locally generated artifact directory; never load downloaded/untrusted joblib files. Protect the original spreadsheet and models with filesystem permissions. Apply `supabase/manual/35_svm_specific_prediction.sql` with the Supabase SQL editor **after** existing kiosk and RBAC scripts before enabling prediction writes; do not re-run initial schema scripts.

## Dataset and training

The original spreadsheet remains at `../FINALDATA.xlsx` and notebook at `../NLP_Linear_SVM_Complaint_Classification.ipynb`; no replacement samples are generated. The validated file contains 600 verified-`Yes` narratives (488 Bisaya, 112 English), 255 CIVIL, 234 CRIMINAL and 111 Administrative. The 32 labels, frequencies, and warnings are printed by `python -m scripts.validate_dataset`; labels are also enumerated in `models/metadata.json`. Specifically, Ejectment has 23 CIVIL and 3 CRIMINAL rows; Family Property Dispute has 23 CIVIL and 1 CRIMINAL row. These four source rows need domain review; no labels have been silently corrected. Verified means the field reads `Yes`, not that these disagreements were resolved. Blank texts/labels, unverified rows, duplicate narratives and invalid broad labels stop training. A category appearing under multiple broad labels raises a review warning because the notebook trains the two targets independently.

The notebook's word (1,2) and char (3,5) TF-IDF (50,000 features each, sublinear term frequency) feed balanced LinearSVC (C=1, seed 42, max_iter=10,000), once for each target. The 80/20 category-stratified seed-42 split is shared. The validator refuses insufficient support, missing labels on either split, and char-TF-IDF near-duplicates with cross-split similarity >= 0.98. Vectorizers are fitted only on training narratives. No translation, stopword removal, identifiers or extra metadata enter the features. The saved pipelines represent the 480-row training split; the other 120 rows are held out for evaluation and **not** refitted into the deployed models. After reviewing updated data, replace the root spreadsheet with an approved version and rerun validation, training and tests, then restart FastAPI and record the new SHA-256/version before deployment. Do not tune against the held-out test repeatedly.

Actual results from `models/metadata.json` and `models/reports/`:

| Task | Accuracy | Macro precision | Macro recall | Macro F1 | Weighted F1 |
|---|---:|---:|---:|---:|---:|
| Broad (3 classes) | 0.7750 | 0.7698 | 0.7586 | 0.7634 | 0.7747 |
| Specific (32 classes) | 0.3500 | 0.3444 | 0.3179 | 0.3053 | 0.3431 |

Reports provide per-category performance and full labeled CSV confusion matrices. The specific-category model performs poorly for several rare categories: review every result and gather more representative labeled data before treating it as operational advice. LinearSVC decision scores are not probabilities and no confidence percentage is supplied. The outputs are **suggestions**, never a legal decision.

## API and storage

`GET /health` returns `{"status":"ok","models_loaded":true}` if both pipelines loaded (otherwise `unavailable`/false). Authenticated `GET /api/ml/model-info` returns version, labels, algorithm, dataset fingerprint and held-out evaluation metrics. Authenticated `POST /api/ml/predict` expects JSON `{"complaint_text":"Ang among silingan sige og saba kada gabii."}` and returns `broad_classification`, `specific_category`, `model_version`, `requires_human_review: true`; labels come directly from the models. Blank text or >5000 characters yields HTTP 422; missing/invalid secret yields 401; missing/corrupt models yields 503. FastAPI validates inputs, applies a per-process 60/min/IP limit, suppresses complaint narratives in errors, and does not connect to Supabase.

Next.js translates `CIVIL`/`CRIMINAL`/`Administrative` into existing enum spellings `Civil`/`Criminal`/`Administrative`. It stores model suggestions in `predicted_category`, `predicted_case_type`, **new** `predicted_specific_category`, `prediction_model`, `classification_status`, and `classification_at`. `prediction_confidence` remains NULL. Existing `confirmed_category`, `confirmed_case_type`, `confirmed_urgency` remain the official broad decision; `confirmed_specific_category` is an additive official value. Only Captain/OIC may save/correct the specific label through `confirm_specific_category` (audited in `audit_logs`); existing review logic retains its broad/urgency decision and history. The SQL guard prevents overwriting reviewed predictions. Apply the migration to see the new field in the dashboard.

Resident submission still calls the existing authenticated `create_complaint` RPC, evidence and receipt flows. It posts the saved ID to `/api/classify/attach`, which reads the narrative with session RLS and re-predicts server-side. The kiosk still uses `kiosk_submit_complaint`; on sync the Next server predicts from the validated narrative and ignores browser-supplied classification fields. Kiosk retries retain their idempotency UUID, and a repeated response can fill a missing prediction without filing twice. The actual offline store here is AES-GCM encrypted **IndexedDB**, not SQLite; service-worker/tab sync and notification logic are unchanged. No offline ML inference is claimed. Staff-assisted filing uses its existing authenticated RPC and attaches a server suggestion afterward. If ML or the migration is unavailable, submissions remain in the existing workflow with `classification_status=pending`; Captain/OIC can retry via the Categorization tab or record a manual decision. No automatic retry of already-synced kiosk complaints is scheduled: an authorized reviewer should retry those pending complaints.

Troubleshooting: a false `/health.models_loaded` requires trusted `models/*.joblib` and `models/metadata.json` from training and compatible package versions. A 503 from Next means check `ML_SERVICE_URL`, matching `ML_API_KEY`, FastAPI availability and its bind address. Browser CORS is not needed for the Next proxy; for direct Swagger use, configure exact `ML_CORS_ORIGINS`. If a filing succeeds but the specific label stays pending, apply migration 35, configure the server-only Supabase service-role credential and use the review retry control. Do not share complaint text, spreadsheet or model files with external AI services.
