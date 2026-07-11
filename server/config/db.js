const mysql = require("mysql2");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "../../.env")
});

const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;
const DB_PORT = Number(process.env.DB_PORT || 3306);
const useSsl =
    String(process.env.DB_SSL || "").toLowerCase() === "true" ||
    String(process.env.DB_SSL || "") === "1";

function isLocalHost(host) {
    const value = String(host || "").trim().toLowerCase();
    return !value || value === "localhost" || value === "127.0.0.1";
}

const missing = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter(
    (key) => !process.env[key]
);

if (missing.length) {
    console.log(`❌ Missing required DB env vars: ${missing.join(", ")}`);
}

if (process.env.NODE_ENV === "production" && isLocalHost(DB_HOST)) {
    console.log(
        "❌ DB_HOST is localhost/127.0.0.1 in production. " +
            "Render cannot reach your local MySQL. Set DB_HOST to your cloud MySQL hostname."
    );
}

const dbConfig = {
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 15000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

if (useSsl) {
    // Most managed MySQL providers (Aiven, Railway, PlanetScale, RDS, etc.) require TLS.
    dbConfig.ssl = {
        rejectUnauthorized:
            String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "").toLowerCase() === "true"
    };
}

let connection = null;
let lastError = null;
let connecting = false;

function attachConnectionHandlers(conn) {
    conn.on("error", (err) => {
        lastError = err;
        console.log("❌ MySQL connection error:", err.code || err.message);
        if (
            err.code === "PROTOCOL_CONNECTION_LOST" ||
            err.code === "ECONNRESET" ||
            err.code === "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR"
        ) {
            scheduleReconnect();
        }
    });
}

function scheduleReconnect() {
    if (connecting) return;
    setTimeout(connectDb, 2000);
}

function connectDb() {
    if (connecting) return;
    connecting = true;

    try {
        if (connection) {
            try {
                connection.removeAllListeners("error");
                connection.destroy();
            } catch (_err) {
                // ignore cleanup errors
            }
        }

        connection = mysql.createConnection(dbConfig);
        attachConnectionHandlers(connection);

        connection.connect((err) => {
            connecting = false;
            if (err) {
                lastError = err;
                console.log("❌ MySQL Connection Failed");
                console.log(err.code || "", err.message);
                scheduleReconnect();
                return;
            }

            lastError = null;
            console.log(
                `✅ MySQL Connected Successfully (${DB_HOST}:${DB_PORT}${useSsl ? ", SSL" : ""})`
            );
        });
    } catch (err) {
        connecting = false;
        lastError = err;
        console.log("❌ MySQL Connection Failed");
        console.log(err.message);
        scheduleReconnect();
    }
}

function getConnection() {
    if (!connection) {
        connectDb();
    }
    return connection;
}

async function ping() {
    const conn = getConnection();
    if (!conn) {
        const err = lastError || new Error("MySQL is not connected");
        err.code = err.code || "DB_NOT_CONNECTED";
        throw err;
    }

    const [rows] = await conn.promise().query("SELECT 1 AS ok");
    return rows[0];
}

function getStatus() {
    return {
        configured: missing.length === 0,
        missingEnv: missing,
        hostIsLocal: isLocalHost(DB_HOST),
        host: DB_HOST ? `${String(DB_HOST).slice(0, 3)}…` : null,
        port: DB_PORT,
        database: DB_NAME || null,
        ssl: useSsl,
        connected: Boolean(connection && connection.state !== "disconnected"),
        lastError: lastError
            ? {
                  code: lastError.code || null,
                  message: lastError.message
              }
            : null
    };
}

const helpers = { ping, getStatus };

// Keep require("../config/db") compatible: .query / .promise() always use the live connection.
const db = new Proxy(helpers, {
    get(target, prop) {
        if (prop in target) {
            return target[prop];
        }

        const conn = getConnection();
        if (!conn) {
            if (prop === "promise") {
                return () => ({
                    query: () =>
                        Promise.reject(
                            lastError || new Error("MySQL is not connected")
                        ),
                    beginTransaction: () =>
                        Promise.reject(
                            lastError || new Error("MySQL is not connected")
                        ),
                    commit: () =>
                        Promise.reject(
                            lastError || new Error("MySQL is not connected")
                        ),
                    rollback: () => Promise.resolve()
                });
            }
            return undefined;
        }

        const value = conn[prop];
        if (typeof value === "function") {
            return value.bind(conn);
        }
        return value;
    }
});

connectDb();

module.exports = db;
