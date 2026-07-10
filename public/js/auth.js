(function (global) {
  function normalizeRole(role) {
    const value = String(role || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

    if (value === "superstockist") return "superstockist";
    if (value === "distributor") return "distributor";
    if (value === "employee" || value === "salesexecutive") return "employee";
    if (value === "company") return "company";
    if (value === "manager") return "manager";

    return String(role || "").trim().toLowerCase();
  }

  function readSessionUser() {
    try {
      return JSON.parse(sessionStorage.getItem("stsUser") || "{}");
    } catch (_err) {
      return {};
    }
  }

  function saveSessionUser(user) {
    sessionStorage.setItem("stsUser", JSON.stringify(user));
  }

  function requireRole(allowedRole) {
    const user = readSessionUser();
    const role = normalizeRole(user.role);

    if (!user.email || role !== allowedRole) {
      try {
        sessionStorage.removeItem("stsUser");
        sessionStorage.removeItem("employeeId");
        sessionStorage.removeItem("employeeName");
      } catch (_err) {
        /* ignore */
      }
      window.location.replace("../login/loginPage.html?relogin=1");
      return null;
    }

    if (user.role !== role) {
      user.role = role;
      saveSessionUser(user);
    }

    return user;
  }

  global.StsAuth = {
    normalizeRole,
    readSessionUser,
    saveSessionUser,
    requireRole
  };
})(window);
