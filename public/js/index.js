(function () {
  "use strict";

  const toast = document.getElementById("toast");

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  document.querySelectorAll('a[href^="/"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    });
  });

  if (toast) {
    toast.addEventListener("click", () => { toast.hidden = true; });
  }
})();