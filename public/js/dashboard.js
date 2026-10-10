(function () {
  "use strict";

  const API = {
    session: "/api/admin/session",
    logout: "/api/admin/logout",
    stats: "/api/admin/stats",
    jobs: "/api/admin/jobs",
    settings: "/api/admin/settings",
    photos: "/api/admin/photos",
    uploadSignature: "/api/admin/photos/upload-signature",
    register: "/api/admin/photos/register",
    reindex: (id) => "/api/admin/photos/" + encodeURIComponent(id) + "/reindex",
    remove: (id) => "/api/admin/photos/" + encodeURIComponent(id),
    visitors: "/api/admin/visitors",
    changeCode: "/api/admin/settings/album-code",
  };

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 25 * 1024 * 1024;
  const LIB_PAGE_SIZE = 40;
  const CONCURRENCY = 1;

  const state = {
    admin: null,
    csrfToken: null,
    uploadQueue: [],
    uploading: false,
    libCursor: null,
    libDone: false,
    libLoading: false,
    libFilter: "",
    libQuery: "",
    faceReady: false,
    reindexing: false,
  };

  const el = (id) => document.getElementById(id);
  const refs = {
    app: el("app"),
    adminName: el("adminName"),
    btnLogout: el("btn-logout"),
    menuToggle: el("menuToggle"),
    sidebar: el("sidebar"),
    viewTitle: el("viewTitle"),
    navItems: document.querySelectorAll(".nav-item"),
    views: document.querySelectorAll(".view"),
    statTotal: el("statTotal"),
    statIndexed: el("statIndexed"),
    statPending: el("statPending"),
    statFailed: el("statFailed"),
    statFaces: el("statFaces"),
    statVisitors: el("statVisitors"),
    activityList: el("activityList"),
    dropzone: el("dropzone"),
    filePicker: el("filePicker"),
    btnPick: el("btn-pick"),
    uploadControls: el("uploadControls"),
    uploadSummary: el("uploadSummary"),
    uploadList: el("uploadList"),
    btnUploadStart: el("btn-upload-start"),
    btnUploadClear: el("btn-upload-clear"),
    btnReindexAll: el("btn-reindex-all"),
    filterStatus: el("filterStatus"),
    searchBox: el("searchBox"),
    libGrid: el("libGrid"),
    libEmpty: el("libEmpty"),
    btnLibMore: el("btn-lib-more"),
    jobsList: el("jobsList"),
    visTotal: el("visTotal"),
    visActive: el("visActive"),
    visLast24: el("visLast24"),
    visitorsBody: el("visitorsBody"),
    btnVisitorsRefresh: el("btn-visitors-refresh"),
    formSettings: el("form-settings"),
    setThreshold: el("setThreshold"),
    setSelfieTtl: el("setSelfieTtl"),
    setRateLimit: el("setRateLimit"),
    settingsMsg: el("settingsMsg"),
    btnSaveSettings: el("btn-save-settings"),
    formCode: el("form-code"),
    newCode: el("newCode"),
    confirmCode: el("confirmCode"),
    codeMsg: el("codeMsg"),
    btnSaveCode: el("btn-save-code"),
    toast: el("toast"),
  };

  function showToast(message, kind) {
    if (!refs.toast) return;
    refs.toast.textContent = message;
    refs.toast.className = "toast" + (kind ? " toast-" + kind : "");
    refs.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { refs.toast.hidden = true; }, 4200);
  }

  function setBusy(button, busy, labelBusy) {
    if (!button) return;
    const label = button.querySelector(".btn-label");
    const spinner = button.querySelector(".spinner");
    if (busy) {
      button.disabled = true;
      if (label && labelBusy) {
        if (!label.dataset.original) label.dataset.original = label.textContent;
        label.textContent = labelBusy;
      }
      if (spinner) spinner.hidden = false;
    } else {
      button.disabled = false;
      if (label && label.dataset.original) label.textContent = label.dataset.original;
      if (spinner) spinner.hidden = true;
    }
  }

  async function safeJson(res) {
    try { const d = await res.json(); return d && typeof d === "object" ? d : {}; }
    catch { return {}; }
  }

  function csrfHeaders(extra) {
    const h = { "Content-Type": "application/json" };
    if (state.csrfToken) h["x-csrf-token"] = state.csrfToken;
    return Object.assign(h, extra || {});
  }

  function fmt(n) {
    if (n === null || n === undefined) return "—";
    return Number(n).toLocaleString("ar-EG");
  }

  function fmtBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    const u = ["B","KB","MB","GB","TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + u[i];
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
    } catch { return "—"; }
  }

  function shortId(id) {
    if (!id || typeof id !== "string") return "—";
    return id.slice(0, 8);
  }

  function shortIp(ip) {
    if (!ip || typeof ip !== "string") return "—";
    const parts = ip.split(".");
    if (parts.length === 4) return parts[0] + "." + parts[1] + ".x.x";
    return ip.slice(0, 12) + "…";
  }

  async function ensureFaceEngine() {
    if (state.faceReady) return true;
    if (!window.EvanoFace) {
      showToast("تعذّر تحميل محرك التعرف على الوجه.", "error");
      return false;
    }
    try {
      await window.EvanoFace.ready();
      state.faceReady = true;
      return true;
    } catch {
      showToast("تعذّر تحميل نماذج التعرف على الوجه.", "error");
      return false;
    }
  }

  async function guardSession() {
    try {
      const res = await fetch(API.session, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok || !data.ok || !data.authenticated) {
        window.location.replace("/login");
        return false;
      }
      state.admin = data.admin || null;
      state.csrfToken = data.csrf || null;
      refs.adminName.textContent = (state.admin && state.admin.username) ? state.admin.username : "";
      refs.app.hidden = false;
      return true;
    } catch {
      window.location.replace("/login");
      return false;
    }
  }

  async function onLogout() {
    try {
      await fetch(API.logout, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
      });
    } catch {}
    window.location.replace("/login");
  }

  function bindNav() {
    const titles = {
      overview: "نظرة عامة",
      upload: "رفع الصور",
      library: "مكتبة الصور",
      jobs: "مهام الفهرسة",
      visitors: "زوار الألبوم",
      settings: "الإعدادات",
    };
    refs.navItems.forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        refs.navItems.forEach((b) => b.classList.toggle("is-active", b === btn));
        refs.views.forEach((v) => v.classList.toggle("is-active", v.id === "view-" + view));
        refs.viewTitle.textContent = titles[view] || "";
        refs.sidebar.classList.remove("is-open");
        onViewEnter(view);
      });
    });
    if (refs.menuToggle) {
      refs.menuToggle.addEventListener("click", () => {
        refs.sidebar.classList.toggle("is-open");
      });
    }
  }

  function onViewEnter(view) {
    if (view === "overview") loadStats();
    if (view === "library") {
      loadLibrary(true);
      ensureFaceEngine();
    }
    if (view === "jobs") loadJobs();
    if (view === "visitors") loadVisitors();
    if (view === "settings") loadSettings();
  }

  async function loadStats() {
    try {
      const res = await fetch(API.stats, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error();
      const s = data.stats || {};
      refs.statTotal.textContent = fmt(s.totalPhotos);
      refs.statIndexed.textContent = fmt(s.indexedPhotos);
      refs.statPending.textContent = fmt(s.pendingPhotos);
      refs.statFailed.textContent = fmt(s.failedPhotos);
      refs.statFaces.textContent = fmt(s.totalFaces);
      refs.statVisitors.textContent = fmt(s.galleryVisitors);

      refs.activityList.innerHTML = "";
      const list = Array.isArray(s.recentActivity) ? s.recentActivity : [];
      if (list.length === 0) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "لا توجد نشاطات بعد.";
        refs.activityList.appendChild(li);
      } else {
        list.forEach((item) => {
          const li = document.createElement("li");
          const left = document.createElement("span");
          left.textContent = item.label || item.type || "نشاط";
          const right = document.createElement("span");
          right.textContent = fmtDate(item.at);
          li.appendChild(left);
          li.appendChild(right);
          refs.activityList.appendChild(li);
        });
      }
    } catch {
      showToast("تعذّر تحميل الإحصائيات.", "error");
    }
  }

  function acceptFiles(files) {
    const accepted = [];
    const rejected = [];
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) { rejected.push({ name: f.name, reason: "صيغة غير مدعومة" }); continue; }
      if (f.size > MAX_BYTES) { rejected.push({ name: f.name, reason: "الحجم يتجاوز 25MB" }); continue; }
      if (f.size < 2 * 1024) { rejected.push({ name: f.name, reason: "الملف تالف أو صغير جداً" }); continue; }
      accepted.push(f);
    }
    for (const r of rejected) showToast(r.name + ": " + r.reason, "error");
    return accepted;
  }

  async function addToQueue(files) {
    const accepted = acceptFiles(files);
    if (accepted.length === 0) return;
    for (const file of accepted) {
      const item = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        file,
        status: "queued",
        progress: 0,
        error: null,
        previewUrl: URL.createObjectURL(file),
        photoId: null,
        faceCount: 0,
      };
      state.uploadQueue.push(item);
    }
    renderUploadList();
    ensureFaceEngine();
  }

  function clearQueue() {
    if (state.uploading) { showToast("لا يمكن الإفراغ أثناء الرفع.", "error"); return; }
    state.uploadQueue.forEach((it) => { if (it.previewUrl) URL.revokeObjectURL(it.previewUrl); });
    state.uploadQueue = [];
    renderUploadList();
  }

  function renderUploadList() {
    refs.uploadList.innerHTML = "";
    if (state.uploadQueue.length === 0) {
      refs.uploadControls.hidden = true;
      return;
    }
    refs.uploadControls.hidden = false;

    let doneCount = 0, errCount = 0, totalBytes = 0;
    state.uploadQueue.forEach((it) => {
      totalBytes += it.file.size;
      if (it.status === "done") doneCount++;
      if (it.status === "error") errCount++;
    });

    refs.uploadSummary.textContent =
      state.uploadQueue.length + " صورة · " + fmtBytes(totalBytes) +
      " · اكتمل " + doneCount + (errCount ? " · فشل " + errCount : "");

    const frag = document.createDocumentFragment();
    state.uploadQueue.forEach((it) => {
      const li = document.createElement("li");
      li.className = "up-item";

      const img = document.createElement("img");
      img.className = "up-thumb";
      img.alt = "";
      img.src = it.previewUrl;

      const body = document.createElement("div");
      body.className = "up-body";

      const name = document.createElement("div");
      name.className = "up-name";
      name.textContent = it.file.name;

      const meta = document.createElement("div");
      meta.className = "up-meta";
      meta.textContent = fmtBytes(it.file.size);

      const bar = document.createElement("div");
      bar.className = "up-bar";
      const fill = document.createElement("div");
      fill.className = "up-bar-fill";
      fill.style.width = it.progress + "%";
      bar.appendChild(fill);

      body.appendChild(name);
      body.appendChild(meta);
      body.appendChild(bar);

      const status = document.createElement("span");
      status.className = "up-status";
      if (it.status === "queued") status.textContent = "بالانتظار";
      else if (it.status === "detecting") { status.textContent = "تحليل الوجه"; status.classList.add("is-run"); }
      else if (it.status === "uploading") { status.textContent = "جارٍ الرفع"; status.classList.add("is-run"); }
      else if (it.status === "indexing") { status.textContent = "فهرسة"; status.classList.add("is-run"); }
      else if (it.status === "done") {
        status.textContent = it.faceCount ? ("تم · " + it.faceCount + " وجه") : "تم";
        status.classList.add("is-ok");
      }
      else if (it.status === "error") { status.textContent = it.error || "فشل"; status.classList.add("is-err"); }

      li.appendChild(img);
      li.appendChild(body);
      li.appendChild(status);
      frag.appendChild(li);
    });
    refs.uploadList.appendChild(frag);
  }

  async function uploadOne(item) {
    item.progress = 3;
    item.status = "detecting";
    renderUploadList();

    let faces = [];
    try {
      const ok = await ensureFaceEngine();
      if (ok) {
        const detected = await window.EvanoFace.embedFile(item.file, {
          maxDim: 1600,
          inputSize: 1024,
          scoreThreshold: 0.35,
        });
        faces = detected
          .filter((d) => Array.isArray(d.descriptor) && d.descriptor.length === 128)
          .map((d) => d.descriptor);
        console.log("[upload] detected faces for " + item.file.name + ":", faces.length);
      }
    } catch (err) {
      console.warn("[upload] face detection failed:", err);
      faces = [];
    }

    item.faceCount = faces.length;
    item.status = "uploading";
    item.progress = 10;
    renderUploadList();

    try {
      const sigRes = await fetch(API.uploadSignature, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: JSON.stringify({
          filename: item.file.name,
          size: item.file.size,
          type: item.file.type,
        }),
      });
      const sigData = await safeJson(sigRes);
      if (!sigRes.ok || !sigData.ok || !sigData.signature) {
        throw new Error((sigData && sigData.message) || "تعذّر تجهيز الرفع.");
      }

      item.progress = 18;
      renderUploadList();

      const form = new FormData();
      form.append("file", item.file);
      form.append("api_key", sigData.signature.apiKey);
      form.append("timestamp", String(sigData.signature.timestamp));
      form.append("signature", sigData.signature.signature);
      form.append("folder", sigData.signature.folder);
      form.append("public_id", sigData.signature.publicId);
      form.append("resource_type", "image");

      const url = "https://api.cloudinary.com/v1_1/" + sigData.signature.cloudName + "/image/upload";

      const uploaded = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            item.progress = 18 + Math.round((e.loaded / e.total) * 70);
            renderUploadList();
          }
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && data && data.public_id) resolve(data);
            else reject(new Error((data && data.error && data.error.message) || "فشل رفع الصورة."));
          } catch {
            reject(new Error("استجابة غير صالحة من خدمة الصور."));
          }
        };
        xhr.onerror = () => reject(new Error("تعذّر الاتصال بخدمة الصور."));
        xhr.send(form);
      });

      item.progress = 92;
      item.status = "indexing";
      renderUploadList();

      const regRes = await fetch(API.register, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: JSON.stringify({
          publicId: uploaded.public_id,
          secureUrl: uploaded.secure_url,
          width: uploaded.width,
          height: uploaded.height,
          bytes: uploaded.bytes,
          format: uploaded.format,
          originalFilename: item.file.name,
          faces,
        }),
      });
      const regData = await safeJson(regRes);
      if (!regRes.ok || !regData.ok) {
        throw new Error((regData && regData.message) || "تعذّر تسجيل الصورة.");
      }

      item.photoId = regData.photoId || null;
      item.status = "done";
      item.progress = 100;
      renderUploadList();
      return { ok: true, item };
    } catch (err) {
      item.status = "error";
      item.error = err.message || "فشل";
      renderUploadList();
      return { ok: false, item, error: err.message };
    }
  }

  async function runQueue() {
    if (state.uploading) return;
    const pending = state.uploadQueue.filter((it) => it.status === "queued" || it.status === "error");
    if (pending.length === 0) { showToast("لا توجد صور للرفع."); return; }

    state.uploading = true;
    setBusy(refs.btnUploadStart, true, "جارٍ الرفع…");

    let index = 0;
    async function worker() {
      while (index < pending.length) {
        const item = pending[index++];
        await uploadOne(item);
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, pending.length); i++) workers.push(worker());
    await Promise.all(workers);

    state.uploading = false;
    setBusy(refs.btnUploadStart, false);
    showToast("اكتمل الرفع.", "success");
    loadStats();
  }

  function retryItem(id) {
    const item = state.uploadQueue.find((x) => x.id === id);
    if (!item) return;
    item.status = "queued";
    item.error = null;
    item.progress = 0;
    renderUploadList();
  }

  async function loadLibrary(reset) {
    if (state.libLoading) return;
    if (!reset && state.libDone) return;
    state.libLoading = true;

    if (reset) {
      state.libCursor = null;
      state.libDone = false;
      refs.libGrid.innerHTML = "";
      refs.libEmpty.hidden = true;
      refs.btnLibMore.hidden = true;
    }

    try {
      const params = new URLSearchParams();
      params.set("limit", String(LIB_PAGE_SIZE));
      if (state.libCursor) params.set("cursor", state.libCursor);
      if (state.libFilter) params.set("status", state.libFilter);
      if (state.libQuery) params.set("q", state.libQuery);

      const res = await fetch(API.photos + "?" + params.toString(), { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّر تحميل المكتبة.");

      const items = Array.isArray(data.items) ? data.items : [];
      items.forEach(appendLibTile);
      state.libCursor = data.nextCursor || null;
      if (!data.nextCursor) state.libDone = true;

      if (refs.libGrid.children.length === 0) refs.libEmpty.hidden = false;
      refs.btnLibMore.hidden = state.libDone || items.length === 0;
    } catch (err) {
      showToast(err.message || "تعذّر تحميل المكتبة.", "error");
    } finally {
      state.libLoading = false;
    }
  }

  function appendLibTile(item) {
    const tile = document.createElement("div");
    tile.className = "lib-tile";
    tile.dataset.photoId = item.id;

    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = item.thumbnailUrl || item.url;
    tile.appendChild(img);

    const badge = document.createElement("span");
    badge.className = "badge";
    const s = item.status || "pending";
    badge.textContent = s === "indexed" ? "مفهرسة" : s === "failed" ? "فاشلة" : "قيد المعالجة";
    if (s === "indexed") badge.classList.add("is-indexed");
    else if (s === "failed") badge.classList.add("is-failed");
    else badge.classList.add("is-pending");
    tile.appendChild(badge);

    const actions = document.createElement("div");
    actions.className = "lib-tile-actions";

    if (s !== "indexed") {
      const fBtn = document.createElement("button");
      fBtn.className = "icon-btn";
      fBtn.type = "button";
      fBtn.title = "فهرسة الآن";
      fBtn.textContent = "⚡";
      fBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        indexPhotoNow(item);
      });
      actions.appendChild(fBtn);
    }

    const reBtn = document.createElement("button");
    reBtn.className = "icon-btn";
    reBtn.type = "button";
    reBtn.title = "إعادة الفهرسة";
    reBtn.textContent = "↻";
    reBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reindexPhoto(item.id);
    });
    actions.appendChild(reBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn danger";
    delBtn.type = "button";
    delBtn.title = "حذف";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deletePhoto(item.id, item.originalFilename);
    });
    actions.appendChild(delBtn);

    tile.appendChild(actions);

    const info = document.createElement("div");
    info.className = "lib-tile-info";
    const left = document.createElement("span");
    left.textContent = item.originalFilename || "";
    const right = document.createElement("span");
    right.textContent = item.faceCount ? (item.faceCount + " وجه") : fmtBytes(item.bytes);
    info.appendChild(left);
    info.appendChild(right);
    tile.appendChild(info);

    refs.libGrid.appendChild(tile);
  }

  async function fetchImageAsFile(url, filename) {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error("fetch-image-failed");
    const blob = await res.blob();
    return new File([blob], filename || "photo.jpg", { type: blob.type || "image/jpeg" });
  }

  async function indexPhotoNow(item) {
    const tile = refs.libGrid.querySelector('[data-photo-id="' + item.id + '"]');
    if (tile) tile.style.opacity = "0.5";

    try {
      const ok = await ensureFaceEngine();
      if (!ok) throw new Error("المحرك غير جاهز.");

      const file = await fetchImageAsFile(item.url || item.thumbnailUrl, item.originalFilename || "photo.jpg");
      const detected = await window.EvanoFace.embedFile(file, {
        maxDim: 1600,
        inputSize: 1024,
        scoreThreshold: 0.35,
      });
      const faces = detected
        .filter((d) => Array.isArray(d.descriptor) && d.descriptor.length === 128)
        .map((d) => d.descriptor);

      console.log("[index] " + (item.originalFilename || item.id) + " → " + faces.length + " وجه");

      const res = await fetch("/api/admin/photos/" + encodeURIComponent(item.id) + "/faces", {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: JSON.stringify({ faces }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّرت الفهرسة.");

      showToast("تمت فهرسة الصورة (" + faces.length + " وجه).", "success");
      loadLibrary(true);
      loadStats();
    } catch (err) {
      showToast(err.message || "تعذّرت الفهرسة.", "error");
    } finally {
      if (tile) tile.style.opacity = "1";
    }
  }

  async function reindexAllPending() {
    if (state.reindexing) return;
    state.reindexing = true;
    setBusy(refs.btnReindexAll, true, "جارٍ الفهرسة…");

    try {
      const ok = await ensureFaceEngine();
      if (!ok) throw new Error("المحرك غير جاهز.");

      let processed = 0;
      let totalFaces = 0;
      let skipped = 0;

      while (true) {
        const params = new URLSearchParams();
        params.set("limit", "10");
        params.set("status", "pending");

        const res = await fetch(API.photos + "?" + params.toString(), { credentials: "include" });
        const data = await safeJson(res);
        if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّر جلب القائمة.");

        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length === 0) break;

        for (const item of items) {
          try {
            const file = await fetchImageAsFile(item.url || item.thumbnailUrl, item.originalFilename || "photo.jpg");
            const detected = await window.EvanoFace.embedFile(file, {
              maxDim: 1600,
              inputSize: 1024,
              scoreThreshold: 0.35,
            });
            const faces = detected
              .filter((d) => Array.isArray(d.descriptor) && d.descriptor.length === 128)
              .map((d) => d.descriptor);

            console.log("[reindex-all] " + (item.originalFilename || item.id) + " → " + faces.length + " وجه");

            await fetch("/api/admin/photos/" + encodeURIComponent(item.id) + "/faces", {
              method: "POST",
              credentials: "include",
              headers: csrfHeaders(),
              body: JSON.stringify({ faces }),
            });

            processed++;
            totalFaces += faces.length;
            if (faces.length === 0) skipped++;
          } catch (err) {
            console.warn("[reindex-all] failed for", item.id, err);
            skipped++;
          }
        }
      }

      showToast(
        "اكتملت الفهرسة: " + processed + " صورة · " + totalFaces + " وجه" +
        (skipped ? " · " + skipped + " بدون وجه" : ""),
        "success"
      );
      loadLibrary(true);
      loadStats();
    } catch (err) {
      showToast(err.message || "تعذّرت الفهرسة.", "error");
    } finally {
      state.reindexing = false;
      setBusy(refs.btnReindexAll, false);
    }
  }

  async function reindexPhoto(id) {
    try {
      const res = await fetch(API.reindex(id), {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّر بدء إعادة الفهرسة.");
      showToast("أُعيدت الصورة إلى حالة الانتظار. اضغط ⚡ لفهرستها.", "success");
      loadLibrary(true);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function deletePhoto(id, name) {
    if (!confirm("سيتم حذف الصورة " + (name ? '"' + name + '"' : "") + " وجميع بياناتها. هل تريد المتابعة؟")) return;
    try {
      const res = await fetch(API.remove(id), {
        method: "DELETE",
        credentials: "include",
        headers: csrfHeaders(),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّر الحذف.");
      showToast("تم حذف الصورة.", "success");
      loadLibrary(true);
      loadStats();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  async function loadJobs() {
    refs.jobsList.innerHTML = "";
    try {
      const res = await fetch(API.jobs, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      if (jobs.length === 0) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "لا توجد مهام فاشلة.";
        refs.jobsList.appendChild(li);
        return;
      }
      jobs.forEach((job) => {
        const li = document.createElement("li");
        li.className = "job-item";
        const info = document.createElement("div");
        const name = document.createElement("div");
        name.className = "up-name";
        name.textContent = job.filename || job.photoId || "مهمة";
        const meta = document.createElement("div");
        meta.className = "up-meta";
        meta.textContent = (job.error || "خطأ غير معروف") + " · " + fmtDate(job.updatedAt);
        info.appendChild(name);
        info.appendChild(meta);
        const retry = document.createElement("button");
        retry.className = "btn btn-ghost btn-sm";
        retry.type = "button";
        retry.textContent = "إعادة";
        retry.addEventListener("click", async () => {
          try {
            const r = await fetch("/api/admin/jobs/" + encodeURIComponent(job.id) + "/retry", {
              method: "POST",
              credentials: "include",
              headers: csrfHeaders(),
            });
            const d = await safeJson(r);
            if (!r.ok || !d.ok) throw new Error((d && d.message) || "تعذّرت الإعادة.");
            showToast("أُعيدت المهمة.", "success");
            loadJobs();
          } catch (err) { showToast(err.message, "error"); }
        });
        li.appendChild(info);
        li.appendChild(retry);
        refs.jobsList.appendChild(li);
      });
    } catch {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "تعذّر تحميل المهام.";
      refs.jobsList.appendChild(li);
    }
  }

  async function loadVisitors() {
    refs.visitorsBody.innerHTML = '<tr><td colspan="4" class="muted">جارٍ التحميل…</td></tr>';
    try {
      const res = await fetch(API.visitors, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error();
      const v = data.visitors || {};
      refs.visTotal.textContent = fmt(v.total);
      refs.visActive.textContent = fmt(v.active);
      refs.visLast24.textContent = fmt(v.last24h);

      const sessions = Array.isArray(v.sessions) ? v.sessions : [];
      refs.visitorsBody.innerHTML = "";
      if (sessions.length === 0) {
        refs.visitorsBody.innerHTML = '<tr><td colspan="4" class="muted">لا توجد جلسات.</td></tr>';
        return;
      }
      const frag = document.createDocumentFragment();
      sessions.forEach((s) => {
        const tr = document.createElement("tr");
        const td1 = document.createElement("td");
        td1.textContent = fmtDate(s.createdAt);
        const td2 = document.createElement("td");
        td2.textContent = shortId(s.id);
        const td3 = document.createElement("td");
        td3.textContent = shortIp(s.ip);
        const td4 = document.createElement("td");
        td4.textContent = s.active ? "نشطة" : "منتهية";
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
        frag.appendChild(tr);
      });
      refs.visitorsBody.appendChild(frag);
    } catch {
      refs.visitorsBody.innerHTML = '<tr><td colspan="4" class="muted">تعذّر تحميل الزوار.</td></tr>';
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch(API.settings, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error();
      const s = data.settings || {};
      if (typeof s.similarityThreshold === "number") refs.setThreshold.value = s.similarityThreshold;
      if (typeof s.selfieRetentionMinutes === "number") refs.setSelfieTtl.value = s.selfieRetentionMinutes;
      if (typeof s.searchRateLimit === "number") refs.setRateLimit.value = s.searchRateLimit;
    } catch {
      showToast("تعذّر تحميل الإعدادات.", "error");
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    refs.settingsMsg.hidden = true;
    setBusy(refs.btnSaveSettings, true, "جارٍ الحفظ…");
    try {
      const payload = {
        similarityThreshold: Number(refs.setThreshold.value),
        selfieRetentionMinutes: Number(refs.setSelfieTtl.value),
        searchRateLimit: Number(refs.setRateLimit.value),
      };
      const res = await fetch(API.settings, {
        method: "PATCH",
        credentials: "include",
        headers: csrfHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّر الحفظ.");
      showToast("تم حفظ الإعدادات.", "success");
    } catch (err) {
      refs.settingsMsg.textContent = err.message;
      refs.settingsMsg.hidden = false;
    } finally {
      setBusy(refs.btnSaveSettings, false);
    }
  }

  async function saveAlbumCode(e) {
    e.preventDefault();
    refs.codeMsg.hidden = true;
    const a = refs.newCode.value.trim();
    const b = refs.confirmCode.value.trim();
    if (a.length < 4) {
      refs.codeMsg.textContent = "الرمز قصير جداً.";
      refs.codeMsg.hidden = false;
      return;
    }
    if (a !== b) {
      refs.codeMsg.textContent = "الرمز وتأكيده غير متطابقين.";
      refs.codeMsg.hidden = false;
      return;
    }
    setBusy(refs.btnSaveCode, true, "جارٍ التحديث…");
    try {
      const res = await fetch(API.changeCode, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
        body: JSON.stringify({ newCode: a }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّر التحديث.");
      refs.newCode.value = "";
      refs.confirmCode.value = "";
      showToast("تم تحديث رمز الألبوم.", "success");
    } catch (err) {
      refs.codeMsg.textContent = err.message;
      refs.codeMsg.hidden = false;
    } finally {
      setBusy(refs.btnSaveCode, false);
    }
  }

  function bindUpload() {
    refs.btnPick.addEventListener("click", (e) => { e.stopPropagation(); refs.filePicker.click(); });
    refs.dropzone.addEventListener("click", () => refs.filePicker.click());
    refs.dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); refs.filePicker.click(); }
    });

    refs.filePicker.addEventListener("change", (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length) addToQueue(files);
      refs.filePicker.value = "";
    });

    ["dragenter","dragover"].forEach((ev) =>
      refs.dropzone.addEventListener(ev, (e) => { e.preventDefault(); refs.dropzone.classList.add("is-over"); })
    );
    ["dragleave","drop"].forEach((ev) =>
      refs.dropzone.addEventListener(ev, (e) => { e.preventDefault(); refs.dropzone.classList.remove("is-over"); })
    );
    refs.dropzone.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length) addToQueue(files);
    });

    refs.btnUploadStart.addEventListener("click", runQueue);
    refs.btnUploadClear.addEventListener("click", clearQueue);

    refs.uploadList.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-retry]");
      if (btn) retryItem(btn.getAttribute("data-retry"));
    });
  }

  function bindLibrary() {
    refs.filterStatus.addEventListener("change", () => {
      state.libFilter = refs.filterStatus.value;
      loadLibrary(true);
    });
    let qT;
    refs.searchBox.addEventListener("input", () => {
      clearTimeout(qT);
      qT = setTimeout(() => {
        state.libQuery = refs.searchBox.value.trim();
        loadLibrary(true);
      }, 320);
    });
    refs.btnLibMore.addEventListener("click", () => loadLibrary(false));
    if (refs.btnReindexAll) {
      refs.btnReindexAll.addEventListener("click", reindexAllPending);
    }
  }

  function bindSettings() {
    refs.formSettings.addEventListener("submit", saveSettings);
    refs.formCode.addEventListener("submit", saveAlbumCode);
    refs.btnVisitorsRefresh.addEventListener("click", loadVisitors);
  }

  function init() {
    bindNav();
    bindUpload();
    bindLibrary();
    bindSettings();
    refs.btnLogout.addEventListener("click", onLogout);

    guardSession().then((ok) => {
      if (!ok) return;
      loadStats();
      ensureFaceEngine();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
