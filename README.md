# Sales Tracking System

A full-stack sales and field-operations dashboard for tracking employee sales reports, live GPS locations, and company product inventory. The app uses a Node.js backend with real-time updates over Socket.IO and static HTML dashboards for managers, employees, and company accounts.

## Features

### Manager dashboard
- Live overview of connected employees, today’s sales, products sold, and report counts
- Interactive map (Leaflet) showing employee GPS positions when sharing is enabled
- Real-time activity feed and recent report stream via Socket.IO
- Charts and summary cards for daily performance

### Employee portal
- Personal dashboard with sales totals and submitted reports
- Daily report form (location, product, quantity, sales, notes)
- Browser geolocation shared with managers while the dashboard is open
- Report history stored per employee in the browser

### Company / inventory
- Add and track remaining product quantities by company
- Inventory synced in real time across clients (`inventory:*` events)
- Product reports and remaining-stock views

### Authentication
- Sign up and sign in with email and password
- Three roles: **manager**, **employee**, and **company**
- Passwords hashed with scrypt; user records stored in `server/data/users.json`
- Per-tab sessions via `sessionStorage` (multiple users can be logged in in different tabs)

## Tech stack

| Layer | Technology |
|--------|------------|
| Runtime | Node.js |
| Server | Express 5, HTTP + Socket.IO 4 |
| Database | MySQL (`mysql2`) — optional, used for location history |
| Auth storage | JSON file (`server/data/users.json`) |
| Inventory storage | JSON file (`server/data/companies.json`) |
| Frontend | Static HTML, CSS, vanilla JavaScript |
| Maps / charts | Leaflet, Chart.js (CDN) |

## Project structure

```
Sales Tracking System/
├── public/                    # Static UI (served by Express)
│   ├── index.html             # Redirects to login
│   ├── login/
│   │   └── loginPage.html     # Sign in / sign up
│   ├── employees/
│   │   ├── EmployeesDashboard.html
│   │   ├── DailyReport.html
│   │   └── reports.html
│   └── company/
│       ├── CompanyDashboard.html    # Manager home
│       ├── OurCompany.html          # Business portal
│       ├── AddRemainingProducts.html
│       ├── RemainingProducts.html
│       ├── CompanyProductReport.html
│       └── OurCompanyCardPage.html
├── server/
│   ├── server.js              # API, auth, Socket.IO, static files
│   └── data/
│       ├── users.json         # Registered users (created on first signup)
│       └── companies.json     # Company inventory records
├── package.json
└── .env                       # Environment variables (not committed)
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (LTS recommended)
- npm (included with Node.js)
- MySQL 8+ (optional — only required if you use the `/locations` endpoint)

## Installation

1. **Clone or download** the repository and open a terminal in the project folder.

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Create a `.env` file** in the project root:

   ```env
   PORT=5000
   DB_HOST=localhost
   DB_USER=your_mysql_user
   DB_PASSWORD=your_mysql_password
   DB_NAME=sales_tracking
   ```

4. **(Optional) MySQL setup** for location history:

   Create a database and a `locations` table. The server expects columns compatible with:

   ```sql
   CREATE DATABASE IF NOT EXISTS sales_tracking;
   USE sales_tracking;

   CREATE TABLE IF NOT EXISTS locations (
     id INT AUTO_INCREMENT PRIMARY KEY,
     latitude DOUBLE,
     longitude DOUBLE,
     time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```

   Adjust column names if your schema differs. The app runs without MySQL for auth, reports, and inventory; only `GET /locations` needs the database.

## Running the app

```bash
npm start
```

The server starts on `http://localhost:5000` (or the port in `PORT`). Open that URL in your browser — you will be redirected to the login page.

For development, the same command is used (`npm run dev` is an alias).

## User roles

After login, users are sent to a role-specific home page:

| Role | Default page | Access |
|------|----------------|--------|
| **manager** | `public/company/CompanyDashboard.html` | Full admin dashboard, live map, reports |
| **employee** | `public/employees/EmployeesDashboard.html` | Reports, GPS sharing, personal stats |
| **company** | `public/company/AddRemainingProducts.html` | Inventory add / remaining products |

Create accounts from the **Sign up** tab on the login page and choose the account type.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Redirects to login |
| `POST` | `/auth/register` | Register (`name`, `email`, `password`, `role`, optional `companyName`) |
| `POST` | `/auth/login` | Login (`email`, `password`) → `{ user }` |
| `GET` | `/auth/me?email=` | Look up user by email |
| `GET` | `/admin/summary` | Employees, recent reports, today’s summary |
| `GET` | `/admin/company-products` | Company product snapshot |
| `GET` | `/locations` | Last 50 rows from MySQL `locations` table |

Static files are served from `public/` (e.g. `/login/loginPage.html`).

## Socket.IO events

### Inventory (company pages)

| Event | Direction | Description |
|-------|-----------|-------------|
| `inventory:subscribe` | Client → Server | Request current inventory |
| `inventory:snapshot` | Server → Client(s) | Full inventory array |
| `inventory:add` | Client → Server | Add inventory row |
| `inventory:delete` | Client → Server | Delete by `id` |
| `inventory:bootstrap` | Client → Server | Seed data if file is empty |

### Admin / manager dashboard

| Event | Direction | Description |
|-------|-----------|-------------|
| `admin:join` | Client → Server | Subscribe; receive `admin:snapshot` |
| `admin:snapshot` | Server → Client | Employees, reports, summary |
| `admin:employeeUpdate` | Server → All | Employee GPS/status update |
| `admin:employeeOffline` | Server → All | Employee disconnected |
| `admin:summary` | Server → All | Updated daily totals |
| `admin:reportSubmitted` | Server → All | New sales report |
| `admin:activity` | Server → All | Activity feed item |

### Employee clients

| Event | Direction | Description |
|-------|-----------|-------------|
| `employee:status` | Client → Server | GPS and status (`id`, `name`, `lat`, `lng`, `isGpsOn`, …) |
| `employee:report` | Client → Server | Submit sales report payload |

## Data persistence

| Data | Storage | Notes |
|------|---------|--------|
| Users | `server/data/users.json` | Migrated automatically from legacy `Company/users.json` if present |
| Company inventory | `server/data/companies.json` | Updated on add/delete via Socket.IO |
| Employee reports | Browser `localStorage` | Key: `stsEmployeeReports:<employeeId>` |
| Live employees & reports | Server memory | Cleared on restart; last 200 reports kept |
| Location history | MySQL `locations` | Optional; via REST only |

## Configuration note

The login page and several dashboards connect to the API and Socket.IO at **`http://localhost:5000`**. If you change `PORT` or deploy to another host, update `API_BASE` in `public/login/loginPage.html` and the `io(...)` URLs in the employee and company pages to match your server URL.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server |
| `npm run dev` | Same as `npm start` |

## License

Private project (`"private": true` in `package.json`). Add a license file if you plan to distribute or open-source the code.
