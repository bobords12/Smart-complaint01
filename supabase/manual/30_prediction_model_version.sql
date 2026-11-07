-- The complaint classifier changed from the old keyword ruleset
-- (labelled "tfidf-svm-v1") to TF-IDF weighted Multinomial Naive
-- Bayes (labelled "tfidf-nb-v1"). Existing rows keep their
-- historical label; only the default applied to new rows changes.

ALTER TABLE complaints
  ALTER COLUMN prediction_model SET DEFAULT 'tfidf-nb-v1';

ALTER TABLE complaint_classification_logs
  ALTER COLUMN model_version SET DEFAULT 'tfidf-nb-v1';
