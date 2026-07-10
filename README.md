# Sales Tracking System

A full-stack **field sales and supply chain tracking** application for spice/masala distribution. Sales executives log retailer visits, place orders, and stream live GPS. Distributors fulfill orders and request stock from Super Stockists. Super Stockists manage warehouse inventory and request replenishment from the company. Managers monitor operations in real time from a central dashboard.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Supply Chain Workflow](#supply-chain-workflow)
- [User Roles](#user-roles)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Running the Application](#running-the-application)
- [Access & Login](#access--login)
- [Frontend Pages](#frontend-pages)
- [REST API Reference](#rest-api-reference)
- [Real-Time Events (Socket.IO)](#real-time-events-socketio)
- [Security Notes](#security-notes)
- [Development Notes](#development-notes)

---

## Overview

The system connects four operational layers:

| Layer | Role | Primary responsibility |
|-------|------|------------------------|
| Field | **Employee** (Sales Executive) | Visits, daily reports, orders, GPS tracking |
| Fulfillment | **Distributor** | Accept/deliver orders, manage local stock |
| Warehouse | **Super Stockist** | Central stock, dispatch to distributors |
| Management | **Manager** / **Company** | Oversight, approvals, company inventory |

The backend is an **Express 5** API with **Socket.IO** for live updates. The frontend is **static HTML/CSS/JavaScript** (no build step) served from the `public/` folder.

---

## Key Features

### All roles
- Role-based login and registration (where allowed)
- Session stored in browser `sessionStorage` (`stsUser`)

### Employee
- Live GPS tracking to manager dashboard
- Daily visit reports with multi-product orders
- Standalone order creation
- Order history and report management
- Real-time order status updates

### Distributor
- Assigned order queue (accept / reject / deliver)
- Per-product inventory (received, dispatched, remaining)
- Stock requests to Super Stockist
- Real-time inventory and order notifications

### Super Stockist
- Warehouse inventory management and manual restock
- Approve/dispatch distributor stock requests
- Request replenishment from company
- Real-time inventory flow log
- Order pipeline visibility

### Manager (Company Dashboard)
- Live employee map and activity feed
- KPI cards with day-over-day sales trends
- Configurable daily sales target
- Supply chain health snapshot
- Order lifecycle tracker
- Distributor performance scorecard
- Notification center
- Approve/reject Super Stockist stock requests
- Real-time inventory flow table with **Excel export**
- Employee roster and reports browser pages

### Company (partner account)
- Add and manage company source inventory (`AddRemainingProducts.html`)

---

## Supply Chain Workflow

```
Company Inventory
       │
       │  SS requests stock → Manager approves
       ▼
Super Stockist (stock_inventory)
       │
       │  Distributor requests → SS dispatches
       ▼
Distributor (distributor_inventory)
       │
       │  Employee order → Distributor marks Delivered
       ▼
Sales Executive / Retailer
```

**Inventory flow event types** (logged in `inventory_flow_log`):

| Event | Description |
|-------|-------------|
| `company_to_superstockist` | Company stock transferred to SS on request approval |
| `superstockist_to_distributor` | SS stock dispatched to distributor |
| `distributor_to_employee` | Distributor stock deducted on delivery |

**Order lifecycle:** `Pending` → `Accepted` → `Processing` → `Delivered` (or `Rejected`)

---

## User Roles

| Role | Registration | Login redirect |
|------|--------------|----------------|
| `employee` | Yes (Sign up) | `/employees/EmployeesDashboard.html` |
| `distributor` | Yes | `/Distributer/DistributerDashboard.html` |
| `superstockist` | Yes | `/superstockist/superstockistDashboard.html` |
| `manager` | No (create in DB) | `/company/CompanyDashboard.html` |
| `company` | No (create in DB) | `/company/AddRemainingProducts.html` |

> **Manager** and **company** accounts are typically created directly in the database. Field roles self-register from the login page.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js |
| Server | Express 5 |
| Real-time | Socket.IO 4 |
| Database | MySQL (mysql2) |
| Auth | bcrypt password hashing; JWT utilities available (`server/utils/jwt.js`) |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Charts | Chart.js (Manager dashboard) |
| Maps | Leaflet (live employee tracking) |
| Excel export | SheetJS (xlsx) — inventory flow download |

---

## Project Structure

```
Sales Tracking System/
├── public/                    # Static frontend
│   ├── login/                 # Login & registration
│   ├── employees/             # Sales executive dashboards & forms
│   ├── Distributer/           # Distributor dashboards
│   ├── superstockist/         # Super Stockist dashboards
│   ├── company/               # Manager & company partner pages
│   ├── js/
│   │   └── auth.js            # Shared role guard (StsAuth)
│   └── index.html             # Redirects to login
├── server/
│   ├── server.js              # Express + Socket.IO entry point
│   ├── config/
│   │   ├── db.js              # MySQL connection
│   │   └── migrate.js         # Auto-migrations on startup
│   ├── controllers/           # Business logic
│   ├── routes/                # API route definitions
│   ├── sockets/
│   │   └── socketHandler.js   # Socket.IO event handlers
│   └── utils/
│       ├── realtime.js        # Broadcast helpers & live employee map
│       └── jwt.js             # JWT sign/verify helpers
├── package.json
├── .env                       # Environment config (not committed)
└── README.md
```

---

## Prerequisites

- **Node.js** 18+ recommended
- **MySQL** 8.x
- An existing MySQL database with base tables (`users`, `daily_reports`, etc.)

The migration script creates and updates operational tables (`sales_orders`, `stock_inventory`, `inventory_flow_log`, etc.) but assumes core tables like `users` and `daily_reports` already exist in your database.

---

## Installation

```bash
# Clone or copy the project
cd "Sales Tracking System"

# Install dependencies
npm install

# Create environment file (see below)
# Configure .env with your MySQL credentials

# Start the server (runs migrations automatically)
npm start
```

The server starts on **http://localhost:5000** by default.

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Server
PORT=5000

# MySQL
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=sales_tracking

# JWT (optional — used by jwt.js utilities)
JWT_SECRET=your-long-random-secret
JWT_EXPIRES_IN=8h
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_HOST` | Yes | MySQL host |
| `DB_USER` | Yes | MySQL username |
| `DB_PASSWORD` | Yes | MySQL password |
| `DB_NAME` | Yes | Database name |
| `PORT` | No | HTTP port (default `5000`) |
| `JWT_SECRET` | No | JWT signing secret |
| `JWT_EXPIRES_IN` | No | Token expiry (default `8h`) |

---

## Database

### Auto-migrations

On startup, `server/config/migrate.js` automatically:

- Adds/alters columns on `daily_reports` and `sales_orders`
- Creates tables if missing: `sales_orders`, `company_inventory`, `stock_inventory`, `stock_replenishment_requests`, `distributor_inventory`, `distributor_stock_requests`, `inventory_flow_log`, `daily_report_products`, `notifications`, `company_settings`
- Seeds 15 default products into `stock_inventory` (100 units each)

### Key tables

| Table | Purpose |
|-------|---------|
| `users` | All accounts (role, email, password, empId) |
| `daily_reports` | Field visit logs |
| `daily_report_products` | Multi-product lines per report |
| `sales_orders` | Orders to distributors |
| `company_inventory` | Company source stock |
| `stock_inventory` | Super Stockist warehouse |
| `stock_replenishment_requests` | SS → Company requests |
| `distributor_inventory` | Per-distributor stock levels |
| `distributor_stock_requests` | Distributor → SS requests |
| `inventory_flow_log` | Audit trail across the chain |
| `notifications` | System notification messages |
| `company_settings` | Manager config (e.g. daily sales target) |
| `locations` | GPS coordinate history |

### Creating a manager account

Insert directly into MySQL (password must be bcrypt-hashed):

```sql
-- Example: use bcrypt hash for password 'manager123' generated via Node/bcrypt
INSERT INTO users (name, email, password, role)
VALUES ('Admin Manager', 'manager@company.com', '$2b$10$...', 'manager');
```

Or register an employee/distributor/superstockist via the UI and update the role in the database if needed.

---

## Running the Application

```bash
npm start
# or
npm run dev
```

Open **http://localhost:5000** — you will be redirected to the login page.

### Health check

Confirm the server is running:

- Console: `✅ Server Running on Port 5000`
- Console: `✅ MySQL Connected Successfully`
- Console: `✅ Database migrations applied`

---

## Access & Login

| URL | Page |
|-----|------|
| http://localhost:5000 | Login (redirect) |
| http://localhost:5000/login/loginPage.html | Login & sign up |

After login, users are redirected based on role (see [User Roles](#user-roles)).

**Session storage keys:**
- `stsUser` — logged-in user object (`id`, `name`, `email`, `role`, `empId`)
- `employeeId` / `employeeName` — optional employee context

---

## Frontend Pages

### Login
| File | Description |
|------|-------------|
| `public/login/loginPage.html` | Sign in / sign up |

### Employee
| File | Description |
|------|-------------|
| `EmployeesDashboard.html` | KPIs, GPS, recent orders |
| `DailyReport.html` | Visit report + optional distributor order |
| `CreateOrder.html` | Standalone order form |
| `reports.html` | Report & order history |

### Distributor
| File | Description |
|------|-------------|
| `DistributerDashboard.html` | Orders, inventory, stock requests |
| `CompletedDeliveries.html` | Delivered orders list |

### Super Stockist
| File | Description |
|------|-------------|
| `superstockistDashboard.html` | Inventory, requests, flow log |
| `DistributorList.html` | Registered distributors |

### Manager / Company
| File | Description |
|------|-------------|
| `CompanyDashboard.html` | Full manager command center |
| `ManagerEmployees.html` | Employee roster & live GPS status |
| `ManagerReports.html` | Searchable daily reports |
| `OurCompany.html` | Business portal hub |
| `OurCompanyCardPage.html` | Partner product catalog |
| `AddRemainingProducts.html` | Company inventory entry |
| `RemainingProducts.html` | View company inventory |
| `CompanyProductReport.html` | Per-product order report |

---

## REST API Reference

Base URL: `http://localhost:5000/api`

### Authentication — `/api/auth`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Register user (employee, distributor, superstockist) |
| POST | `/login` | Login — returns `{ user }` |
| GET | `/profile/:id` | Get user profile |

### Daily Reports — `/api/daily-reports`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/add` | Submit daily report (optional linked orders) |
| PUT | `/:id` | Update report |
| GET | `/employee/:employeeId` | Employee reports (optional `?search=`) |
| DELETE | `/:id` | Delete report (`?employeeId=`) |
| GET | `/recent/all` | Recent reports (manager) |

### Orders — `/api/orders`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/add` | Create standalone order |
| GET | `/employee/:employeeId` | Employee orders |
| GET | `/dashboard/:employeeId` | Employee dashboard KPIs |
| GET | `/all` | All orders (optional `?status=`) |
| GET | `/product/:productName` | Orders by product |
| PATCH | `/:id/status` | Update order status |
| DELETE | `/:id` | Delete pending order (`?employeeId=`) |

### Company / Manager — `/api/company`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analytics` | Aggregated analytics & trends |
| GET | `/settings` | Company settings (daily target) |
| PUT | `/settings` | Update settings |
| GET | `/notifications` | Notification inbox |
| GET | `/employees` | Employee roster |
| GET | `/distributor-scorecard` | Distributor performance |
| GET | `/supply-chain-health` | Supply chain snapshot |
| GET | `/inventory/flow` | Inventory flow log (`?limit=30`) |
| GET/POST/PUT/DELETE | `/products`, `/add-product`, etc. | Product catalog CRUD |

### Stock Requests (SS → Company) — `/api/stock-requests`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Super Stockist creates request |
| GET | `/pending` | Pending requests (manager) |
| GET | `/` | All requests |
| PATCH | `/:id/approve` | Manager approves (transfers stock) |
| PATCH | `/:id/reject` | Manager rejects |

### Distributor — `/api/distributor`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Dashboard summary |
| GET | `/orders` | Orders (`?distributor=&status=`) |
| PATCH | `/orders/:id/accept` | Accept order |
| PATCH | `/orders/:id/reject` | Reject order |
| PATCH | `/orders/:id/status` | Update delivery status |
| GET | `/inventory` | Distributor inventory |
| GET | `/inventory/dashboard` | Inventory snapshot |
| POST | `/stock-requests` | Request stock from SS |
| GET | `/stock-requests` | Request history |
| POST | `/notify-low-stock` | Low stock alert to SS |

### Super Stockist — `/api/superstockist`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | SS dashboard metrics |
| GET | `/inventory` | Warehouse stock |
| GET | `/inventory/low-stock` | Low stock products |
| PUT | `/inventory/stock` | Set product quantity |
| POST | `/inventory/restock` | Add stock manually |
| GET | `/distributors` | Distributor list |
| GET/POST/DELETE | `/company-inventory` | Company inventory CRUD |
| GET | `/distributor-requests/pending` | Pending distributor requests |
| PATCH | `/distributor-requests/:id/approve` | Dispatch to distributor |
| PATCH | `/distributor-requests/:id/reject` | Reject request |
| GET | `/inventory/flow` | Inventory flow log |
| GET | `/inventory/distributor-overview` | Distributor stock overview |

---

## Real-Time Events (Socket.IO)

Connect to `http://localhost:5000` (same origin as the app).

### Client → Server

| Event | Description |
|-------|-------------|
| `admin:join` | Manager joins — receives `admin:snapshot` |
| `employeeLocation` | Employee GPS update `{ employeeId, employeeName, latitude, longitude }` |
| `inventory:subscribe` | Company inventory snapshot |
| `distributor:inventory:subscribe` | Distributor-scoped inventory updates |

### Server → Client (broadcast)

| Event | When |
|-------|------|
| `admin:snapshot` | Manager initial load (employees, reports, summary) |
| `admin:summary` | KPI refresh after reports/orders |
| `admin:employeeUpdate` | Employee GPS update |
| `admin:reportSubmitted` | New daily report |
| `admin:activity` | Activity feed item |
| `order:submitted` | New sales order |
| `order:statusChanged` | Order status updated |
| `stock:requestCreated` | SS stock request to company |
| `stock:requestUpdated` | Stock request approved/rejected |
| `distributorStock:requestCreated` | Distributor stock request |
| `distributorStock:dispatched` | Stock dispatched to distributor |
| `distributorStock:updated` | Distributor inventory changed |
| `inventory:flowUpdated` | Inventory flow log changed |
| `notification:manager` | Manager notification |
| `notification:distributor` | Distributor notification |
| `notification:superstockist` | Super Stockist notification |

---

## Security Notes

- Passwords are hashed with **bcrypt** (10 salt rounds).
- Frontend role guards (`StsAuth.requireRole`) protect page access client-side.
- **API routes do not currently enforce JWT middleware** — protect sensitive endpoints before production deployment.
- JWT utilities exist in `server/utils/jwt.js` for future or custom integration.
- Change `JWT_SECRET` and use strong database credentials in production.
- CORS is open (`*`) — restrict for production.
- Do not commit `.env` to version control.

---

## Development Notes

### API base URL

Frontend pages use hardcoded `http://localhost:5000/api` and Socket.IO at `http://localhost:5000`. Update these if deploying to a different host.

### Product catalog

15 spice/masala products are seeded in `stock_inventory` and hardcoded in employee order forms. Product names should match across forms, inventory, and orders.

### Folder naming

The distributor folder is spelled `Distributer` (historical) — use this path in links and imports.

### Excel export

On the Manager dashboard, the **Real-Time Inventory Flow** table includes a **Download Excel** button powered by SheetJS. It exports the currently loaded in-memory data (kept in sync via Socket.IO).

### Adding new features

1. Add controller logic in `server/controllers/`
2. Register routes in `server/routes/`
3. Mount route in `server/server.js` if new
4. Emit Socket.IO events via `server/utils/realtime.js` for live UI updates
5. Add/adjust migrations in `server/config/migrate.js` for schema changes

---

## License

Private project — all rights reserved.

---

## Support

For issues or enhancements, review the codebase starting from `server/server.js` and the role-specific pages under `public/`.
