from app.schemas import PredictionResponse


def predict(models, metadata, text):
    return PredictionResponse(
        broad_classification=str(models["broad_classification"].predict([text])[0]),
        specific_category=str(models["specific_category"].predict([text])[0]),
        model_version=metadata["model_version"],
    )
