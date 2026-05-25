const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mysql = require("mysql2");

const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

require("dotenv").config({ path: path.join(ROOT_DIR, ".env") });

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.log("DB Error:", err.message);
  } else {
    console.log("MySQL Connected");
  }
});

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.redirect("/login/loginPage.html");
});

app.use(express.static(PUBLIC_DIR));

/* ============================================================
   AUTH STORAGE (file-based JSON store, no DB dependency)
   ============================================================ */

const USERS_FILE = path.join(__dirname, "data", "users.json");
const LEGACY_USERS_FILE = path.join(ROOT_DIR, "Company", "users.json");

function ensureUsersFile() {
  if (fs.existsSync(USERS_FILE)) return;
  try {
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(LEGACY_USERS_FILE)) {
      fs.copyFileSync(LEGACY_USERS_FILE, USERS_FILE);
      console.log("Migrated users from Company/users.json to server/data/users.json");
    }
  } catch (err) {
    console.warn("Could not prepare users file:", err.message);
  }
}

function loadUsers() {
  ensureUsersFile();
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to read users.json, starting empty:", err.message);
    return [];
  }
}

function saveUsers(users) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, saltHex, hashHex) {
  const { hash } = hashPassword(password, saltHex);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(hashHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    companyName: u.companyName || null,
    empId: u.empId || null,
    createdAt: u.createdAt
  };
}

const ALLOWED_ROLES = new Set(["manager", "employee", "company"]);

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

/** Catalog of companies and their total allocated product quantity (inventory baseline). */
const COMPANY_CATALOG = [{}, {}, {}];

