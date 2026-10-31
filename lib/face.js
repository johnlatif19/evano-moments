"use strict";

const CONFIG = {
  MODEL_VERSION: "face-api@1.7-tiny",
  EMBEDDING_SIZE: 128,
  INPUT_SIZE: 1024,
  SCORE_THRESHOLD: 0.35,
  MAX_DIM: 1600,
  DEFAULT_SIMILARITY_THRESHOLD: 0.55,
  MAX_FACES_PER_SEARCH: 60,
  MAX_EMBEDDINGS_TO_SCAN: 20000
};

function isValidEmbedding(vec, expectedSize) {
  if (!Array.isArray(vec)) return false;
  if (vec.length !== (expectedSize || CONFIG.EMBEDDING_SIZE)) return false;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (typeof v !== "number") return false;
    if (!Number.isFinite(v)) return false;
  }
  return true;
}

function vectorNorm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (!Number.isFinite(v)) return 0;
    sum += v * v;
  }
  const n = Math.sqrt(sum);
  return Number.isFinite(n) ? n : 0;
}

function cosineSimilarity(a, b) {
  if (!isValidEmbedding(a) || !isValidEmbedding(b)) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  const sim = dot / denom;
  if (!Number.isFinite(sim)) return 0;
  if (sim > 1) return 1;
  if (sim < -1) return -1;
  return sim;
}

function cosineDistance(a, b) {
  return 1 - cosineSimilarity(a, b);
}

module.exports = {
  CONFIG,
  isValidEmbedding,
  vectorNorm,
  cosineSimilarity,
  cosineDistance
};
