(function () {
  "use strict";

  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";
  const EMBEDDING_SIZE = 128;
  const DEFAULT_OPTIONS = {
    maxDim: 1600,
    inputSize: 1024,
    scoreThreshold: 0.35
  };

  let readyPromise = null;

  function ensureReady() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (!window.faceapi) {
        throw new Error("face-api-not-loaded");
      }
      await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
      await window.faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    })();
    return readyPromise;
  }

  function loadImage(fileOrUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("invalid-image"));
      if (typeof fileOrUrl === "string") {
        img.src = fileOrUrl;
      } else {
        img.src = URL.createObjectURL(fileOrUrl);
      }
    });
  }

  function drawToCanvas(img, maxDim) {
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (Math.max(w, h) > maxDim) {
      const ratio = maxDim / Math.max(w, h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  function isValidDescriptor(desc) {
    if (!Array.isArray(desc)) return false;
    if (desc.length !== EMBEDDING_SIZE) return false;
    for (let i = 0; i < desc.length; i++) {
      if (typeof desc[i] !== "number") return false;
      if (!Number.isFinite(desc[i])) return false;
    }
    return true;
  }

  async function detectOnCanvas(canvas, options) {
    const inputSize = (options && options.inputSize) || DEFAULT_OPTIONS.inputSize;
    const scoreThreshold = (options && options.scoreThreshold) || DEFAULT_OPTIONS.scoreThreshold;

    const opts = new window.faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });

    let results = await window.faceapi
      .detectAllFaces(canvas, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    if (results.length === 0) {
      const retryOpts = new window.faceapi.TinyFaceDetectorOptions({
        inputSize: 1280,
        scoreThreshold: 0.25
      });
      results = await window.faceapi
        .detectAllFaces(canvas, retryOpts)
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    }

    return results
      .map((r) => ({
        box: r.detection.box,
        score: r.detection.score,
        descriptor: Array.from(r.descriptor)
      }))
      .filter((r) => isValidDescriptor(r.descriptor));
  }

  async function detect(imageOrCanvas, options) {
    await ensureReady();
    const canvas = imageOrCanvas instanceof HTMLCanvasElement
      ? imageOrCanvas
      : drawToCanvas(imageOrCanvas, (options && options.maxDim) || DEFAULT_OPTIONS.maxDim);
    return detectOnCanvas(canvas, options);
  }

  async function embedFile(fileOrUrl, options) {
    await ensureReady();

    const maxDim = (options && options.maxDim) || DEFAULT_OPTIONS.maxDim;
    const inputSize = (options && options.inputSize) || DEFAULT_OPTIONS.inputSize;
    const scoreThreshold = (options && options.scoreThreshold) || DEFAULT_OPTIONS.scoreThreshold;

    let createdUrl = null;
    try {
      let img;
      if (typeof fileOrUrl === "string") {
        img = await loadImage(fileOrUrl);
      } else {
        createdUrl = URL.createObjectURL(fileOrUrl);
        img = await loadImage(createdUrl);
      }

      const canvas = drawToCanvas(img, maxDim);
      const results = await detectOnCanvas(canvas, { inputSize, scoreThreshold });
      results.sort((a, b) => b.score - a.score);
      return results;
    } finally {
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    }
  }

  async function computeOneDescriptor(fileOrUrl, options) {
    const results = await embedFile(fileOrUrl, options);
    if (results.length === 0) {
      throw new Error("no-face-detected");
    }
    const best = results[0];
    if (!isValidDescriptor(best.descriptor)) {
      throw new Error("invalid-embedding");
    }
    return best.descriptor;
  }

  window.EvanoFace = {
    ready: ensureReady,
    detect,
    embedFile,
    computeOneDescriptor,
    isValidDescriptor,
    embeddingSize: EMBEDDING_SIZE,
    defaults: DEFAULT_OPTIONS
  };
})();
