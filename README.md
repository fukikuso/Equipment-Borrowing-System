# CSPC Equipment Borrowing System

A full-stack web app for Camarines Sur Polytechnic Colleges to request, track,
and manage campus equipment borrowing — built with **Node.js/Express**,
**EJS**, and **MySQL** (designed to run on **XAMPP**).

---

## 1. What's included

- Student/Instructor/Staff side: login, dashboard, equipment catalog with
  filters, equipment details, a 4-step request wizard, request status
  tracker, "My Borrowings" (active/pending/approved/returned/overdue tabs),
  QR-code borrowing & camera-based QR scanner, notifications, borrowing
  history, profile. New student, instructor, and staff accounts are active
  immediately after registration; duplicate school IDs are rejected.
- Admin/Staff side: dashboard with charts, request approval/rejection queue,
  equipment inventory management (with auto-generated QR codes per item),
  return processing (with automatic damage → maintenance flagging), a
  maintenance board, user management, reports (with CSV export), and a
  full audit trail.
- Business logic implemented for real: reservation conflict detection,
  automatic overdue detection, due-soon notifications, and role-based
  access control (student/instructor/staff/admin).

## 2. Requirements

- [Node.js](https://nodejs.org) 20+ and npm
- [XAMPP](https://www.apachefriends.org/) (for MySQL/MariaDB + phpMyAdmin)
  — you only need the **MySQL** module running; Apache is not required.

## 3. Setup

### Step 1 — Start MySQL in XAMPP
Open the XAMPP Control Panel and click **Start** next to MySQL.

### Step 2 — Create the database
Open phpMyAdmin (`http://localhost/phpmyadmin`), click **Import**, and
import `database/schema.sql`. This creates the `cspc_ebs` database and all
tables. (Or from a terminal: `mysql -u root -p < database/schema.sql`.)

### Step 3 — Configure environment variables
Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

The database defaults match a stock local XAMPP install (`root` user, no
password, port `3306`). Replace the sample `SESSION_SECRET` with a random
value; for example, run
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
To enable password resets, also configure `APP_BASE_URL` and the `SMTP_*`
values. For Gmail, use an App Password instead of your regular account
password. Do not commit `.env`.

For production, set `NODE_ENV=production` and configure `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and a newly generated
`SESSION_SECRET` in the hosting dashboard. Use a non-root database user.
The MySQL pool then requires TLS, limits connections to five, and the
session store keeps sessions in MySQL's `sessions` table. The database user
needs permission to create and use that table. Set `DB_SSL_CA` only if the
database provider supplies a CA certificate.

### Step 4 — Install dependencies

```bash
npm install
```

### Step 5 — Seed realistic sample data (recommended)

```bash
npm run seed
```

This populates ~40 pieces of equipment across 9 categories, 7 demo users,
and a realistic spread of requests/borrowings (active, pending, overdue,
rejected, completed) so the dashboards look complete immediately. **This
command clears and re-inserts data** — re-run it any time you want to
reset to a clean demo state.

### Step 6 — Run the app

```bash
npm start
```

Then open **http://localhost:3000**.

### Password reset setup

After importing the main schema, run
`database/migrations/20261021_password_reset_tokens.sql` once in
phpMyAdmin or MySQL. Configure `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` in `.env`.
Use the publicly reachable HTTPS URL for `APP_BASE_URL` in production.
Reset links expire after 30 minutes and can only be used once. If SMTP is
not configured, the app reports the configuration error rather than
pretending an email was sent.

For development with auto-restart on file changes:

```bash
npm run dev
```

## 4. Demo logins

| Role    | ID Number | Password      |
|---------|-----------|---------------|
| Student | `253801`  | `password123` |
| Staff   | `STF-001` | `staff123`    |
| Admin   | `ADM-001` | `admin123`    |

Staff and Admin land on the personal borrowing dashboard by default (just
like a student) and can switch to **Admin Panel** from the sidebar/top
menu. Equipment inventory, user management, reports, and the audit trail
are restricted to the Admin role; Staff can still review requests, release
equipment, process returns, and update maintenance status.

## 5. Project structure

```
config/         MySQL connection pool
controllers/    Route handlers (auth, student-side, admin-side)
database/       schema.sql (tables) and seed.js (sample data)
middleware/     Auth guards, file-upload handling
public/         CSS, client JS, images, and uploaded files
routes/         Express routers
utils/          Business logic (availability checks, overdue detection,
                approve/release/return transaction engine, audit logging)
views/          EJS templates (auth/, student/, admin/, partials/, errors/)
server.js       App entry point
```

## 6. Notes on the design

- **Availability & conflicts**: `utils/statusEngine.js` checks how many
  units of an item are already committed (submitted → borrowed) within an
  overlapping date range before allowing a new request.
- **Overdue detection**: runs automatically whenever the dashboard or
  borrowings pages load — no cron job needed for the demo, though you
  could wire `refreshOverdueStatuses()` into `node-cron` for a production
  deployment.
- **QR codes**: equipment QR codes are generated on creation (and can be
  regenerated) and encode `{"type":"equipment","code":"EQ-001"}`. Request
  QR codes are generated on the fly and encode
  `{"type":"request","code":"REQ-00001"}`. The scanner page uses the
  `html5-qrcode` library (loaded from CDN) for real camera scanning, with
  a manual Request-ID search as a fallback.
- **Uploads**: equipment images, profile photos, and supporting documents
  are stored under `public/uploads/` and served statically.

## 7. Troubleshooting

- **"Could not connect to MySQL"** on startup: make sure MySQL is running
  in the XAMPP Control Panel and that `database/schema.sql` has been
  imported.
- **Port 3000 already in use**: change `PORT` in `.env`.
- **Images/QR codes not showing**: run `npm run seed` at least once —
  it generates the QR code image files under `public/uploads/qr/`.
