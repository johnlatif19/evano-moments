# Evano Moments

موقع خاص لألبوم صور المناسبة، مع بحث بالوجه للزوار. لوحة تحكم للمنظِّم لرفع الصور وإدارتها، وألبوم خاص برمز وصول.

---

## المكوّنات

- **الواجهة:** HTML / CSS / JavaScript خالص (بدون أطر عمل).
- **الخادم:** Node.js + Express (متوافق مع Vercel Serverless).
- **قاعدة البيانات:** Firebase Firestore (Firebase Admin SDK على الخادم فقط).
- **تخزين الصور:** Cloudinary (رفع موقّع + روابط تسليم).
- **التعرف على الوجه:** `@vladmandic/face-api` (يُشغَّل في متصفح الزائر لتقليل التكلفة وحماية الخصوصية).
- **إدارة الجلسات:** cookies موقّعة (HMAC SHA-256) + CSRF مرتبط بالجلسة.
- **النشر:** Vercel.

---

## هيكل المشروع

```
public/
  index.html        الصفحة الرئيسية
  gallery.html      الألبوم (يطلب رمز الوصول)
  search-face.html  البحث بالوجه (نفس جلسة الألبوم)
  privacy.html      سياسة الخصوصية
  login.html        دخول المنظِّم
  dashboard.html    لوحة تحكم المنظِّم
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
  assets/images/evano.webp

server.js
package.json
vercel.json
.env.example
.gitignore
README.md
```

---

## التشغيل المحلي

### 1. تثبيت الاعتماديات

```bash
npm install
```

### 2. إنشاء مشروع Firebase

1. افتح [Firebase Console](https://console.firebase.google.com).
2. أنشئ مشروعاً جديداً.
3. من **Build → Firestore Database** أنشئ قاعدة بيانات في وضع **Production**.
4. من **Project Settings → Service Accounts** اختر **Node.js** واضغط **Generate new private key**.
5. احفظ ملف JSON الناتج — سنستخدم محتواه في `FIREBASE_SERVICE_ACCOUNT_JSON`.

### 3. إنشاء حساب Cloudinary

1. افتح [Cloudinary](https://cloudinary.com) وأنشئ حساباً.
2. من **Dashboard** انسخ:
   - `Cloud name`
   - `API Key`
   - `API Secret`

### 4. توليد الأسرار

```bash
# SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CSRF_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ADMIN_PASSWORD_HASH (استبدل الكلمة)
node -e "console.log(require('crypto').createHash('sha256').update('YOUR_ADMIN_PASSWORD').digest('hex'))"

# LOGIN_GALLERY_HASH (رمز الألبوم)
node -e "console.log(require('crypto').createHash('sha256').update('190926').digest('hex'))"
```

### 5. إنشاء ملف `.env`

انسخ `.env.example` إلى `.env` واملأ القيم:

```bash
cp .env.example .env
```

### 6. تشغيل الخادم

```bash
npm run dev
```

ثم افتح `http://localhost:3000`.

---

## النشر على Vercel

### 1. ارفع المشروع إلى Git

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <repo-url>
git push -u origin main
```

### 2. استورد المشروع في Vercel

1. افتح [vercel.com/new](https://vercel.com/new).
2. اختر المستودع.
3. Framework Preset: **Other**.
4. Root Directory: اتركه فارغاً.
5. Build Command: اتركه فارغاً.
6. Output Directory: اتركه فارغاً.

### 3. متغيرات البيئة في Vercel

من **Settings → Environment Variables** أضف:

- `NODE_ENV=production`
- `APP_BASE_URL=https://your-domain.vercel.app`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`
- `CSRF_SECRET`
- `LOGIN_GALLERY_HASH`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER`
- `SIMILARITY_THRESHOLD`
- `EMBEDDING_SIZE`
- `SESSION_TTL_HOURS`

### 4. انشر

اضغط **Deploy**.

---

## قواعد Firestore (Security Rules)

بما أن جميع عمليات القراءة والكتابة تتم عبر Firebase Admin SDK على الخادم، لا يحتاج العميل إلى أي وصول مباشر. اضبط القواعد كالتالي:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## المجموعات في Firestore

- `photos` — بيانات كل صورة.
- `faceEmbeddings` — تمثيلات الوجوه (128 بعداً لكل وجه).
- `processingJobs` — (اختياري) لتتبع عمليات طويلة.
- `eventSettings/main` — الإعدادات العامة ورمز الألبوم.
- `adminSessions` — جلسات المنظِّم.
- `gallerySessions` — جلسات زوار الألبوم (يُستخدم أيضاً لعدّاد الزوار).
- `guestSearchSessions` — جلسات البحث المؤقتة (تُحذف تلقائياً بعد انتهاء الصلاحية).

---

## فهرسة Firestore المطلوبة

أنشئ الفهارس التالية من **Firestore → Indexes**:

1. `photos`: `status` (Ascending) + `createdAt` (Descending).
2. `photos`: `status` (Ascending) + `updatedAt` (Descending).
3. `faceEmbeddings`: `photoId` (Ascending).
4. `gallerySessions`: `createdAt` (Descending).

---

## ملاحظات الأمان

- جميع الأسرار في متغيرات البيئة فقط.
- ملفات تعريف الارتباط `HttpOnly` و`Secure` في الإنتاج.
- حماية CSRF على كل عملية كتابة.
- حدود معدل على تسجيل الدخول، ورمز الألبوم، والبحث.
- لا يُخزَّن أي سيلفي على الخادم — فقط تمثيل رقمي للوجه.
- يُحذف تمثيل الوجه تلقائياً بعد انتهاء جلسة البحث.

---

## القيود المعروفة

- **البحث الخطي للوجوه:** يتم تحميل جميع التمثيلات ومقارنتها في الخادم عند كل بحث. مناسب حتى ~50,000 وجه. إذا تجاوزت ذلك، فعّل **Firestore Vector Search** أو استخدم خدمة فهرسة متخصصة.
- **حدود Vercel:** الحد الأقصى لحجم الطلب 4.5 ميغابايت، ومدة الدالة 10 ثوانٍ (Hobby). إذا تجاوزت الصور هذه الحدود، ارفعها مباشرة إلى Cloudinary عبر المتصفح (وهو ما يفعله النظام بالفعل) ومرّر بيانات التسجيل فقط إلى الخادم.
- **محرك face-api.js:** يُحمَّل من CDN (`@vladmandic/face-api`). أول تحميل يستغرق بضع ثوانٍ، ثم يُخزَّن مؤقتاً في المتصفح.

---

## التكلفة التقريبية

- **Vercel Hobby:** مجاني (100 GB نطاق ترددي، 100 ساعة تنفيذ دوال شهرياً).
- **Firebase Spark:** مجاني (50,000 قراءة، 20,000 كتابة يومياً). عند تجاوزها → Blaze (الدفع حسب الاستخدام).
- **Cloudinary Free:** 25 GB تخزين، 25 GB نطاق ترددي شهرياً.

بالنسبة لألبوم واحد بآلاف الصور، يبقى كل شيء عادةً داخل الطبقة المجانية.