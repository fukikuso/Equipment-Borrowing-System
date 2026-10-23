require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');

const db = require('./config/db');
const helpers = require('./utils/helpers');
const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// ---------------------------------------------------------------------------
// View engine
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cspc-ebs-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours by default; extended on "remember me"
}));
app.use(flash());

// ---------------------------------------------------------------------------
// Template globals: current user, flash messages, helpers, unread notif count
// ---------------------------------------------------------------------------
app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.successMsg = req.flash('success');
  res.locals.errorMsg = req.flash('error');
  res.locals.h = helpers;
  res.locals.currentPath = req.path;
  res.locals.unreadNotifications = 0;
  res.locals.pendingRequestCount = 0;

  if (req.session.user) {
    if (req.session.user.role === 'faculty') {
      req.session.user.role = 'instructor';
    }
    try {
      const [[row]] = await db.query(
        'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0',
        [req.session.user.id]
      );
      res.locals.unreadNotifications = row.total;
      if (['admin', 'staff'].includes(req.session.user.role)) {
        const [[pending]] = await db.query(
          "SELECT COUNT(*) AS total FROM requests WHERE status IN ('submitted', 'under_review')"
        );
        res.locals.pendingRequestCount = pending.total;
      }
    } catch (err) {
      // Non-fatal: header just shows 0 if this lookup fails.
      res.locals.unreadNotifications = 0;
      res.locals.pendingRequestCount = 0;
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' || req.session.user.role === 'staff' ? '/admin/dashboard' : '/dashboard');
  }
  res.redirect('/login');
});

app.use('/', authRoutes);
app.use('/', studentRoutes);
app.use('/admin', adminRoutes);

// Global search (from the header search bar) — routes to catalog / requests by keyword
app.get('/search/suggestions', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ results: [] });

  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (!q) return res.json({ results: [] });

  try {
    const pattern = `%${q}%`;
    let results;

    if (user.role === 'admin' || user.role === 'staff') {
      const [rows] = await db.query(
        `SELECT r.id, r.request_code, r.status, u.full_name AS borrower_name,
                e.name AS equipment_name, e.equipment_code
         FROM requests r
         JOIN users u ON u.id = r.user_id
         JOIN equipment e ON e.id = r.equipment_id
         WHERE r.request_code LIKE ? OR u.full_name LIKE ? OR e.name LIKE ? OR e.equipment_code LIKE ?
         ORDER BY r.created_at DESC LIMIT 8`,
        [pattern, pattern, pattern, pattern]
      );

      results = rows.map((row) => ({
        title: row.equipment_name,
        detail: `${row.request_code} · ${row.borrower_name} · ${row.status.replace(/_/g, ' ')}`,
        href: `/admin/requests/${row.id}`,
        type: 'Request'
      }));
    } else {
      const [equipment] = await db.query(
        `SELECT e.id, e.name, e.equipment_code, e.brand_model, c.name AS category_name
         FROM equipment e
         LEFT JOIN categories c ON c.id = e.category_id
         WHERE e.status = 'active'
           AND (e.name LIKE ? OR e.equipment_code LIKE ? OR e.brand_model LIKE ? OR c.name LIKE ?)
         ORDER BY e.name ASC LIMIT 6`,
        [pattern, pattern, pattern, pattern]
      );
      const [requests] = await db.query(
        `SELECT r.id, r.request_code, r.status, e.name AS equipment_name
         FROM requests r
         JOIN equipment e ON e.id = r.equipment_id
         WHERE r.user_id = ? AND (r.request_code LIKE ? OR e.name LIKE ?)
         ORDER BY r.created_at DESC LIMIT 4`,
        [user.id, pattern, pattern]
      );

      results = [
        ...equipment.map((row) => ({
          title: row.name,
          detail: [row.equipment_code, row.category_name || row.brand_model].filter(Boolean).join(' · '),
          href: `/equipment/${row.id}`,
          type: 'Equipment'
        })),
        ...requests.map((row) => ({
          title: row.equipment_name,
          detail: `${row.request_code} · ${row.status.replace(/_/g, ' ')}`,
          href: `/requests/${row.id}`,
          type: 'Request'
        }))
      ].slice(0, 8);
    }

    res.json({ results });
  } catch (err) {
    console.error('[Search Suggestions Error]', err);
    res.status(500).json({ error: 'Unable to load search suggestions.' });
  }
});

app.get('/search', (req, res) => {
  const q = req.query.q || '';
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role === 'admin' || req.session.user.role === 'staff') {
    return res.redirect(`/admin/requests?q=${encodeURIComponent(q)}`);
  }
  return res.redirect(`/equipment?q=${encodeURIComponent(q)}`);
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page Not Found', hideChrome: !req.session.user });
});

// ---------------------------------------------------------------------------
// 500 — centralized error handler so a thrown error never crashes the process
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  const status = err.status || 500;
  res.status(status).render('errors/500', { title: 'Something Went Wrong', hideChrome: !req.session.user, message: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CSPC Equipment Borrowing System running at http://localhost:${PORT}`);
});
