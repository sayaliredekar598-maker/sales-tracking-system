const mysql = require("mysql2");
const path = require("path");

// Load local .env for development only. On Render, use Dashboard env vars
// (dotenv does not override variables that are already set).
require("dotenv").config({
    path: path.join(__dirname, "../../.env")
});

const dbHost = process.env.DB_HOST;
const dbPort = Number(process.env.DB_PORT) || 3306;

if (!dbHost || !process.env.DB_USER || !process.env.DB_NAME) {
    console.log("❌ Missing required DB env vars: DB_HOST, DB_USER, DB_NAME");
}

if (process.env.NODE_ENV === "production" && (!dbHost || dbHost === "localhost" || dbHost === "127.0.0.1")) {
    console.log("❌ DB_HOST is localhost/missing. Set cloud MySQL credentials in Render Environment.");
}

const dbConfig = {
    host: dbHost,
    port: dbPort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

// Many managed MySQL providers (Aiven, Railway, etc.) require SSL
if (process.env.DB_SSL === "true" || process.env.DB_SSL === "1") {
    dbConfig.ssl = { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" };
}

const db = mysql.createConnection(dbConfig);

db.connect((err) => {
    if (err) {
        console.log("❌ MySQL Connection Failed");
        console.log(err.message);
    } else {
        console.log(`✅ MySQL Connected Successfully (${dbHost}:${dbPort})`);
    }
});

module.exports = db;
