"use strict";

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;
const { z } = require("zod");

const app = express();
const isProd = process.env.NODE_ENV === "production";

function required(name) {
  const v = process.env[name];
  if (!v || typeof v !== "string" || v.trim() === "") {
    throw new Error("متغير البيئة المطلوب غير موجود: " + name);
  }
  return v;
}

function optional(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return v;
}

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

function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

const ENV = {
  nodeEnv: optional("NODE_ENV", "development"),
  appBaseUrl: optional("APP_BASE_URL", "https://evano-moments.vercel.app"),
  adminUsername: required("ADMIN_USERNAME"),
  adminPasswordHash: required("ADMIN_PASSWORD_HASH"),
  sessionSecret: required("SESSION_SECRET"),
  csrfSecret: required("CSRF_SECRET"),
  galleryCodeHash: required("LOGIN_GALLERY_HASH"),
  firebaseServiceAccountJson: required("FIREBASE_SERVICE_ACCOUNT_JSON"),
  cloudinaryCloudName: required("CLOUDINARY_CLOUD_NAME"),
  cloudinaryApiKey: required("CLOUDINARY_API_KEY"),
  cloudinaryApiSecret: required("CLOUDINARY_API_SECRET"),
  cloudinaryFolder: optional("CLOUDINARY_FOLDER", "evano-moments"),
  similarityThreshold: Number(optional("SIMILARITY_THRESHOLD", "0.55")),
  embeddingSize: Number(optional("EMBEDDING_SIZE", "128")),
  sessionTtlHours: Number(optional("SESSION_TTL_HOURS", "24")),
};

let serviceAccount;
try {
  serviceAccount = JSON.parse(ENV.firebaseServiceAccountJson);
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON ليس JSON صالحاً.");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

cloudinary.config({
  cloud_name: ENV.cloudinaryCloudName,
  api_key: ENV.cloudinaryApiKey,
  api_secret: ENV.cloudinaryApiSecret,
  secure: true,
});

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://cdn.jsdelivr.net"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
      "connect-src": ["'self'", "https://api.cloudinary.com"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

app.use(cors({
  origin: ENV.appBaseUrl,
  credentials: true,
}));

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(cookieParser());

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, {
  index: false,
  maxAge: isProd ? "1h" : 0,
  setHeaders: (res, p) => {
    if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "محاولات كثيرة. حاول لاحقاً." },
});

const galleryAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "محاولات كثيرة. حاول لاحقاً." },
});

const guestSearchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "عدد كبير من عمليات البحث. حاول لاحقاً." },
});

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", ENV.sessionSecret).update(body).digest("base64url");
  return body + "." + sig;
}

function verifySession(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", ENV.sessionSecret).update(body).digest("base64url");
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
  const sig = crypto.createHmac("sha256", ENV.csrfSecret).update(sessionId + ":" + raw).digest("hex");
  return raw + "." + sig;
}

function verifyCsrf(sessionId, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [raw, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", ENV.csrfSecret).update(sessionId + ":" + raw).digest("hex");
  return timingSafeEqualHex(sig, expected);
}

const COOKIE_BASE = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/",
};

function setAdminSession(res, sessionId, csrf) {
  const exp = Date.now() + ENV.sessionTtlHours * 60 * 60 * 1000;
  const token = signSession({ sid: sessionId, role: "admin", exp });
  res.cookie("admin_session", token, { ...COOKIE_BASE, maxAge: ENV.sessionTtlHours * 60 * 60 * 1000 });
  res.cookie("admin_csrf", csrf, {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: ENV.sessionTtlHours * 60 * 60 * 1000,
  });
}

function clearAdminSession(res) {
  res.clearCookie("admin_session", { ...COOKIE_BASE });
  res.clearCookie("admin_csrf", { ...COOKIE_BASE, httpOnly: false });
}

function setGallerySession(res, sessionId) {
  const exp = Date.now() + ENV.sessionTtlHours * 60 * 60 * 1000;
  const token = signSession({ sid: sessionId, role: "gallery", exp });
  res.cookie("gallery_session", token, { ...COOKIE_BASE, maxAge: ENV.sessionTtlHours * 60 * 60 * 1000 });
  res.cookie("gallery_csrf", issueCsrf(sessionId), {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: ENV.sessionTtlHours * 60 * 60 * 1000,
  });
}

