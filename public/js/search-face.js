(function () {
  "use strict";

  const API = {
    session: "/api/gallery/session",
    access: "/api/gallery/access",
    search: "/api/guest/search",
    deleteSession: "/api/guest/search-session/delete",
  };

  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MIN_FILE_BYTES = 4 * 1024;
  const MIN_DIM = 200;
  const MAX_DIM = 6000;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  const state = {
    authed: false,
    selfieFile: null,
    selfiePreviewUrl: null,
    sessionId: null,
    abortController: null,
    busy: false,
  };

  const el = (id) => document.getElementById(id);
  const refs = {
    gate: el("gate"),
    formGate: el("form-gate"),
    galleryCode: el("galleryCode"),
    gateError: el("gateError"),
    btnGate: el("btn-gate"),

    search: el("search"),

    consentCheckbox: el("consentCheckbox"),
    selfieFieldset: el("selfie-fieldset"),
    btnCamera: el("btn-camera"),
    btnUpload: el("btn-upload"),
    cameraInput: el("cameraInput"),
    fileInput: el("fileInput"),

    preview: el("preview"),
    previewImg: el("previewImg"),
    previewInfo: el("previewInfo"),
    btnReplace: el("btn-replace"),
    btnClear: el("btn-clear"),

    selfieError: el("selfieError"),
    btnSearch: el("btn-search"),

    placeholder: el("placeholder"),
    stateSearching: el("state-searching"),
    stateResults: el("state-results"),
    stateEmpty: el("state-empty"),
    stateError: el("state-error"),
    progressBar: el("progressBar"),
    progressFill: el("progressFill"),
    searchingText: el("searchingText"),
    btnCancelSearch: el("btn-cancel-search"),
    resultsCount: el("resultsCount"),
    gallery: el("gallery"),
    errorText: el("errorText"),
    btnRetry: el("btn-retry"),
    btnErrorRetry: el("btn-error-retry"),
    sessionControls: el("sessionControls"),
    btnDeleteSession: el("btn-delete-session"),

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

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const u = ["B","KB","MB","GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + u[i];
  }

  function readImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        URL.revokeObjectURL(url);
        resolve({ width: w, height: h });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("invalid-image"));
      };
      img.src = url;
    });
  }

  async function validateSelfie(file) {
    if (!file) throw new Error("لم يتم اختيار صورة.");
    if (!ALLOWED_TYPES.includes(file.type)) throw new Error("صيغة الصورة غير مدعومة.");
    if (file.size < MIN_FILE_BYTES) throw new Error("الملف صغير جداً أو تالف.");
    if (file.size > MAX_FILE_BYTES) throw new Error("حجم الصورة كبير جداً (الحد " + formatBytes(MAX_FILE_BYTES) + ").");

    const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
                   buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    if (!isJpeg && !isPng && !isWebp) throw new Error("محتوى الملف لا يبدو صورة صالحة.");

    const dims = await readImageDimensions(file);
    if (dims.width < MIN_DIM || dims.height < MIN_DIM) throw new Error("أبعاد الصورة صغيرة جداً.");
    if (dims.width > MAX_DIM || dims.height > MAX_DIM) throw new Error("أبعاد الصورة كبيرة جداً.");
    return dims;
  }

  function resetSelfie() {
    if (state.selfiePreviewUrl) {
      URL.revokeObjectURL(state.selfiePreviewUrl);
      state.selfiePreviewUrl = null;
    }
    state.selfieFile = null;
    refs.preview.hidden = true;
    refs.previewImg.removeAttribute("src");
    refs.previewInfo.textContent = "";
    refs.fileInput.value = "";
    refs.cameraInput.value = "";
    if (refs.selfieError) { refs.selfieError.textContent = ""; refs.selfieError.hidden = true; }
    updateSearchButton();
  }

  function updateSearchButton() {
    const consent = refs.consentCheckbox.checked;
    const hasFile = !!state.selfieFile;
    refs.selfieFieldset.disabled = !consent;
    refs.btnSearch.disabled = !(consent && hasFile) || state.busy;
  }

  async function onSelfieSelected(file) {
    refs.selfieError.hidden = true;
    try {
      const dims = await validateSelfie(file);
      if (state.selfiePreviewUrl) URL.revokeObjectURL(state.selfiePreviewUrl);
      state.selfieFile = file;
      state.selfiePreviewUrl = URL.createObjectURL(file);
      refs.previewImg.src = state.selfiePreviewUrl;
      refs.previewInfo.textContent =
        file.name + " · " + formatBytes(file.size) + " · " + dims.width + "×" + dims.height;
      refs.preview.hidden = false;
    } catch (err) {
      resetSelfie();
      refs.selfieError.textContent = err.message || "تعذّر قراءة الصورة.";
      refs.selfieError.hidden = false;
    }
    updateSearchButton();
  }

  function showGate() {
    state.authed = false;
    refs.gate.hidden = false;
    refs.search.hidden = true;
    refs.galleryCode.value = "";
    refs.galleryCode.focus();
  }

  function showSearch() {
    state.authed = true;
    refs.gate.hidden = true;
    refs.search.hidden = false;
  }

  async function checkSession() {
    try {
      const res = await fetch(API.session, { credentials: "include" });
      const data = await safeJson(res);
      if (data && data.ok && data.authed) {
        showSearch();
      } else {
        showGate();
      }
    } catch {
      showGate();
    }
  }

  async function onGateSubmit(e) {
    e.preventDefault();
    refs.gateError.hidden = true;
    const code = (refs.galleryCode.value || "").trim();
    if (code.length < 4) {
      refs.gateError.textContent = "الرمز قصير جداً.";
      refs.gateError.hidden = false;
      return;
    }
    setBusy(refs.btnGate, true, "جارٍ التحقق…");
    try {
      const res = await fetch(API.access, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await safeJson(res);
      if (!res.ok || !data.ok) {
        refs.gateError.textContent =
          (data && data.message) ||
          (res.status === 429 ? "محاولات كثيرة. حاول لاحقاً." : "الرمز غير صحيح.");
        refs.gateError.hidden = false;
        return;
      }
      showSearch();
    } catch {
      refs.gateError.textContent = "تعذّر الاتصال بالخدمة. تحقق من الشبكة.";
      refs.gateError.hidden = false;
    } finally {
      setBusy(refs.btnGate, false);
    }
  }

  function setResultState(name) {
    refs.placeholder.hidden = name !== "placeholder";
    refs.stateSearching.hidden = name !== "searching";
    refs.stateResults.hidden = name !== "results";
    refs.stateEmpty.hidden = name !== "empty";
    refs.stateError.hidden = name !== "error";
    refs.sessionControls.hidden = name !== "results";
  }

  function setProgress(v) {
    const val = Math.max(0, Math.min(100, Math.round(v)));
    refs.progressFill.style.width = val + "%";
    refs.progressBar.setAttribute("aria-valuenow", String(val));
  }

  async function computeEmbedding(file, signal) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const size = 224;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, size, size);
    bitmap.close?.();
    if (signal && signal.aborted) throw new DOMException("aborted", "AbortError");
    const imageData = ctx.getImageData(0, 0, size, size);
    const embedding = await window.EvanoFace.embed(imageData);
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("لم يتم العثور على وجه واضح في الصورة.");
    }
    return embedding;
  }

  async function onSearch() {
    if (state.busy) return;
    if (!refs.consentCheckbox.checked) {
      refs.selfieError.textContent = "يجب الموافقة على معالجة الوجه قبل البحث.";
      refs.selfieError.hidden = false;
      return;
    }
    if (!state.selfieFile) {
      refs.selfieError.textContent = "اختر صورة سيلفي أولاً.";
      refs.selfieError.hidden = false;
      return;
    }

    state.busy = true;
    refs.selfieError.hidden = true;
    setResultState("searching");
    setProgress(8);
    refs.searchingText.textContent = "جارٍ تحضير صورتك…";
    setBusy(refs.btnSearch, true, "جارٍ البحث…");
    state.abortController = new AbortController();

    try {
      setProgress(28);
      refs.searchingText.textContent = "جارٍ تحليل الوجه…";
      const embedding = await computeEmbedding(state.selfieFile, state.abortController.signal);

      setProgress(62);
      refs.searchingText.textContent = "جارٍ مطابقة الصور…";
      const res = await fetch(API.search, {
        method: "POST",
        credentials: "include",
        signal: state.abortController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embedding, sessionId: state.sessionId }),
      });
      setProgress(88);
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        throw new Error(
          (data && data.message) ||
          (res.status === 429 ? "عدد كبير من عمليات البحث. حاول لاحقاً." : "تعذّر إكمال البحث.")
        );
      }

      if (data.sessionId) state.sessionId = data.sessionId;
      const results = Array.isArray(data.results) ? data.results : [];
      setProgress(100);

      if (results.length === 0) {
        setResultState("empty");
      } else {
        renderResults(results);
        setResultState("results");
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        setResultState("placeholder");
        showToast("تم إلغاء البحث.");
      } else {
        refs.errorText.textContent = err.message || "حدث خطأ غير متوقع.";
        setResultState("error");
      }
    } finally {
      state.busy = false;
      setBusy(refs.btnSearch, false);
      state.abortController = null;
    }
  }

  function renderResults(results) {
    refs.gallery.innerHTML = "";
    refs.resultsCount.textContent =
      results.length === 1 ? "عثرنا على صورة واحدة مطابقة." :
      "عثرنا على " + results.length + " صور مطابقة.";

    const frag = document.createDocumentFragment();
    results.forEach((item) => {
      const li = document.createElement("li");
      li.className = "gallery-item";

      const img = document.createElement("img");
      img.alt = item.alt || "صورة مطابقة";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = item.thumbnailUrl || item.url;

      const actions = document.createElement("div");
      actions.className = "gallery-actions";

      const viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "btn";
      viewBtn.textContent = "عرض";
      viewBtn.addEventListener("click", () => {
        if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
      });

      const dlBtn = document.createElement("button");
      dlBtn.type = "button";
      dlBtn.className = "btn";
      dlBtn.textContent = "تحميل";
      dlBtn.addEventListener("click", () => {
        const url = item.downloadUrl || item.url;
        if (!url) return;
        const a = document.createElement("a");
        a.href = url;
        a.download = item.filename || "evano-moment.jpg";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      });

      actions.appendChild(viewBtn);
      actions.appendChild(dlBtn);
      li.appendChild(img);
      li.appendChild(actions);
      frag.appendChild(li);
    });
    refs.gallery.appendChild(frag);
  }

  async function onDeleteSession() {
    if (!confirm("سيتم حذف بيانات جلسة البحث الحالية. هل تريد المتابعة؟")) return;
    try {
      await fetch(API.deleteSession, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId }),
      });
    } catch {}
    state.sessionId = null;
    resetSelfie();
    refs.gallery.innerHTML = "";
    setResultState("placeholder");
    showToast("تم حذف بيانات الجلسة.", "success");
  }

  function bind() {
    refs.formGate.addEventListener("submit", onGateSubmit);

    refs.consentCheckbox.addEventListener("change", updateSearchButton);

    refs.btnCamera.addEventListener("click", () => refs.cameraInput.click());
    refs.btnUpload.addEventListener("click", () => refs.fileInput.click());
    refs.cameraInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) onSelfieSelected(f);
    });
    refs.fileInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) onSelfieSelected(f);
    });

    refs.btnReplace.addEventListener("click", () => refs.fileInput.click());
    refs.btnClear.addEventListener("click", resetSelfie);

    refs.btnSearch.addEventListener("click", onSearch);
    refs.btnCancelSearch.addEventListener("click", () => {
      if (state.abortController) state.abortController.abort();
    });

    refs.btnRetry.addEventListener("click", () => {
      resetSelfie();
      setResultState("placeholder");
    });
    refs.btnErrorRetry.addEventListener("click", onSearch);

    refs.btnDeleteSession.addEventListener("click", onDeleteSession);

    window.addEventListener("beforeunload", () => {
      if (state.selfiePreviewUrl) URL.revokeObjectURL(state.selfiePreviewUrl);
    });
  }

  function init() {
    if (!window.EvanoFace) {
      refs.btnSearch.disabled = true;
      refs.selfieError.textContent = "تعذّر تحميل محرّك التعرف على الوجه. أعد تحميل الصفحة.";
      refs.selfieError.hidden = false;
    }
    setResultState("placeholder");
    updateSearchButton();
    bind();
    checkSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();