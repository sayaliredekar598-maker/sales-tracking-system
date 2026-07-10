(function (global) {
  const DEFAULT_CONFIRM =
    "Are you sure you want to delete this record? This action cannot be undone.";

  function readActor() {
    const user = global.StsAuth ? global.StsAuth.readSessionUser() : {};
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      empId: user.empId || null
    };
  }

  function buttonHtml(deleteUrl, confirmMessage, refreshFn) {
    const msg = confirmMessage || DEFAULT_CONFIRM;
    const refresh = refreshFn ? ` data-refresh-fn="${refreshFn}"` : "";
    return `<button type="button" class="sts-delete-btn" data-delete-url="${deleteUrl}" data-delete-confirm="${String(msg).replace(/"/g, "&quot;")}"${refresh} title="Delete">
      <i class="fas fa-trash" aria-hidden="true"></i>
    </button>`;
  }

  async function remove(url, confirmMessage) {
    if (!url) return false;
    if (!confirm(confirmMessage || DEFAULT_CONFIRM)) return false;

    const actor = readActor();
    if (!actor.email) {
      alert("Please sign in again to delete records.");
      return false;
    }

    const res = await fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requested_by: actor })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || "Could not delete record.");
      return false;
    }
    return true;
  }

  document.addEventListener("click", async (event) => {
    const btn = event.target.closest(".sts-delete-btn,[data-delete-url]");
    if (!btn || !btn.dataset.deleteUrl) return;

    event.preventDefault();
    const ok = await remove(btn.dataset.deleteUrl, btn.dataset.deleteConfirm);
    if (!ok) return;

    const row = btn.closest("tr");
    if (row) row.remove();

    const refreshFn = btn.dataset.refreshFn;
    if (refreshFn && typeof global[refreshFn] === "function") {
      global[refreshFn]();
    }

    document.dispatchEvent(new CustomEvent("sts:deleted", { detail: { url: btn.dataset.deleteUrl } }));
  });

  global.StsDelete = {
    remove,
    buttonHtml,
    DEFAULT_CONFIRM
  };
})(window);