function clearGallerySession(res) {
  res.clearCookie("gallery_session", { ...COOKIE_BASE });
  res.clearCookie("gallery_csrf", { ...COOKIE_BASE, httpOnly: false });
}

async function requireAdmin(req, res, next) {
  const token = req.cookies.admin_session;
  const payload = verifySession(token);
  if (!payload || payload.role !== "admin" || !payload.sid) {
    return res.status(401).json({ ok: false, message: "غير مصرح." });
  }
  const doc = await db.collection("adminSessions").doc(payload.sid).get();
  if (!doc.exists) return res.status(401).json({ ok: false, message: "جلسة منتهية." });
  const data = doc.data();
  if (data.expiresAt && data.expiresAt < Date.now()) {
    await doc.ref.delete().catch(() => {});
    return res.status(401).json({ ok: false, message: "جلسة منتهية." });
  }
  req.adminSession = { id: payload.sid, ...data };
  next();
}

async function requireGallery(req, res, next) {
  const token = req.cookies.gallery_session;
  const payload = verifySession(token);
  if (!payload || payload.role !== "gallery" || !payload.sid) {
    return res.status(401).json({ ok: false, reason: "unauthorized", message: "مطلوب رمز الألبوم." });
  }
  const doc = await db.collection("gallerySessions").doc(payload.sid).get();
  if (!doc.exists) return res.status(401).json({ ok: false, reason: "unauthorized", message: "جلسة منتهية." });
  const data = doc.data();
  if (data.expiresAt && data.expiresAt < Date.now()) {
    await doc.ref.delete().catch(() => {});
    return res.status(401).json({ ok: false, reason: "unauthorized", message: "جلسة منتهية." });
  }
  req.gallerySession = { id: payload.sid, ...data };
  doc.ref.update({ lastSeenAt: Date.now() }).catch(() => {});
  next();
}

function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token") || (req.body && req.body._csrf);
  const sessionId = (req.adminSession && req.adminSession.id) || (req.gallerySession && req.gallerySession.id);
  if (!sessionId || !verifyCsrf(sessionId, token)) {
    return res.status(403).json({ ok: false, message: "رمز CSRF غير صالح." });
  }
  next();
}

function handle(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function getSettings() {
  const doc = await db.collection("eventSettings").doc("main").get();
  const data = doc.exists ? doc.data() : {};
  return {
    similarityThreshold: typeof data.similarityThreshold === "number" ? data.similarityThreshold : ENV.similarityThreshold,
    selfieRetentionMinutes: typeof data.selfieRetentionMinutes === "number" ? data.selfieRetentionMinutes : 60,
    searchRateLimit: typeof data.searchRateLimit === "number" ? data.searchRateLimit : 20,
    albumCodeHash: typeof data.albumCodeHash === "string" ? data.albumCodeHash : ENV.galleryCodeHash,
    modelVersion: typeof data.modelVersion === "string" ? data.modelVersion : "face-api@1.7-tiny",
  };
}

async function saveSettings(patch) {
  await db.collection("eventSettings").doc("main").set(patch, { merge: true });
}

const adminLoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

app.post("/api/admin/login", loginLimiter, handle(async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "بيانات غير صالحة." });

  const { username, password } = parsed.data;
  const usernameOk = crypto.timingSafeEqual(
    Buffer.from(sha256Hex(username), "hex"),
    Buffer.from(sha256Hex(ENV.adminUsername), "hex")
  );
  const passwordHash = sha256Hex(password);
  const passwordOk = timingSafeEqualHex(passwordHash, ENV.adminPasswordHash);

  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ ok: false, message: "بيانات الدخول غير صحيحة." });
  }

  const sessionId = newToken(24);
  const csrf = issueCsrf(sessionId);
  await db.collection("adminSessions").doc(sessionId).set({
    role: "admin",
    username: ENV.adminUsername,
    createdAt: Date.now(),
    expiresAt: Date.now() + ENV.sessionTtlHours * 60 * 60 * 1000,
    ip: req.ip,
  });

  setAdminSession(res, sessionId, csrf);
  res.json({ ok: true, admin: { username: ENV.adminUsername }, csrf });
}));

