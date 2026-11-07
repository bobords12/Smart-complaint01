import hmac
import os
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import MODELS
from app.model_loader import load_models
from app.prediction_service import predict
from app.schemas import PredictionRequest, PredictionResponse


def authorize(x_ml_api_key: str | None = Header(default=None)):
    key = os.environ.get("ML_API_KEY", "")
    if not key or not x_ml_api_key or not hmac.compare_digest(x_ml_api_key, key):
        raise HTTPException(status_code=401, detail="Unauthorized")


@asynccontextmanager
async def lifespan(app):
    app.state.models = None
    app.state.metadata = None
    try:
        app.state.models, app.state.metadata = load_models(MODELS)
    except Exception:
        # Stay up to report model unavailability without exposing file paths.
        pass
    yield


app = FastAPI(title="Barangay complaint classifier", lifespan=lifespan)
origins = [origin.strip() for origin in os.environ.get("ML_CORS_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"],
                   allow_headers=["X-ML-API-Key", "Content-Type"])

# Small per-process limiter; enforce network-level limits as well when deploying multiple workers.
requests_by_ip = defaultdict(deque)


@app.get("/health")
def health(request: Request):
    ready = request.app.state.models is not None
    return {"status": "ok" if ready else "unavailable", "models_loaded": ready}


@app.get("/api/ml/model-info", dependencies=[Depends(authorize)])
def model_info(request: Request):
    if request.app.state.metadata is None:
        raise HTTPException(status_code=503, detail="Models unavailable")
    return request.app.state.metadata


@app.post("/api/ml/predict", response_model=PredictionResponse, dependencies=[Depends(authorize)])
def classify(request: Request, payload: PredictionRequest):
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent = requests_by_ip[ip]
    while recent and recent[0] < now - 60:
        recent.popleft()
    if len(recent) >= 60:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    recent.append(now)
    if request.app.state.models is None:
        raise HTTPException(status_code=503, detail="Models unavailable")
    try:
        return predict(request.app.state.models, request.app.state.metadata, payload.complaint_text)
    except Exception:
        raise HTTPException(status_code=503, detail="Prediction unavailable") from None
