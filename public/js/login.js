(function () {
  "use strict";

  const API = {
    login: "/api/admin/login",
    session: "/api/admin/session",
  };

  const el = (id) => document.getElementById(id);
  const refs = {
    form: el("form-login"),
    username: el("username"),
    password: el("password"),
    togglePassword: el("togglePassword"),
    error: el("loginError"),
    btnLogin: el("btn-login"),
    toast: el("toast"),
  };

  function showToast(message, kind) {
    if (!refs.toast) return;
    refs.toast.textContent = message;
    refs.toast.className = "toast" + (kind ? " toast-" + kind : "");
    refs.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { refs.toast.hidden = true; }, 4000);
  }

  function setBusy(busy) {
    const label = refs.btnLogin.querySelector(".btn-label");
    const spinner = refs.btnLogin.querySelector(".spinner");
    if (busy) {
      refs.btnLogin.disabled = true;
      if (label) {
        if (!label.dataset.original) label.dataset.original = label.textContent;
        label.textContent = "جارٍ التحقق…";
      }
      if (spinner) spinner.hidden = false;
    } else {
      refs.btnLogin.disabled = false;
      if (label && label.dataset.original) label.textContent = label.dataset.original;
      if (spinner) spinner.hidden = true;
    }
  }

  function setError(message) {
    refs.error.textContent = message || "";
    refs.error.hidden = !message;
  }

  function clearError() { setError(""); }

  function togglePassword() {
    const pressed = refs.togglePassword.getAttribute("aria-pressed") === "true";
    const next = !pressed;
    refs.togglePassword.setAttribute("aria-pressed", String(next));
    refs.togglePassword.setAttribute("aria-label", next ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
    refs.password.type = next ? "text" : "password";
    refs.password.focus();
  }

  async function safeJson(res) {
    try { const d = await res.json(); return d && typeof d === "object" ? d : {}; }
    catch { return {}; }
  }

  async function checkExistingSession() {
    try {
      const res = await fetch(API.session, { credentials: "include" });
      const data = await safeJson(res);
      if (data && data.ok && data.authenticated) {
        window.location.replace("/dashboard");
      }
    } catch { /* ignore */ }
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearError();

    const username = (refs.username.value || "").trim();
    const password = refs.password.value || "";

    if (!username || !password) {
      setError("يرجى إدخال اسم المستخدم وكلمة المرور.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(API.login, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await safeJson(res);

      if (!res.ok || !data.ok) {
        if (res.status === 429) {
          setError("محاولات كثيرة. حاول لاحقاً.");
        } else if (res.status === 401) {
          setError("بيانات الدخول غير صحيحة.");
        } else {
          setError((data && data.message) || "تعذّر تسجيل الدخول.");
        }
        refs.password.value = "";
        refs.password.focus();
        return;
      }

      window.location.replace("/dashboard");
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقق من الشبكة.");
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    refs.form.addEventListener("submit", onSubmit);
    refs.togglePassword.addEventListener("click", togglePassword);
    refs.username.addEventListener("input", clearError);
    refs.password.addEventListener("input", clearError);
  }

  function init() {
    bind();
    checkExistingSession();
    refs.username.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();