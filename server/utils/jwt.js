const jwt = require("jsonwebtoken");

require("dotenv").config({
    path: require("path").join(__dirname, "../../.env")
});

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

function signToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            role: user.role,
            empId: user.empId || null,
            companyName: user.companyName || null
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

module.exports = {
    signToken,
    verifyToken,
    JWT_SECRET
};
