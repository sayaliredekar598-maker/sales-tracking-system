
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
require("./config/db");
const { runMigrations } = require("./config/migrate");

// Static frontend + assets
app.use("/images", express.static(path.join(PUBLIC_DIR, "images")));
app.use("/images", express.static(path.join(ROOT_DIR, "images")));
app.use(express.static(PUBLIC_DIR));

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
