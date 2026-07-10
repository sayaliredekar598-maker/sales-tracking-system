function normalizeRole(role) {
    const value = String(role || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

    if (value === "superstockist") return "superstockist";
    if (value === "distributor") return "distributor";
    if (value === "employee" || value === "salesexecutive") return "employee";
    if (value === "company") return "company";
    if (value === "manager") return "manager";

    return String(role || "").trim().toLowerCase();
}

module.exports = {
    normalizeRole
};
