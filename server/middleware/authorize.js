const db = require("../config/db");
const { normalizeRole } = require("../utils/roles");

function parseActor(req) {
    let actor = req.body?.requested_by;
    if (!actor && req.query.requested_by) {
        try {
            actor = JSON.parse(req.query.requested_by);
        } catch (_err) {
            actor = null;
        }
    }
    return actor;
}

function requireRoles(...allowedRoles) {
    const allowed = new Set(allowedRoles.map(normalizeRole));

    return async (req, res, next) => {
        try {
            const actor = parseActor(req);
            if (!actor?.id || !actor?.email || !actor?.role) {
                return res.status(401).json({
                    success: false,
                    message: "Login required to delete records."
                });
            }

            const [users] = await db.promise().query(
                "SELECT id, email, role, name, empId, company_name FROM users WHERE id = ? AND email = ?",
                [actor.id, actor.email]
            );

            if (!users.length) {
                return res.status(401).json({ success: false, message: "Invalid session." });
            }

            const role = normalizeRole(users[0].role);
            if (!allowed.has(role)) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to delete this record."
                });
            }

            req.actor = {
                id: users[0].id,
                email: users[0].email,
                role,
                name: users[0].name,
                empId: users[0].empId,
                companyName: users[0].company_name
            };
            next();
        } catch (error) {
            console.log(error);
            return res.status(500).json({ success: false, message: "Authorization failed" });
        }
    };
}

module.exports = {
    requireRoles,
    parseActor
};