app.post("/api/admin/logout", requireAdmin, handle(async (req, res) => {
  await db.collection("adminSessions").doc(req.adminSession.id).delete().catch(() => {});
  clearAdminSession(res);
  res.json({ ok: true });
}));

app.get("/api/admin/session", handle(async (req, res) => {
  const token = req.cookies.admin_session;
  const payload = verifySession(token);
  if (!payload || payload.role !== "admin" || !payload.sid) {
    return res.json({ ok: true, authenticated: false });
  }
  const doc = await db.collection("adminSessions").doc(payload.sid).get();
  if (!doc.exists || (doc.data().expiresAt && doc.data().expiresAt < Date.now())) {
    clearAdminSession(res);
    return res.json({ ok: true, authenticated: false });
  }
  res.json({
    ok: true,
    authenticated: true,
    admin: { username: doc.data().username || ENV.adminUsername },
    csrf: req.cookies.admin_csrf || null,
  });
}));

const galleryAccessSchema = z.object({
  code: z.string().min(4).max(64),
});

app.post("/api/gallery/access", galleryAccessLimiter, handle(async (req, res) => {
  const parsed = galleryAccessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "رمز غير صالح." });

  const settings = await getSettings();
  const inputHash = sha256Hex(parsed.data.code);
  const ok = timingSafeEqualHex(inputHash, settings.albumCodeHash);

  if (!ok) {
    return res.status(401).json({ ok: false, message: "الرمز غير صحيح." });
  }

  const sessionId = newToken(24);
  const now = Date.now();
  await db.collection("gallerySessions").doc(sessionId).set({
    role: "gallery",
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ENV.sessionTtlHours * 60 * 60 * 1000,
    ip: req.ip,
    userAgent: String(req.get("user-agent") || "").slice(0, 200),
  });

  setGallerySession(res, sessionId);
  res.json({ ok: true });
}));

app.post("/api/gallery/logout", handle(async (req, res) => {
  const payload = verifySession(req.cookies.gallery_session);
  if (payload && payload.sid) {
    await db.collection("gallerySessions").doc(payload.sid).delete().catch(() => {});
  }
  clearGallerySession(res);
  res.json({ ok: true });
}));

app.get("/api/gallery/session", handle(async (req, res) => {
  const token = req.cookies.gallery_session;
  const payload = verifySession(token);
  if (!payload || payload.role !== "gallery" || !payload.sid) {
    return res.json({ ok: true, authed: false });
  }
  const doc = await db.collection("gallerySessions").doc(payload.sid).get();
  if (!doc.exists || (doc.data().expiresAt && doc.data().expiresAt < Date.now())) {
    clearGallerySession(res);
    return res.json({ ok: true, authed: false });
  }
  res.json({ ok: true, authed: true });
}));

app.get("/api/gallery/photos", requireGallery, handle(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const cursor = req.query.cursor ? String(req.query.cursor) : null;

  let query = db.collection("photos")
    .where("status", "==", "indexed")
    .orderBy("createdAt", "desc")
    .limit(limit + 1);

  if (cursor) {
    const curDoc = await db.collection("photos").doc(cursor).get();
    if (curDoc.exists) query = query.startAfter(curDoc);
  }

  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;
  const nextCursor = hasMore && docs.length ? docs[docs.length - 1].id : null;

  const items = docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      thumbnailUrl: data.thumbnailUrl || data.secureUrl,
      url: data.secureUrl,
      downloadUrl: data.downloadUrl || data.secureUrl,
      alt: data.originalFilename || "",
      filename: data.originalFilename || (d.id + ".jpg"),
      width: data.width,
      height: data.height,
      bytes: data.bytes,
    };
  });

  const totalSnap = await db.collection("photos").where("status", "==", "indexed").count().get();
  const total = totalSnap.data().count;

  res.json({ ok: true, items, nextCursor, total });
}));

const searchSchema = z.object({
  embedding: z.array(z.number()).min(32).max(2048),
  sessionId: z.string().max(128).optional().nullable(),
});

