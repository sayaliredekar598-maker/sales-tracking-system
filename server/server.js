
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");

const { Server } = require("socket.io");

const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

// Middleware (must run before routes)
app.use(cors());
app.use(express.json());

// Database
const db = require("./config/db");
const { runMigrations } = require("./config/migrate");

// Static frontend + assets
app.use("/images", express.static(path.join(PUBLIC_DIR, "images")));
app.use("/images", express.static(path.join(ROOT_DIR, "images")));
app.use(express.static(PUBLIC_DIR));

// Health check (used to diagnose Render DB connectivity)
app.get("/api/health", async (req, res) => {
    const status = db.getStatus();
    try {
        await db.ping();
        return res.json({
            ok: true,
            service: "sales-tracking-system",
            database: { ...status, connected: true, lastError: null }
        });
    } catch (error) {
        return res.status(503).json({
            ok: false,
            service: "sales-tracking-system",
            database: {
                ...status,
                connected: false,
                lastError: {
                    code: error.code || null,
                    message: error.message
                }
            },
            hint: status.hostIsLocal
                ? "DB_HOST points to localhost. On Render, set DB_HOST to your cloud MySQL hostname (not localhost)."
                : "Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, and set DB_SSL=true if your MySQL provider requires TLS."
        });
    }
});

// API routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/company", require("./routes/companyRoutes"));
app.use("/api/distributor", require("./routes/distributorRoutes"));
app.use("/api/superstockist", require("./routes/superStockistRoutes"));
app.use("/api/daily-reports", require("./routes/dailyReportRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/stock-requests", require("./routes/stockRequestRoutes"));

// Default Route
app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Socket
require("./sockets/socketHandler")(io);

// Server
const PORT = process.env.PORT || 5000;

runMigrations()
    .catch((err) => {
        console.log("❌ Migration failed:", err.message);
    })
    .finally(() => {
        server.listen(PORT, () => {
            console.log(`✅ Server Running on Port ${PORT}`);
        });
    });
