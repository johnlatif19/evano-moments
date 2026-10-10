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

  async function detect(imageOrCanvas, options) {
    await ensureReady();
    const opts = new window.faceapi.TinyFaceDetectorOptions({
      inputSize: (options && options.inputSize) || 416,
      scoreThreshold: (options && options.scoreThreshold) || 0.5,
    });
    const results = await window.faceapi
      .detectAllFaces(imageOrCanvas, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptors();
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
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);

    const results = await detect(canvas, { inputSize: 320, scoreThreshold: 0.5 });
    if (results.length === 0) {
      throw new Error("no-face-detected");
    }
    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    if (!best.descriptor || best.descriptor.length !== EMBEDDING_SIZE) {
      throw new Error("invalid-embedding");
    }
    return best.descriptor;
  }

  async function embedFile(file, options) {
    await ensureReady();
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("invalid-image"));
        i.src = url;
      });
      const maxDim = (options && options.maxDim) || 1024;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (Math.max(w, h) > maxDim) {
        const ratio = maxDim / Math.max(w, h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const results = await detect(canvas, {
        inputSize: (options && options.inputSize) || 608,
        scoreThreshold: (options && options.scoreThreshold) || 0.5,
      });
      return results;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.EvanoFace = {
    ready: ensureReady,
    embed,
    detect,
    embedFile,
    embeddingSize: EMBEDDING_SIZE,
  };
})();