app.post("/api/guest/search", guestSearchLimiter, requireGallery, requireCsrf, handle(async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "بيانات البحث غير صالحة." });

  const settings = await getSettings();
  const threshold = settings.similarityThreshold;
  const embedding = parsed.data.embedding;

  if (embedding.length !== ENV.embeddingSize) {
    return res.status(400).json({ ok: false, message: "أبعاد التمثيل غير صحيحة." });
  }

  const all = await db.collection("faceEmbeddings").limit(10000).get();

  const scored = [];
  all.forEach((doc) => {
    const d = doc.data() || {};
    const vec = Array.isArray(d.vector) ? d.vector : null;
    if (!vec || vec.length !== embedding.length) return;
    const dist = cosineDistance(embedding, vec);
    const sim = 1 - dist;
    if (sim >= threshold) {
      scored.push({ photoId: d.photoId, score: sim });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  const top = [];
  const seen = new Set();
  for (const s of scored) {
    if (!s.photoId || seen.has(s.photoId)) continue;
    seen.add(s.photoId);
    top.push(s);
    if (top.length >= 60) break;
  }

  if (top.length === 0) {
    return res.json({ ok: true, results: [], sessionId: parsed.data.sessionId || null });
  }

  const ids = top.map((s) => s.photoId);
  const photoDocs = await Promise.all(ids.map((id) => db.collection("photos").doc(id).get()));

  const results = [];
  photoDocs.forEach((doc, i) => {
    if (!doc.exists) return;
    const data = doc.data() || {};
    if (data.status !== "indexed") return;
    results.push({
      id: doc.id,
      thumbnailUrl: data.thumbnailUrl || data.secureUrl,
      url: data.secureUrl,
      downloadUrl: data.downloadUrl || data.secureUrl,
      filename: data.originalFilename || (doc.id + ".jpg"),
      alt: data.originalFilename || "",
      score: Number(top[i].score.toFixed(4)),
    });
  });

  const sessionId = parsed.data.sessionId || newToken(16);
  const expiresAt = Date.now() + settings.selfieRetentionMinutes * 60 * 1000;
  await db.collection("guestSearchSessions").doc(sessionId).set({
    createdAt: Date.now(),
    expiresAt,
    embedding,
    matches: results.length,
  }, { merge: true });

  res.json({ ok: true, results, sessionId });
}));

const deleteSessionSchema = z.object({
  sessionId: z.string().max(128).optional().nullable(),
});

app.post("/api/guest/search-session/delete", requireGallery, requireCsrf, handle(async (req, res) => {
  const parsed = deleteSessionSchema.safeParse(req.body);
  const sid = parsed.success && parsed.data.sessionId ? parsed.data.sessionId : null;
  if (sid) {
    await db.collection("guestSearchSessions").doc(sid).delete().catch(() => {});
  }
  res.json({ ok: true });
}));

function cosineDistance(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return 1 - (dot / denom);
}

app.get("/api/admin/stats", requireAdmin, handle(async (req, res) => {
  const photosCol = db.collection("photos");

  const [total, indexed, pending, failed, faces, visitors] = await Promise.all([
    photosCol.count().get(),
    photosCol.where("status", "==", "indexed").count().get(),
    photosCol.where("status", "==", "pending").count().get(),
    photosCol.where("status", "==", "failed").count().get(),
    db.collection("faceEmbeddings").count().get(),
    db.collection("gallerySessions").count().get(),
  ]);

  const recentSnap = await photosCol.orderBy("createdAt", "desc").limit(6).get();
  const recentActivity = recentSnap.docs.map((d) => {
    const data = d.data() || {};
    return {
      label: (data.originalFilename || d.id) + " — " + (data.status || "pending"),
      at: data.createdAt || Date.now(),
    };
  });

  res.json({
    ok: true,
    stats: {
      totalPhotos: total.data().count,
      indexedPhotos: indexed.data().count,
      pendingPhotos: pending.data().count,
      failedPhotos: failed.data().count,
      totalFaces: faces.data().count,
      galleryVisitors: visitors.data().count,
      recentActivity,
    },
  });
}));