function normalizeCompanyId(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  const exists = COMPANY_CATALOG.some((c) => c.id === n);
  return exists ? n : 1;
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const connectedEmployees = new Map();
const recentReports = [];

/* ============================================================
   COMPANY REMAINING PRODUCTS (Add + Remaining pages, realtime)
   ============================================================ */

const COMPANIES_INVENTORY_FILE = path.join(__dirname, "data", "companies.json");
let companiesInventory = [];

function normalizeInventoryRow(row) {
  if (!row || typeof row !== "object") return null;
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const companyName = String(row.companyName || "").trim();
  if (!companyName) return null;
  return {
    id,
    dateTime: String(row.dateTime || ""),
    companyName,
    soldProducts: Number(row.soldProducts || 0),
    remainingProducts: Number(row.remainingProducts || 0),
    totalProducts: Number(row.totalProducts || 0)
  };
}

function loadCompaniesInventory() {
  try {
    if (!fs.existsSync(COMPANIES_INVENTORY_FILE)) {
      companiesInventory = [];
      return;
    }
    const raw = fs.readFileSync(COMPANIES_INVENTORY_FILE, "utf8");
    if (!raw.trim()) {
      companiesInventory = [];
      return;
    }
    const parsed = JSON.parse(raw);
    companiesInventory = Array.isArray(parsed)
      ? parsed.map(normalizeInventoryRow).filter(Boolean)
      : [];
  } catch (err) {
    console.warn("companies.json load failed:", err.message);
    companiesInventory = [];
  }
}

function saveCompaniesInventory() {
  const dir = path.dirname(COMPANIES_INVENTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    COMPANIES_INVENTORY_FILE,
    JSON.stringify(companiesInventory, null, 2),
    "utf8"
  );
}

loadCompaniesInventory();

function computeCompanyProductSnapshot() {
  const soldByCompany = new Map();
  recentReports.forEach((r) => {
    const cid = normalizeCompanyId(r.companyId);
    const qty = Number(r.quantity || 0);
    soldByCompany.set(cid, (soldByCompany.get(cid) || 0) + qty);
  });

  const rows = COMPANY_CATALOG.map((c) => {
    const soldProducts = soldByCompany.get(c.id) || 0;
    const remainingProducts = Math.max(0, c.totalProducts - soldProducts);
    return {
      id: c.id,
      companyName: c.name,
      soldProducts,
      remainingProducts,
      totalProducts: c.totalProducts
    };
  });

  const totalProductQuantity = COMPANY_CATALOG.reduce(
    (sum, c) => sum + c.totalProducts,
    0
  );
  const remainingProducts = rows.reduce(
    (sum, r) => sum + r.remainingProducts,
    0
  );

  return {
    totalProductQuantity,
    remainingProducts,
    rows
  };
}

function initialsOf(name) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function buildTodaySummary() {
  const now = new Date();
  const isSameDate = (value) => {
    const dt = new Date(value);
    return (
      dt.getFullYear() === now.getFullYear() &&
      dt.getMonth() === now.getMonth() &&
      dt.getDate() === now.getDate()
    );
  };

  let todaySales = 0;
  let todayProducts = 0;
  let todayReports = 0;
  recentReports.forEach((report) => {
    if (isSameDate(report.dateTime)) {
      todaySales += Number(report.sales || 0);
      todayProducts += Number(report.quantity || 0);
      todayReports += 1;
    }
  });

  const activeEmployees = [...connectedEmployees.values()].filter(
    (emp) => emp.isGpsOn
  ).length;

  const companyProducts = computeCompanyProductSnapshot();

  return {
    totalEmployees: connectedEmployees.size,
    activeEmployees,
    todaySales,
    todayProducts,
    todayReports,
    totalProductQuantity: companyProducts.totalProductQuantity,
    remainingProducts: companyProducts.remainingProducts,
    companyProductRows: companyProducts.rows
  };
}

function toPublicEmployee(emp) {
  return {
    id: emp.id,
    name: emp.name,
    initials: emp.initials,
    lat: emp.lat,
    lng: emp.lng,
    status: emp.status,
    isGpsOn: !!emp.isGpsOn,
    lastSeen: emp.lastSeen
  };
}

function emitAdminSnapshot(targetSocket) {
  const payload = {
    employees: [...connectedEmployees.values()].map(toPublicEmployee),
    recentReports: recentReports.slice(-20).reverse(),
    summary: buildTodaySummary()
  };
  targetSocket.emit("admin:snapshot", payload);
}

io.on("connection", (socket) => {
  console.log("User Connected:", socket.id);

  socket.on("inventory:subscribe", () => {
    socket.emit("inventory:snapshot", companiesInventory);
  });

  socket.on("inventory:add", (data) => {
    const cn = String((data && data.companyName) || "").trim();
    if (!cn) return;
    const totalProducts = Number(data.totalProducts || 0);
    if (!totalProducts || totalProducts < 0) return;
    const soldProducts = Math.max(0, Number(data.soldProducts || 0));
    let remainingProducts = Number(data.remainingProducts);
    if (!Number.isFinite(remainingProducts)) {
      remainingProducts = Math.max(0, totalProducts - soldProducts);
    }
    let id = Number(data.id);
    if (!Number.isFinite(id) || companiesInventory.some((r) => r.id === id)) {
      id = Date.now();
    }
    const row = {
      id,
      dateTime: String(data.dateTime || new Date().toLocaleString()),
      companyName: cn,
      soldProducts,
      remainingProducts,
      totalProducts
    };
    companiesInventory.push(row);
    saveCompaniesInventory();
    io.emit("inventory:snapshot", companiesInventory);
  });

  socket.on("inventory:delete", (payload) => {
    const id = Number(payload && payload.id);
    if (!Number.isFinite(id)) return;
    companiesInventory = companiesInventory.filter((c) => c.id !== id);
    saveCompaniesInventory();
    io.emit("inventory:snapshot", companiesInventory);
  });

  socket.on("inventory:bootstrap", (rows) => {
    if (companiesInventory.length > 0) return;
    if (!Array.isArray(rows) || rows.length === 0) return;
    const cleaned = rows.map(normalizeInventoryRow).filter(Boolean);
    if (!cleaned.length) return;
    companiesInventory = cleaned;
    saveCompaniesInventory();
    io.emit("inventory:snapshot", companiesInventory);
  });

  socket.on("admin:join", () => {
    emitAdminSnapshot(socket);
  });

  socket.on("employee:status", (data) => {
    const {
      id = socket.id,
      name = "Unknown Employee",
      lat,
      lng,
      status = "Active",
      isGpsOn = true
    } = data || {};

    const employee = {
      id,
      socketId: socket.id,
      name,
      initials: initialsOf(name),
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
      status,
      isGpsOn: !!isGpsOn,
      lastSeen: Date.now()
    };

    connectedEmployees.set(id, employee);

    io.emit("admin:employeeUpdate", toPublicEmployee(employee));
    io.emit("admin:summary", buildTodaySummary());
    io.emit("admin:activity", {
      type: "gps_on",
      employee: toPublicEmployee(employee),
      message: employee.isGpsOn
        ? `${name} is now active (GPS enabled)`
        : `${name} is not sharing GPS`,
      timestamp: Date.now()
    });
  });

  socket.on("employee:report", (data) => {
    const report = {
      employeeId: data?.employeeId || socket.id,
      employeeName: data?.employeeName || "Unknown Employee",
      dateTime: data?.dateTime || new Date().toISOString(),
      location: data?.location || "N/A",
      product: data?.product || "N/A",
      quantity: Number(data?.quantity || 0),
      sales: Number(data?.sales || 0),
      notes: data?.notes || "",
      status: "Submitted",
      companyId: normalizeCompanyId(data?.companyId)
    };

    recentReports.push(report);
    if (recentReports.length > 200) {
      recentReports.shift();
    }

    io.emit("admin:reportSubmitted", report);
    io.emit("admin:summary", buildTodaySummary());
    io.emit("admin:activity", {
      type: "report_submitted",
      employee: {
        id: report.employeeId,
        name: report.employeeName,
        initials: initialsOf(report.employeeName)
      },
      message: `${report.employeeName} submitted a report`,
      timestamp: Date.now()
    });
  });

  socket.on("disconnect", () => {
    for (const [empId, emp] of connectedEmployees.entries()) {
      if (emp.socketId === socket.id) {
        connectedEmployees.delete(empId);
        io.emit("admin:employeeOffline", { id: empId });
        io.emit("admin:summary", buildTodaySummary());
      }
    }
    console.log("User Disconnected:", socket.id);
  });
});

app.get("/locations", (req, res) => {
  db.query(
    "SELECT * FROM locations ORDER BY time DESC LIMIT 50",
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: "Failed to fetch locations" });
      }
      res.json(result);
    }
  );
});

