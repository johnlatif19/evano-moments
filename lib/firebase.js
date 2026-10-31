"use strict";

const admin = require("firebase-admin");

function initFirebase() {
  if (admin.apps.length) return admin;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON غير موجود.");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON ليس JSON صالحاً.");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  return admin;
}

function getDb() {
  initFirebase();
  return admin.firestore();
}

module.exports = {
  initFirebase,
  getDb,
  admin
};