app.get("/api/admin/visitors", requireAdmin, handle(async (req, res) => {
  const snap = await db.collection("gallerySessions").orderBy("createdAt", "desc").limit(200).get();
  const now = Date.now();
  const sessions = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      createdAt: data.createdAt || null,
      lastSeenAt: data.lastSeenAt || null,
      expiresAt: data.expiresAt || null,
      ip: data.ip || "",
      active: !!(data.expiresAt && data.expiresAt > now),
    };
  });

  const total = sessions.length;
  const active = sessions.filter((s) => s.active).length;
  const last24h = sessions.filter((s) => s.createdAt && now - s.createdAt < 86400000).length;

  res.json({ ok: true, visitors: { total, active, last24h, sessions } });
}));

const uploadSignatureSchema = z.object({
  filename: z.string().min(1).max(255),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  type: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

app.post("/api/admin/photos/upload-signature", requireAdmin, requireCsrf, handle(async (req, res) => {
  const parsed = uploadSignatureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "ملف غير صالح." });

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = "photo_" + timestamp + "_" + newToken(6);
  const folder = ENV.cloudinaryFolder + "/photos";

  const paramsToSign = {
    folder,
    public_id: publicId,
    timestamp,
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, ENV.cloudinaryApiSecret);

  res.json({
    ok: true,
    signature: {
      cloudName: ENV.cloudinaryCloudName,
      apiKey: ENV.cloudinaryApiKey,
      timestamp,
      signature,
      folder,
      publicId,
    },
  });
}));

const registerSchema = z.object({
  publicId: z.string().min(1).max(300),
  secureUrl: z.string().url().max(1000),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  bytes: z.number().int().positive().max(50 * 1024 * 1024),
  format: z.string().min(1).max(10),
  originalFilename: z.string().max(255).optional().default(""),
  faces: z.array(z.array(z.number()).min(32).max(2048)).optional().default([]),
});

app.post("/api/admin/photos/register", requireAdmin, requireCsrf, handle(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "بيانات الصورة غير صالحة." });

  const data = parsed.data;
  const now = Date.now();
  const photoRef = db.collection("photos").doc();

  const thumbUrl = cloudinary.url(data.publicId, {
    secure: true,
    transformation: [{ width: 500, height: 500, crop: "fill", quality: "auto", fetch_format: "auto" }],
  });

  const dlUrl = cloudinary.url(data.publicId, {
    secure: true,
    flags: "attachment",
  });

  const validFaces = data.faces.filter((v) => Array.isArray(v) && v.length === ENV.embeddingSize);
  const status = validFaces.length > 0 ? "indexed" : "pending";

  await photoRef.set({
    publicId: data.publicId,
    secureUrl: data.secureUrl,
    thumbnailUrl: thumbUrl,
    downloadUrl: dlUrl,
    width: data.width,
    height: data.height,
    bytes: data.bytes,
    format: data.format,
    originalFilename: data.originalFilename,
    status,
    faceCount: validFaces.length,
    createdAt: now,
    updatedAt: now,
    modelVersion: (await getSettings()).modelVersion,
    checksum: sha256Hex(data.publicId + ":" + data.bytes),
  });

  if (validFaces.length > 0) {
    const batch = db.batch();
    validFaces.forEach((vec, i) => {
      const ref = db.collection("faceEmbeddings").doc();
      batch.set(ref, {
        photoId: photoRef.id,
        vector: vec,
        index: i,
        createdAt: now,
      });
    });
    await batch.commit();
  }

  res.json({ ok: true, photoId: photoRef.id, status });
}));

app.get("/api/admin/photos", requireAdmin, handle(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);
  const cursor = req.query.cursor ? String(req.query.cursor) : null;
  const status = req.query.status ? String(req.query.status) : "";
  const q = req.query.q ? String(req.query.q).trim() : "";

  let query = db.collection("photos").orderBy("createdAt", "desc").limit(limit + 1);
  if (status) query = query.where("status", "==", status);
  if (cursor) {
    const curDoc = await db.collection("photos").doc(cursor).get();
    if (curDoc.exists) query = query.startAfter(curDoc);
  }

  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;
  const nextCursor = hasMore && docs.length ? docs[docs.length - 1].id : null;

  let items = docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      thumbnailUrl: data.thumbnailUrl || data.secureUrl,
      url: data.secureUrl,
      originalFilename: data.originalFilename || "",
      bytes: data.bytes || 0,
      width: data.width || 0,
      height: data.height || 0,
      status: data.status || "pending",
      faceCount: data.faceCount || 0,
      createdAt: data.createdAt || null,
    };
  });

  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((it) => (it.originalFilename || "").toLowerCase().includes(needle));
  }

  res.json({ ok: true, items, nextCursor });
}));

