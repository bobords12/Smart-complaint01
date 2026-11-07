from app.config import MODELS
from app.model_loader import load_models
from app.prediction_service import predict


def test_saved_models_and_multilingual_inference():
    models, metadata = load_models(MODELS)
    for text in ("Ang silingan sige ug saba matag gabii.",
                 "My neighbor makes too much noise at night.",
                 "Our silingan stole my phone ug wala gibalik."):
        first = predict(models, metadata, text)
        assert first == predict(models, metadata, text)
        assert first.broad_classification in metadata["labels"]["broad_classification"]
        assert first.specific_category in metadata["labels"]["specific_category"]
        assert first.requires_human_review
