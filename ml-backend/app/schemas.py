from pydantic import BaseModel, Field, field_validator


class PredictionRequest(BaseModel):
    complaint_text: str = Field(min_length=1, max_length=5000)

    @field_validator("complaint_text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Complaint text must not be blank")
        return value.strip()


class PredictionResponse(BaseModel):
    broad_classification: str
    specific_category: str
    model_version: str
    requires_human_review: bool = True
