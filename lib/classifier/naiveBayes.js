/**
 * TF-IDF weighted Multinomial Naive Bayes.
 *
 * Small enough to train in memory on every cold start (a few hundred
 * documents, milliseconds) and honest about what it is:
 *
 *  - Features are unigrams + bigrams from preprocess.featurize().
 *  - Document frequency prunes the vocabulary (terms never seen in
 *    training, or appearing in more than 60% of documents, are
 *    dropped — the latter carry no class-discriminating signal).
 *  - Each term weight is sublinear TF x IDF: (1 + ln tf) * (ln(N/df)+1).
 *  - Class parameters are multinomial with Laplace smoothing, trained
 *    on those weighted counts.
 *  - A document scores each class as log prior + sum of
 *    weight * log(theta_term|class).
 *  - Confidence is a softmax (normalized exponential) over the class
 *    scores: a relative model score on 0-1, not a calibrated
 *    real-world probability. It answers "how strongly does the model
 *    prefer this class over the alternatives for this text".
 */

const DF_MAX_RATIO = 0.6;
// Keep terms seen at least once, but drop anything so ubiquitous it
// appears in most documents (no class-discriminating signal).
const MIN_DF = 1;

function ln(x) {
  return Math.log(x);
}

/**
 * @param {string[][]} docs  featurized documents (unigrams + bigrams)
 * @param {string[]}   labels one label per document
 * @param {{alpha?: number}} [options]
 */
export function trainClassifier(docs, labels, options = {}) {
  const alpha = options.alpha ?? 1;
  const N = docs.length;
  if (N === 0 || N !== labels.length) {
    throw new Error("trainClassifier: empty or mismatched training set");
  }

  // --- document frequency -------------------------------------------
  const df = new Map();
  for (const feats of docs) {
    const seen = new Set(feats);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }

  const vocab = [];
  const idf = new Map();
  for (const [term, count] of df) {
    if (count < MIN_DF) continue;
    if (count > DF_MAX_RATIO * N) continue;
    vocab.push(term);
    idf.set(term, ln(N / count) + 1);
  }
  vocab.sort();
  const vocabIndex = new Map(vocab.map((t, i) => [t, i]));
  const V = vocab.length;

  // --- classes -------------------------------------------------------
  const classes = [...new Set(labels)].sort();
  const classIndex = new Map(classes.map((c, i) => [c, i]));
  const K = classes.length;
  const classDocCounts = new Array(K).fill(0);
  // weighted term counts per class (flat typed arrays: V per class)
  const weighted = new Float64Array(K * V);
  const weightedTotal = new Float64Array(K);

  const tf = new Map();
  for (let d = 0; d < docs.length; d += 1) {
    const c = classIndex.get(labels[d]);
    classDocCounts[c] += 1;
    tf.clear();
    for (const t of docs[d]) {
      if (!vocabIndex.has(t)) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    for (const [term, count] of tf) {
      const w = (1 + ln(count)) * idf.get(term);
      const idx = c * V + vocabIndex.get(term);
      weighted[idx] += w;
      weightedTotal[c] += w;
    }
  }

  // --- priors and smoothed log-theta ---------------------------------
  const logPrior = new Float64Array(K);
  for (let c = 0; c < K; c += 1) {
    logPrior[c] = ln((classDocCounts[c] + alpha) / (N + alpha * K));
  }

  const logTheta = new Float64Array(K * V);
  for (let c = 0; c < K; c += 1) {
    const denom = weightedTotal[c] + alpha * V;
    for (let t = 0; t < V; t += 1) {
      logTheta[c * V + t] = ln((weighted[c * V + t] + alpha) / denom);
    }
  }

  return {
    classes,
    vocab,
    vocabIndex,
    idf,
    logPrior,
    logTheta,
    V,
    K,
    N,
    alpha,
  };
}

/**
 * Predict one featurized document.
 * @returns {{label: string, probabilities: Record<string, number>,
 *            scores: Record<string, number>, matchedTerms: number}}
 */
export function predictClassifier(model, feats) {
  const { classes, vocabIndex, idf, logPrior, logTheta, V, K } = model;

  // sublinear TF x IDF over in-vocabulary terms
  const tf = new Map();
  for (const t of feats) {
    if (!vocabIndex.has(t)) continue;
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  const scores = new Float64Array(K);
  for (let c = 0; c < K; c += 1) scores[c] = logPrior[c];

  if (tf.size > 0) {
    for (const [term, count] of tf) {
      const w = (1 + ln(count)) * idf.get(term);
      const col = vocabIndex.get(term);
      for (let c = 0; c < K; c += 1) {
        scores[c] += w * logTheta[c * V + col];
      }
    }
  }

  // softmax with log-sum-exp for numerical stability
  let max = -Infinity;
  for (let c = 0; c < K; c += 1) if (scores[c] > max) max = scores[c];
  let sum = 0;
  const probs = new Float64Array(K);
  for (let c = 0; c < K; c += 1) {
    probs[c] = Math.exp(scores[c] - max);
    sum += probs[c];
  }

  let bestIdx = 0;
  for (let c = 1; c < K; c += 1) if (probs[c] > probs[bestIdx]) bestIdx = c;

  const probabilities = {};
  const scoreOut = {};
  for (let c = 0; c < K; c += 1) {
    probabilities[classes[c]] = probs[c] / sum;
    scoreOut[classes[c]] = scores[c];
  }

  return {
    label: classes[bestIdx],
    probabilities,
    scores: scoreOut,
    matchedTerms: tf.size,
  };
}
