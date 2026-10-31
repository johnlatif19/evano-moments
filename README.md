# Evano Moments

موقع خاص لألبوم صور المناسبة، مع بحث بالوجه للزوار. لوحة تحكم للمنظِّم لرفع الصور وإدارتها، وألبوم خاص برمز وصول.

---

## المكوّنات

- **الواجهة:** HTML / CSS / JavaScript خالص (بدون أطر عمل).
- **الخادم:** Node.js + Express (متوافق مع Vercel Serverless).
- **قاعدة البيانات:** Firebase Firestore (Firebase Admin SDK على الخادم فقط).
- **تخزين الصور:** Cloudinary (رفع موقّع + روابط تسليم).
- **التعرف على الوجه:** `@vladmandic/face-api` (يُشغَّل في متصفح الزائر — البصمة تُستخرج في المتصفح، والمقارنة في الخادم).
- **إدارة الجلسات:** cookies موقّعة (HMAC SHA-256) + CSRF مرتبط بالجلسة.
- **النشر:** Vercel.

---

## هيكل المشروع
public/
index.html
gallery.html
search-face.html
privacy.html
login.html
dashboard.html
css/
index.css
gallery.css
search-face.css
privacy.css
login.css
dashboard.css
js/
index.js
gallery.js
search-face.js
face-engine.js
login.js
dashboard.js
assets/
images/
evano.webp

lib/
firebase.js
auth.js
face.js

server.js
package.json
vercel.json
.env.example
.gitignore
README.md

text

---

## الملفات الجديدة في `lib/`

- **`lib/firebase.js`** — تهيئة Firebase Admin مرة واحدة. يُستخدم `getDb()` للحصول على نسخة Firestore.
- **`lib/auth.js`** — دوال التوقيع والتحقق من الجلسات، وإصدار والتحقق من CSRF. الدالة الرئيسية `createSigner(sessionSecret, csrfSecret)` ترجع `{ signSession, verifySession, issueCsrf, verifyCsrf }`.
- **`lib/face.js`** — إعدادات الموديل الموحدة (`CONFIG`) + دوال المقارنة الآمنة (`cosineSimilarity`, `cosineDistance`, `isValidEmbedding`).

---

## التشغيل المحلي

### 1. تثبيت الاعتماديات

```bash
npm install
