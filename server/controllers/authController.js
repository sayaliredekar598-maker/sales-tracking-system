const db = require("../config/db");
const bcrypt = require("bcrypt");

function sendError(res, status, message, extra = {}) {
    return res.status(status).json({ message, error: message, ...extra });
}

function isDatabaseError(error) {
    const code = String(error?.code || "");
    return (
        code.startsWith("ER_") ||
        code.startsWith("PROTOCOL_") ||
        [
            "ECONNREFUSED",
            "ECONNRESET",
            "ETIMEDOUT",
            "ENOTFOUND",
            "EAI_AGAIN",
            "DB_NOT_CONNECTED",
            "ER_ACCESS_DENIED_ERROR",
            "ER_BAD_DB_ERROR"
        ].includes(code) ||
        /MySQL is not connected/i.test(String(error?.message || ""))
    );
}

function sendDatabaseError(res, error) {
    console.log(error);
    return sendError(res, 500, "Database unavailable", {
        code: error.code || null,
        detail:
            "The API could not query MySQL. On Render, set DB_HOST to a reachable cloud MySQL host (not localhost) and use DB_SSL=true if required."
    });
}

function normalizeRole(role) {
    const value = String(role || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

    if (value === "superstockist") return "superstockist";
    if (value === "distributor") return "distributor";
    if (value === "employee" || value === "salesexecutive") return "employee";
    if (value === "company") return "company";
    if (value === "manager") return "manager";

    return String(role || "").trim().toLowerCase();
}

function toPublicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: normalizeRole(user.role),
        companyName: user.company_name || null,
        empId: user.empId || null
    };
}

// ================= REGISTER =================
exports.register = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            role,
            companyName,
            company_name,
            empId
        } = req.body;

        const resolvedCompanyName = company_name || companyName || null;

        if (!name || !email || !password || !role) {
            return sendError(res, 400, "All required fields missing");
        }

        const [existingUser] = await db.promise().query(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (existingUser.length > 0) {
            return sendError(res, 400, "User already exists");
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        let resolvedEmpId = empId || null;
        if (role === "employee" && !resolvedEmpId) {
            resolvedEmpId = name.trim().toLowerCase().replace(/\s+/g, "");
        }

        const [result] = await db.promise().query(
            `INSERT INTO users (name, email, password, role, company_name, empId)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                name,
                email,
                hashedPassword,
                normalizeRole(role),
                resolvedCompanyName,
                resolvedEmpId
            ]
        );

        const [newUsers] = await db.promise().query(
            "SELECT * FROM users WHERE id = ?",
            [result.insertId]
        );

        return res.status(201).json({
            message: "User registered successfully",
            user: toPublicUser(newUsers[0])
        });
    } catch (error) {
        if (isDatabaseError(error)) {
            return sendDatabaseError(res, error);
        }
        console.log(error);
        return sendError(res, 500, "Server error");
    }
};

// ================= LOGIN =================
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return sendError(res, 400, "Email and password required");
        }

        const [users] = await db.promise().query(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (users.length === 0) {
            return sendError(res, 404, "User not found");
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return sendError(res, 401, "Invalid credentials");
        }

        return res.json({
            message: "Login successful",
            user: toPublicUser(user)
        });
    } catch (error) {
        if (isDatabaseError(error)) {
            return sendDatabaseError(res, error);
        }
        console.log(error);
        return sendError(res, 500, "Server error");
    }
};

exports.getProfile = async (req, res) => {
    try {
        const userId = req.params.id;
        const [users] = await db.promise().query(
            "SELECT id, name, email, role, company_name, empId FROM users WHERE id = ?",
            [userId]
        );

        if (!users.length) {
            return sendError(res, 404, "User not found");
        }

        return res.json({ user: toPublicUser(users[0]) });
    } catch (error) {
        if (isDatabaseError(error)) {
            return sendDatabaseError(res, error);
        }
        console.log(error);
        return sendError(res, 500, "Server error");
    }
};
