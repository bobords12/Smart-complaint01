import pytest
from scripts.validate_dataset import validate


def test_real_dataset():
    data = validate()
    assert len(data) == 600
    assert len(data.category.unique()) == 32
    assert set(data.language) == {"English", "Bisaya"}


def test_invalid_dataset_blocks_training(tmp_path):
    data = validate()
    data.loc[0, "complaint_text"] = " "
    path = tmp_path / "invalid.xlsx"
    data.to_excel(path, index=False)
    with pytest.raises(ValueError, match="Empty complaint_text"):
        validate(path)
