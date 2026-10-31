"use strict";

const crypto = require("crypto");

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function timingSafeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function newToken(bytes) {
  return crypto.randomBytes(bytes || 32).toString("hex");
}

function createSigner(sessionSecret, csrfSecret) {
  function signSession(payload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
    return body + "." + sig;
  }

  function verifySession(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const body = parts[0];
    const sig = parts[1];
    const expected = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!payload || typeof payload !== "object") return null;
      if (payload.exp && Date.now() > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function issueCsrf(sessionId) {
    const raw = newToken(18);
    const sig = crypto.createHmac("sha256", csrfSecret).update(sessionId + ":" + raw).digest("hex");
    return raw + "." + sig;
  }

  function verifyCsrf(sessionId, token) {
    if (!token || typeof token !== "string" || !token.includes(".")) return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const raw = parts[0];
    const sig = parts[1];
    const expected = crypto.createHmac("sha256", csrfSecret).update(sessionId + ":" + raw).digest("hex");
    return timingSafeEqualHex(sig, expected);
  }

  return { signSession, verifySession, issueCsrf, verifyCsrf };
}

module.exports = {
  sha256Hex,
  timingSafeEqualHex,
  newToken,
  createSigner
};
