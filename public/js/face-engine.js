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

  async function embed(imageData) {
    await ensureReady();

    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);

    const options = new window.faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: 0.5,
    });

    const result = await window.faceapi
      .detectSingleFace(canvas, options)
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!result) {
      throw new Error("no-face-detected");
    }

    const desc = result.descriptor;
    if (!desc || desc.length !== EMBEDDING_SIZE) {
      throw new Error("invalid-embedding");
    }

    return Array.from(desc);
  }

  window.EvanoFace = {
    ready: ensureReady,
    embed,
    embeddingSize: EMBEDDING_SIZE,
  };
})();