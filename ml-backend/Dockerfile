# Provider-neutral FastAPI inference image; build from the ml-backend directory.
# A build without the ORIGINAL trained artifacts fails rather than deploying an empty model.
FROM python:3.12-slim
WORKDIR /service
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
COPY models/metadata.json models/broad_classification_svm.joblib models/specific_category_svm.joblib ./models/
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
