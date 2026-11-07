import assert from "node:assert/strict";
import { test } from "node:test";
import { mlRequestTimeout, requestMlPrediction } from "../lib/mlPredictionRequest.mjs";

test("inference timeout is bounded and staging-configurable", () => {
  assert.equal(mlRequestTimeout(undefined), 3500);
  assert.equal(mlRequestTimeout(12500), 12500);
  assert.equal(mlRequestTimeout(-1), 3500);
  assert.equal(mlRequestTimeout(1000000), 3500);
});

test("server proxy sends only narrative and secret to private ML service", async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:8000/api/ml/predict");
    assert.equal(options.headers["X-ML-API-Key"], "server-secret");
    assert.deepEqual(JSON.parse(options.body), { complaint_text: "Ang among silingan saba." });
    return { ok: true, json: async () => ({ broad_classification: "CIVIL",
      specific_category: "Neighbor Noise Dispute", model_version: "1.0.0" }) };
  };
  const result = await requestMlPrediction({ text: "Ang among silingan saba.",
    url: "http://127.0.0.1:8000/", key: "server-secret", fetcher });
  assert.equal(calls, 1);
  assert.deepEqual(result, { caseType: "Civil", category: "Neighbor Noise Dispute", modelVersion: "1.0.0" });
});

test("failure and malformed response leave classification pending without invented fallback", async () => {
  const params = { text: "My complaint", url: "http://localhost:8000", key: "secret" };
  assert.equal(await requestMlPrediction({ ...params, fetcher: async () => { throw Error("offline"); } }), null);
  assert.equal(await requestMlPrediction({ ...params, fetcher: async () => ({ ok: false }) }), null);
  assert.equal(await requestMlPrediction({ ...params, fetcher: async () => ({ ok: true,
    json: async () => ({ broad_classification: "FAKE", specific_category: "Other", model_version: "1" }) }) }), null);
  assert.equal(await requestMlPrediction({ ...params, key: "", fetcher: async () => { throw Error("called"); } }), null);
});

test("a slow service fails without fabricating a prediction", async () => {
  const fetcher = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const result = await requestMlPrediction({ text: "My complaint", url: "http://localhost:8000",
    key: "secret", timeoutMs: 500, fetcher });
  assert.equal(result, null);
});
