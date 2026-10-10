(function () {
  "use strict";

  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";
  const EMBEDDING_SIZE = 128;

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

  async function detectOnCanvas(canvas, options) {
    const inputSize = (options && options.inputSize) || 1024;
    const scoreThreshold = (options && options.scoreThreshold) || 0.35;

    const opts = new window.faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });

    let results = await window.faceapi
      .detectAllFaces(canvas, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    if (results.length === 0) {
      const retryOpts = new window.faceapi.TinyFaceDetectorOptions({
        inputSize: 1280,
        scoreThreshold: 0.25,
      });
      results = await window.faceapi
        .detectAllFaces(canvas, retryOpts)
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    }

    return results.map((r) => ({
      box: r.detection.box,
      score: r.detection.score,
      descriptor: Array.from(r.descriptor),
    }));
  }

  async function embed(imageData) {
    await ensureReady();

    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.putImageData(imageData, 0, 0);

    const results = await detectOnCanvas(canvas, { inputSize: 416, scoreThreshold: 0.4 });
    if (results.length === 0) throw new Error("no-face-detected");
    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    if (!best.descriptor || best.descriptor.length !== EMBEDDING_SIZE) {
      throw new Error("invalid-embedding");
    }
    return best.descriptor;
  }

  async function detect(imageOrCanvas, options) {
    await ensureReady();
    const canvas = imageOrCanvas instanceof HTMLCanvasElement
      ? imageOrCanvas
      : drawToCanvas(imageOrCanvas, (options && options.maxDim) || 1600);
    return detectOnCanvas(canvas, options);
  }

  async function embedFile(fileOrUrl, options) {
    await ensureReady();

    const maxDim = (options && options.maxDim) || 1600;
    const inputSize = (options && options.inputSize) || 1024;
    const scoreThreshold = (options && options.scoreThreshold) || 0.35;

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

  async function embedFileOne(fileOrUrl, options) {
    const results = await embedFile(fileOrUrl, options);
    if (results.length === 0) throw new Error("no-face-detected");
    return results[0].descriptor;
  }

  window.EvanoFace = {
    ready: ensureReady,
    embed,
    detect,
    embedFile,
    embedFileOne,
    embeddingSize: EMBEDDING_SIZE,
  };
})();
