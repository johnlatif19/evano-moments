(function () {
  "use strict";

  const API = {
    access: "/api/gallery/access",
    logout: "/api/gallery/logout",
    session: "/api/gallery/session",
    photos: "/api/gallery/photos",
  };

  const PAGE_SIZE = 50;

  const state = {
    authed: false,
    cursor: null,
    loading: false,
    done: false,
    total: 0,
    items: [],
    lbIndex: -1,
  };

  const el = (id) => document.getElementById(id);

  const refs = {
    gate: el("gate"),
    formGate: el("form-gate"),
    galleryCode: el("galleryCode"),
    gateError: el("gateError"),
    btnGate: el("btn-gate"),

    album: el("album"),
    albumToolbar: el("albumToolbar"),
    albumCount: el("albumCount"),
    btnLogoutGallery: el("btn-logout-gallery"),

    grid: el("grid"),
    loader: el("loader"),
    albumEmpty: el("albumEmpty"),
    albumEnd: el("albumEnd"),
    gallerySub: el("gallerySub"),

    lightbox: el("lightbox"),
    lbImg: el("lbImg"),
    lbClose: el("lbClose"),
    lbPrev: el("lbPrev"),
    lbNext: el("lbNext"),

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

  function showGate() {
    state.authed = false;
    refs.gate.hidden = false;
    refs.album.hidden = true;
    refs.galleryCode.value = "";
    refs.galleryCode.focus();
  }

  function showAlbum() {
    state.authed = true;
    refs.gate.hidden = true;
    refs.album.hidden = false;
    refs.albumToolbar.hidden = false;
  }

  async function checkSession() {
    try {
      const res = await fetch(API.session, { credentials: "include" });
      const data = await safeJson(res);
      if (data && data.ok && data.authed) {
        showAlbum();
        loadNextPage();
      } else {
        showGate();
      }
    } catch {
      showGate();
    }
  }

  async function onGateSubmit(e) {
    e.preventDefault();
    if (refs.gateError) refs.gateError.hidden = true;

    const code = (refs.galleryCode.value || "").trim();
    if (code.length < 4) {
      refs.gateError.textContent = "الرمز قصير جداً.";
      refs.gateError.hidden = false;
      refs.galleryCode.focus();
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

      showAlbum();
      state.cursor = null;
      state.done = false;
      state.items = [];
      refs.grid.innerHTML = "";
      loadNextPage();
    } catch {
      refs.gateError.textContent = "تعذّر الاتصال بالخدمة. تحقق من الشبكة.";
      refs.gateError.hidden = false;
    } finally {
      setBusy(refs.btnGate, false);
    }
  }

  async function onLogout() {
    try {
      await fetch(API.logout, { method: "POST", credentials: "include" });
    } catch {}
    state.items = [];
    state.cursor = null;
    state.done = false;
    refs.grid.innerHTML = "";
    refs.albumEnd.hidden = true;
    refs.albumEmpty.hidden = true;
    showGate();
    showToast("تم إغلاق الألبوم.");
  }

  async function loadNextPage() {
    if (state.loading || state.done || !state.authed) return;
    state.loading = true;
    refs.loader.hidden = false;

    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      if (state.cursor) params.set("cursor", state.cursor);

      const res = await fetch(API.photos + "?" + params.toString(), {
        credentials: "include",
      });
      const data = await safeJson(res);

      if (res.status === 401 || (data && data.ok === false && data.reason === "unauthorized")) {
        showGate();
        return;
      }
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "تعذّر تحميل الصور.");

      const items = Array.isArray(data.items) ? data.items : [];
      appendTiles(items);
      state.items = state.items.concat(items);
      state.cursor = data.nextCursor || null;
      if (!data.nextCursor || items.length === 0) state.done = true;

      state.total = typeof data.total === "number" ? data.total : state.items.length;
      updateCount();

      if (state.items.length === 0) {
        refs.albumEmpty.hidden = false;
      }
      if (state.done && state.items.length > 0) {
        refs.albumEnd.hidden = false;
      }
    } catch (err) {
      showToast(err.message || "تعذّر تحميل الصور.", "error");
    } finally {
      state.loading = false;
      refs.loader.hidden = true;
    }
  }

  function updateCount() {
    if (!refs.albumCount) return;
    if (state.total > 0) {
      refs.albumCount.textContent = "تم عرض " + state.items.length + " من " + state.total + " صورة";
    } else {
      refs.albumCount.textContent = "تم عرض " + state.items.length + " صورة";
    }
  }

  function appendTiles(items) {
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "tile";
      li.style.animationDelay = Math.min(idx * 18, 320) + "ms";
      li.tabIndex = 0;

      const img = document.createElement("img");
      img.alt = item.alt || "صورة";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = item.thumbnailUrl || item.url;
      img.addEventListener("error", () => {
        img.src = "data:image/svg+xml;utf8," + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f4efe6"/></svg>'
        );
      });

      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "tile-download";
      dl.setAttribute("aria-label", "تحميل الصورة");
      dl.innerHTML = '<span class="dl-icon" aria-hidden="true"></span><span>تحميل</span>';
      dl.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadItem(item);
      });

      li.appendChild(img);
      li.appendChild(dl);

      const open = () => openLightbox(item);
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });

      li._item = item;
      frag.appendChild(li);
    });
    refs.grid.appendChild(frag);
  }

  function downloadItem(item) {
    const url = item.downloadUrl || item.url;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = item.filename || "evano-moment.jpg";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openLightbox(item) {
    const idx = state.items.findIndex((x) => x.id === item.id);
    state.lbIndex = idx >= 0 ? idx : 0;
    updateLightbox();
    refs.lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    refs.lbClose.focus();
  }

  function closeLightbox() {
    refs.lightbox.hidden = true;
    document.body.style.overflow = "";
  }

  function updateLightbox() {
    const item = state.items[state.lbIndex];
    if (!item) return;
    refs.lbImg.src = item.url || item.thumbnailUrl;
    refs.lbImg.alt = item.alt || "صورة";
  }

  function nextLb() {
    if (state.items.length === 0) return;
    state.lbIndex = (state.lbIndex + 1) % state.items.length;
    updateLightbox();
  }

  function prevLb() {
    if (state.items.length === 0) return;
    state.lbIndex = (state.lbIndex - 1 + state.items.length) % state.items.length;
    updateLightbox();
  }

  function bind() {
    refs.formGate.addEventListener("submit", onGateSubmit);
    refs.btnLogoutGallery.addEventListener("click", onLogout);

    refs.lbClose.addEventListener("click", closeLightbox);
    refs.lbPrev.addEventListener("click", prevLb);
    refs.lbNext.addEventListener("click", nextLb);
    refs.lightbox.addEventListener("click", (e) => {
      if (e.target === refs.lightbox) closeLightbox();
    });

    document.addEventListener("keydown", (e) => {
      if (refs.lightbox.hidden) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") prevLb();
      if (e.key === "ArrowLeft") nextLb();
    });

    const sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    refs.album.appendChild(sentinel);

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) loadNextPage();
        });
      }, { rootMargin: "600px 0px" });
      io.observe(sentinel);
    } else {
      window.addEventListener("scroll", () => {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 700) {
          loadNextPage();
        }
      });
    }
  }

  function init() {
    bind();
    checkSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();