app.get("/api/admin/photos/:id", requireAdmin, handle(async (req, res) => {
  const doc = await db.collection("photos").doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ ok: false, message: "غير موجود." });
  res.json({ ok: true, photo: { id: doc.id, ...doc.data() } });
}));

app.delete("/api/admin/photos/:id", requireAdmin, requireCsrf, handle(async (req, res) => {
  const id = req.params.id;
  const doc = await db.collection("photos").doc(id).get();
  if (!doc.exists) return res.status(404).json({ ok: false, message: "غير موجود." });

  const data = doc.data() || {};
  if (data.publicId) {
    await cloudinary.uploader.destroy(data.publicId).catch(() => {});
  }

  const embSnap = await db.collection("faceEmbeddings").where("photoId", "==", id).get();
  const batch = db.batch();
  embSnap.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection("photos").doc(id));
  await batch.commit();

  res.json({ ok: true });
}));

app.post("/api/admin/photos/:id/reindex", requireAdmin, requireCsrf, handle(async (req, res) => {
  const id = req.params.id;
  const doc = await db.collection("photos").doc(id).get();
  if (!doc.exists) return res.status(404).json({ ok: false, message: "غير موجود." });
  await doc.ref.update({ status: "pending", updatedAt: Date.now() });
  res.json({ ok: true });
}));

app.get("/api/admin/jobs", requireAdmin, handle(async (req, res) => {
  const snap = await db.collection("photos").where("status", "==", "failed").orderBy("updatedAt", "desc").limit(100).get();
  const jobs = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      photoId: d.id,
      filename: data.originalFilename || "",
      error: data.lastError || "",
      updatedAt: data.updatedAt || null,
    };
  });
  res.json({ ok: true, jobs });
}));

app.post("/api/admin/jobs/:id/retry", requireAdmin, requireCsrf, handle(async (req, res) => {
  const id = req.params.id;
  const doc = await db.collection("photos").doc(id).get();
  if (!doc.exists) return res.status(404).json({ ok: false, message: "غير موجود." });
  await doc.ref.update({ status: "pending", lastError: null, updatedAt: Date.now() });
  res.json({ ok: true });
}));

app.get("/api/admin/settings", requireAdmin, handle(async (req, res) => {
  const s = await getSettings();
  res.json({
    ok: true,
    settings: {
      similarityThreshold: s.similarityThreshold,
      selfieRetentionMinutes: s.selfieRetentionMinutes,
      searchRateLimit: s.searchRateLimit,
      modelVersion: s.modelVersion,
    },
  });
}));

const settingsSchema = z.object({
  similarityThreshold: z.number().min(0.30).max(0.80),
  selfieRetentionMinutes: z.number().int().min(5).max(1440),
  searchRateLimit: z.number().int().min(1).max(100),
});

app.patch("/api/admin/settings", requireAdmin, requireCsrf, handle(async (req, res) => {
  const parsed = settingsSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "إعدادات غير صالحة." });
  await saveSettings(parsed.data);
  res.json({ ok: true });
}));

const albumCodeSchema = z.object({
  newCode: z.string().min(4).max(64),
});

app.post("/api/admin/settings/album-code", requireAdmin, requireCsrf, handle(async (req, res) => {
  const parsed = albumCodeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, message: "رمز غير صالح." });
  await saveSettings({ albumCodeHash: sha256Hex(parsed.data.newCode) });
  res.json({ ok: true });
}));

app.get("/login", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "login.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "dashboard.html")));
app.get("/gallery", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "gallery.html")));
app.get("/search-face", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "search-face.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "privacy.html")));

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, message: "غير موجود." });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("[error]", err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, message: "حدث خطأ داخلي." });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log("Evano Moments server running on port " + PORT);
  });
}

module.exports = app;