app.get("/admin/summary", (req, res) => {
  res.json({
    employees: [...connectedEmployees.values()].map(toPublicEmployee),
    recentReports: recentReports.slice(-20).reverse(),
    summary: buildTodaySummary()
  });
});

app.get("/admin/company-products", (req, res) => {
  res.json(computeCompanyProductSnapshot());
});

/* ============================================================
   AUTH ROUTES
   ============================================================ */

app.post("/auth/register", (req, res) => {
  const {
    name = "",
    email = "",
    password = "",
    role = "",
    companyName = ""
  } = req.body || {};

  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanRole = String(role).trim().toLowerCase();
  const cleanCompany = String(companyName).trim();

  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: "Please enter your full name." });
  }
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: "Please enter a valid email." });
  }
  if (!password || String(password).length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }
  if (!ALLOWED_ROLES.has(cleanRole)) {
    return res.status(400).json({ error: "Please choose an account type." });
  }
  if (cleanRole === "company" && !cleanCompany) {
    return res
      .status(400)
      .json({ error: "Company accounts must provide a company name." });
  }

  const users = loadUsers();
  if (users.some((u) => u.email === cleanEmail)) {
    return res
      .status(409)
      .json({ error: "An account with this email already exists." });
  }

  const { salt, hash } = hashPassword(password);
  const newUser = {
    id: crypto.randomUUID(),
    name: cleanName,
    email: cleanEmail,
    passwordSalt: salt,
    passwordHash: hash,
    role: cleanRole,
    companyName: cleanRole === "company" ? cleanCompany : cleanCompany || null,
    empId:
      cleanRole === "employee"
        ? cleanEmail.split("@")[0].replace(/[^a-z0-9]/g, "-")
        : null,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  try {
    saveUsers(users);
  } catch (err) {
    console.error("Failed to save user:", err);
    return res.status(500).json({ error: "Could not save account." });
  }

  res.status(201).json({ user: publicUser(newUser) });
});

app.post("/auth/login", (req, res) => {
  const { email = "", password = "" } = req.body || {};
  const cleanEmail = String(email).trim().toLowerCase();

  if (!isValidEmail(cleanEmail) || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const users = loadUsers();
  const user = users.find((u) => u.email === cleanEmail);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  res.json({ user: publicUser(user) });
});

app.get("/auth/me", (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email." });
  }
  const users = loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(404).json({ error: "Not found." });
  res.json({ user: publicUser(user) });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
`Render Backend Running:
https://sales-tracking-system-n9am.onrender.com`
);
});
