from fastapi.testclient import TestClient

from app.main import app, requests_by_ip


def test_auth_health_prediction(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "a-test-key")
    requests_by_ip.clear()
    with TestClient(app) as client:
        assert client.get("/health").json()["models_loaded"]
        assert client.post("/api/ml/predict", json={"complaint_text": "Noise"}).status_code == 401
        headers = {"X-ML-API-Key": "a-test-key"}
        assert client.post("/api/ml/predict", headers=headers, json={"complaint_text": "   "}).status_code == 422
        assert client.post("/api/ml/predict", headers=headers, json={"complaint_text": "x" * 5001}).status_code == 422
        result = client.post("/api/ml/predict", headers=headers,
                             json={"complaint_text": "Ang silingan sige ug saba matag gabii."})
        assert result.status_code == 200
        assert result.json()["specific_category"] in client.get("/api/ml/model-info", headers=headers).json()["labels"]["specific_category"]
        assert "complaint_text" not in str(result.json())


def test_missing_models(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_API_KEY", "a-test-key")
    monkeypatch.setattr("app.main.MODELS", tmp_path)
    with TestClient(app) as client:
        assert client.get("/health").json()["models_loaded"] is False
        response = client.post("/api/ml/predict", headers={"X-ML-API-Key": "a-test-key"},
                               json={"complaint_text": "Complaint details"})
        assert response.status_code == 503
        assert str(tmp_path) not in response.text


def test_corrupted_model_does_not_leak_exception(monkeypatch, tmp_path):
    (tmp_path / "metadata.json").write_text('{"labels": {}}', encoding="utf-8")
    (tmp_path / "broad_classification_svm.joblib").write_bytes(b"not a model")
    monkeypatch.setattr("app.main.MODELS", tmp_path)
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.json()["models_loaded"] is False
        assert str(tmp_path) not in response.text
