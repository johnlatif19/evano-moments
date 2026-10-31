"use strict";

const CONFIG = {
  MODEL_VERSION: "face-api@1.7-tiny",
  EMBEDDING_SIZE: 128,
  INPUT_SIZE: 1024,
  SCORE_THRESHOLD: 0.35,
  MAX_DIM: 1600,
  DEFAULT_DISTANCE_THRESHOLD: 0.55,
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

function euclideanDistance(a, b) {
  if (!isValidEmbedding(a) || !isValidEmbedding(b)) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    if (!Number.isFinite(diff)) return Infinity;
    sum += diff * diff;
  }
  const dist = Math.sqrt(sum);
  return Number.isFinite(dist) ? dist : Infinity;
}

function similarityFromDistance(distance) {
  if (!Number.isFinite(distance)) return 0;
  const sim = 1 - (distance / 2);
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
}

module.exports = {
  CONFIG,
  isValidEmbedding,
  vectorNorm,
  euclideanDistance,
  similarityFromDistance
};
