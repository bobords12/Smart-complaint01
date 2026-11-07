def clean_text(value: str) -> str:
    """Preserve original language, punctuation and meaningful whitespace."""
    return value.strip()
