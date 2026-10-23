const dayjs = require('dayjs');
const db = require('../config/db');
const QRCode = require('qrcode');
const { nextEquipmentCode } = require('../utils/helpers');
const { refreshOverdueStatuses } = require('../utils/statusEngine');
const { logAudit, notify } = require('../utils/audit');
const { markUnderReview, approveRequest, rejectRequest, releaseBorrowing, returnBorrowing } = require('../utils/transactions');

// ---------------------------------------------------------------------------
// ADMIN DASHBOARD
// ---------------------------------------------------------------------------
exports.dashboard = async (req, res) => {
  await refreshOverdueStatuses();

  const [[stats]] = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(quantity_total),0) FROM equipment WHERE status='active') AS total_equipment,
       (SELECT COALESCE(SUM(quantity_available),0) FROM equipment WHERE status='active') AS available,
       (SELECT COALESCE(SUM(quantity_total - quantity_available),0) FROM equipment WHERE status='active') AS borrowed,
       (SELECT COUNT(*) FROM borrowings WHERE status='overdue') AS overdue,
       (SELECT COUNT(*) FROM requests WHERE status IN ('submitted','under_review')) AS pending_requests,
       (SELECT COUNT(*) FROM equipment WHERE maintenance_status != 'Operational' AND status='active') AS under_maintenance`
  );

  const [monthly] = await db.query(
    `SELECT DATE_FORMAT(borrow_date, '%b') AS month, DATE_FORMAT(borrow_date, '%Y-%m') AS ym, COUNT(*) AS total
     FROM borrowings WHERE borrow_date IS NOT NULL AND borrow_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
     GROUP BY ym ORDER BY ym ASC`
  );

  const [mostBorrowed] = await db.query(
    `SELECT e.name, COUNT(b.id) AS total FROM borrowings b JOIN equipment e ON e.id = b.equipment_id
     GROUP BY e.id ORDER BY total DESC LIMIT 5`
  );

  const [byCategory] = await db.query(
    `SELECT c.name, COUNT(e.id) AS total FROM equipment e JOIN categories c ON c.id = e.category_id
     WHERE e.status='active' GROUP BY c.id ORDER BY total DESC`
  );

  const [overdueList] = await db.query(
    `SELECT b.id, b.due_date, e.name AS equipment_name, u.full_name AS borrower_name, r.request_code
     FROM borrowings b JOIN equipment e ON e.id = b.equipment_id JOIN users u ON u.id = b.user_id
     JOIN requests r ON r.id = b.request_id
     WHERE b.status = 'overdue' ORDER BY b.due_date ASC LIMIT 5`
  );

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    active: 'dashboard',
    stats,
    monthly,
    mostBorrowed,
    byCategory,
    overdueList
  });
};

// ---------------------------------------------------------------------------
// REQUEST MANAGEMENT
// ---------------------------------------------------------------------------
exports.requestsList = async (req, res) => {
  const { status, equipmentStatus, q } = req.query;
  let where = ['1=1'];
  const params = [];

  if (status && status !== 'all') { where.push('r.status = ?'); params.push(status); }
  if (equipmentStatus && equipmentStatus !== 'all') {
    if (equipmentStatus === 'Archived') {
      where.push("e.status = 'archived'");
    } else {
      where.push("e.status = 'active' AND e.maintenance_status = ?");
      params.push(equipmentStatus);
    }
  }
  if (q) {
    where.push(`(r.request_code LIKE ? OR u.full_name LIKE ? OR e.name LIKE ? OR e.equipment_code LIKE ?
      OR CASE WHEN e.status = 'archived' THEN 'Archived' ELSE e.maintenance_status END LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [rows] = await db.query(
    `SELECT r.*, u.full_name AS borrower_name, u.id_number, u.role AS borrower_role,
            e.name AS equipment_name, e.equipment_code,
            CASE WHEN e.status = 'archived' THEN 'Archived' ELSE e.maintenance_status END AS equipment_status
     FROM requests r JOIN users u ON u.id = r.user_id JOIN equipment e ON e.id = r.equipment_id
     WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 200`,
    params
  );

  const [counts] = await db.query(
    `SELECT status, COUNT(*) AS total FROM requests GROUP BY status`
  );

  res.render('admin/requests', {
    title: 'Request Management',
    active: 'requests',
    rows,
    counts,
    filters: { status: status || 'all', equipmentStatus: equipmentStatus || 'all', q: q || '' }
  });
};

exports.requestDetails = async (req, res) => {
  const [[request]] = await db.query(
    `SELECT r.*, u.full_name AS borrower_name, u.id_number, u.email, u.role AS borrower_role, u.program, u.photo,
            e.name AS equipment_name, e.equipment_code, e.image, e.location, e.quantity_available
     FROM requests r JOIN users u ON u.id = r.user_id JOIN equipment e ON e.id = r.equipment_id
     WHERE r.id = ?`,
    [req.params.id]
  );
  if (!request) {
    req.flash('error', 'Request not found.');
    return res.redirect('/admin/requests');
  }
  const [[borrowing]] = await db.query(
    `SELECT b.*, releaser.full_name AS released_by_name, receiver.full_name AS received_by_name
     FROM borrowings b
     LEFT JOIN users releaser ON releaser.id = b.released_by
     LEFT JOIN users receiver ON receiver.id = b.received_by
     WHERE b.request_id = ?`,
    [request.id]
  );

  res.render('admin/request-details', {
    title: `Request ${request.request_code}`,
    active: 'requests',
    request,
    borrowing: borrowing || null
  });
};

exports.markUnderReview = async (req, res) => {
  try {
    await markUnderReview(req.params.id, req.session.user.id, req);
    req.flash('success', 'Request marked as Under Review.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('back');
};

exports.approveRequest = async (req, res) => {
  try {
    await approveRequest(req.params.id, req.session.user.id, req);
    req.flash('success', 'Request approved. The borrower has been notified.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect(req.body.redirectTo || '/admin/requests');
};

exports.rejectRequest = async (req, res) => {
  try {
    if (!req.body.reason || !req.body.reason.trim()) {
      throw new Error('A rejection reason is required.');
    }
    await rejectRequest(req.params.id, req.session.user.id, req.body.reason.trim(), req);
    req.flash('success', 'Request rejected. The borrower has been notified.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect(req.body.redirectTo || '/admin/requests');
};

// ---------------------------------------------------------------------------
// EQUIPMENT MANAGEMENT
// ---------------------------------------------------------------------------
exports.equipmentList = async (req, res) => {
  const { category, status, q } = req.query;
  let where = ['1=1'];
  const params = [];

  if (category && category !== 'all') { where.push('c.name = ?'); params.push(category); }
  if (status && status !== 'all') {
    if (status === 'archived') where.push('e.status = "archived"');
    else { where.push('e.status = "active"'); where.push('e.maintenance_status = ?'); params.push(status); }
  } else {
    where.push('e.status = "active"');
  }
  if (q) { where.push('(e.name LIKE ? OR e.equipment_code LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  const [rows] = await db.query(
    `SELECT e.*, c.name AS category_name FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
     WHERE ${where.join(' AND ')} ORDER BY e.name ASC`,
    params
  );

  const [categories] = await db.query('SELECT * FROM categories ORDER BY name ASC');

  res.render('admin/equipment', {
    title: 'Equipment Management',
    active: 'equipment',
    rows,
    categories,
    filters: { category: category || 'all', status: status || 'all', q: q || '' }
  });
};

exports.newEquipmentForm = async (req, res) => {
  const [categories] = await db.query('SELECT * FROM categories ORDER BY name ASC');
  res.render('admin/equipment-form', { title: 'Add Equipment', active: 'equipment', categories, equipment: null });
};

exports.editEquipmentForm = async (req, res) => {
  const [[equipment]] = await db.query('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
  if (!equipment) { req.flash('error', 'Equipment not found.'); return res.redirect('/admin/equipment'); }
  const [categories] = await db.query('SELECT * FROM categories ORDER BY name ASC');
  res.render('admin/equipment-form', { title: 'Edit Equipment', active: 'equipment', categories, equipment });
};

function parseSpecLines(text) {
  const specs = {};
  (text || '').split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx > -1) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) specs[key] = val;
    }
  });
  return specs;
}

exports.createEquipment = async (req, res) => {
  try {
    const {
      name, category_id, brand_model, description, condition_status,
      quantity_total, location, borrowing_rules, specifications
    } = req.body;

    const [[{ maxNum }]] = await db.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(equipment_code, 4) AS UNSIGNED)), 0) AS maxNum FROM equipment`
    );
    const code = nextEquipmentCode(parseInt(maxNum, 10) || 0);
    const image = req.file ? `/uploads/equipment/${req.file.filename}` : null;
    const qty = parseInt(quantity_total) || 1;

    const [result] = await db.query(
      `INSERT INTO equipment
       (equipment_code, name, category_id, brand_model, description, specifications, condition_status,
        quantity_total, quantity_available, location, image, borrowing_rules, maintenance_status, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Operational', 'active')`,
      [code, name, category_id || null, brand_model || null, description || null,
        JSON.stringify(parseSpecLines(specifications)), condition_status || 'Good',
        qty, qty, location || null, image, borrowing_rules || null]
    );

    await generateAndSaveQr(result.insertId, code);
    await logAudit(req.session.user.id, `Added equipment ${code} — ${name}`, 'Equipment', '', req);

    req.flash('success', `Equipment "${name}" (${code}) added successfully.`);
    res.redirect('/admin/equipment');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not add equipment. Please check the form and try again.');
    res.redirect('/admin/equipment/new');
  }
};

exports.updateEquipment = async (req, res) => {
  try {
    const {
      name, category_id, brand_model, description, condition_status,
      quantity_total, location, borrowing_rules, specifications, maintenance_status
    } = req.body;

    const [[existing]] = await db.query('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
    if (!existing) { req.flash('error', 'Equipment not found.'); return res.redirect('/admin/equipment'); }

    const newTotal = parseInt(quantity_total) || existing.quantity_total;
    const diff = newTotal - existing.quantity_total;
    const newAvailable = Math.max(existing.quantity_available + diff, 0);

    let image = existing.image;
    if (req.file) image = `/uploads/equipment/${req.file.filename}`;

    await db.query(
      `UPDATE equipment SET name=?, category_id=?, brand_model=?, description=?, specifications=?,
       condition_status=?, quantity_total=?, quantity_available=?, location=?, image=?, borrowing_rules=?,
       maintenance_status=? WHERE id = ?`,
      [name, category_id || null, brand_model || null, description || null,
        JSON.stringify(parseSpecLines(specifications)), condition_status, newTotal, newAvailable,
        location || null, image, borrowing_rules || null, maintenance_status || existing.maintenance_status, req.params.id]
    );

    await logAudit(req.session.user.id, `Updated equipment ${existing.equipment_code} — ${name}`, 'Equipment', '', req);
    req.flash('success', 'Equipment updated successfully.');
    res.redirect('/admin/equipment');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update equipment.');
    res.redirect(`/admin/equipment/${req.params.id}/edit`);
  }
};

exports.archiveEquipment = async (req, res) => {
  const [[equipment]] = await db.query('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
  await db.query('UPDATE equipment SET status = "archived" WHERE id = ?', [req.params.id]);
  await logAudit(req.session.user.id, `Archived equipment ${equipment.equipment_code} — ${equipment.name}`, 'Equipment', '', req);
  req.flash('success', 'Equipment archived.');
  res.redirect('/admin/equipment');
};

exports.restoreEquipment = async (req, res) => {
  await db.query('UPDATE equipment SET status = "active" WHERE id = ?', [req.params.id]);
  req.flash('success', 'Equipment restored to active inventory.');
  res.redirect('/admin/equipment');
};

async function generateAndSaveQr(equipmentId, code) {
  const payload = JSON.stringify({ type: 'equipment', code });
  const filename = `${code}.png`;
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'public', 'uploads', 'qr');
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  await QRCode.toFile(filepath, payload, { width: 400, margin: 1, color: { dark: '#174A8B', light: '#FFFFFF' } });
  await db.query('UPDATE equipment SET qr_code_path = ? WHERE id = ?', [`/uploads/qr/${filename}`, equipmentId]);
}

exports.regenerateQr = async (req, res) => {
  const [[equipment]] = await db.query('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
  if (!equipment) { req.flash('error', 'Equipment not found.'); return res.redirect('/admin/equipment'); }
  await generateAndSaveQr(equipment.id, equipment.equipment_code);
  await logAudit(req.session.user.id, `Regenerated QR code for ${equipment.equipment_code}`, 'Equipment', '', req);
  req.flash('success', 'QR code regenerated.');
  res.redirect(`/admin/equipment/${equipment.id}/edit`);
};

// ---------------------------------------------------------------------------
// RETURN MANAGEMENT
// ---------------------------------------------------------------------------
exports.returnsList = async (req, res) => {
  await refreshOverdueStatuses();
  const [rows] = await db.query(
    `SELECT b.*, r.request_code, e.name AS equipment_name, e.equipment_code, u.full_name AS borrower_name, u.id_number
     FROM borrowings b JOIN requests r ON r.id = b.request_id JOIN equipment e ON e.id = b.equipment_id
     JOIN users u ON u.id = b.user_id
     WHERE b.status IN ('active','overdue') ORDER BY b.due_date ASC`
  );
  res.render('admin/returns', { title: 'Return Management', active: 'returns', rows });
};

exports.processReturn = async (req, res) => {
  try {
    const { condition, remarks } = req.body;
    const result = await returnBorrowing(req.params.id, req.session.user.id, condition, remarks, req);
    req.flash('success', result.needsMaintenance
      ? 'Return recorded. Equipment automatically flagged for maintenance.'
      : 'Return recorded successfully.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/admin/returns');
};

exports.releaseFromRequest = async (req, res) => {
  try {
    await releaseBorrowing(req.params.id, req.session.user.id, req);
    req.flash('success', 'Equipment released to borrower.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('back');
};

// ---------------------------------------------------------------------------
// MAINTENANCE MANAGEMENT
// ---------------------------------------------------------------------------
exports.maintenanceList = async (req, res) => {
  const [equipmentUnderMaintenance] = await db.query(
    `SELECT e.*, c.name AS category_name FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.maintenance_status != 'Operational' AND e.status = 'active' ORDER BY e.updated_at DESC`
  );
  const [logs] = await db.query(
    `SELECT m.*, e.name AS equipment_name, e.equipment_code, u.full_name AS reported_by_name
     FROM maintenance_logs m JOIN equipment e ON e.id = m.equipment_id
     LEFT JOIN users u ON u.id = m.reported_by
     ORDER BY m.created_at DESC LIMIT 50`
  );
  const [allEquipment] = await db.query(`SELECT id, name, equipment_code FROM equipment WHERE status='active' ORDER BY name`);

  res.render('admin/maintenance', {
    title: 'Maintenance Management',
    active: 'maintenance',
    equipmentUnderMaintenance,
    logs,
    allEquipment
  });
};

exports.createMaintenanceLog = async (req, res) => {
  const { equipment_id, problem, assigned_technician, status } = req.body;
  await db.query(
    `INSERT INTO maintenance_logs (equipment_id, problem, reported_by, date_reported, assigned_technician, status)
     VALUES (?, ?, ?, CURDATE(), ?, ?)`,
    [equipment_id, problem, req.session.user.id, assigned_technician || null, status || 'Scheduled']
  );
  await db.query('UPDATE equipment SET maintenance_status = "Under Maintenance" WHERE id = ?', [equipment_id]);
  await logAudit(req.session.user.id, `Logged maintenance issue for equipment #${equipment_id}`, 'Maintenance', problem, req);
  req.flash('success', 'Maintenance issue logged and equipment marked unavailable.');
  res.redirect('/admin/maintenance');
};

exports.updateMaintenanceStatus = async (req, res) => {
  const { status, equipment_status } = req.body;
  await db.query('UPDATE maintenance_logs SET status = ?, completion_date = ? WHERE id = ?', [
    status, status === 'Completed' ? dayjs().format('YYYY-MM-DD') : null, req.params.id
  ]);

  if (equipment_status) {
    const [[log]] = await db.query('SELECT equipment_id FROM maintenance_logs WHERE id = ?', [req.params.id]);
    await db.query('UPDATE equipment SET maintenance_status = ? WHERE id = ?', [equipment_status, log.equipment_id]);
  }

  await logAudit(req.session.user.id, `Updated maintenance log #${req.params.id} to ${status}`, 'Maintenance', '', req);
  req.flash('success', 'Maintenance record updated.');
  res.redirect('/admin/maintenance');
};

// ---------------------------------------------------------------------------
// USER MANAGEMENT
// ---------------------------------------------------------------------------
exports.usersList = async (req, res) => {
  const { role, q } = req.query;
  let where = ['1=1'];
  const params = [];
  if (role && role !== 'all') { where.push('u.role = ?'); params.push(role); }
  if (q) { where.push('(u.full_name LIKE ? OR u.id_number LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  const [rows] = await db.query(
    `SELECT u.*,
       (SELECT COUNT(*) FROM borrowings WHERE user_id = u.id AND status IN ('active','overdue')) AS active_borrowings,
       (SELECT COUNT(*) FROM borrowings WHERE user_id = u.id AND status = 'overdue') AS overdue_items
     FROM users u WHERE ${where.join(' AND ')} ORDER BY u.full_name ASC`,
    params
  );

  res.render('admin/users', { title: 'User Management', active: 'users', rows, filters: { role: role || 'all', q: q || '' } });
};

exports.userDetails = async (req, res) => {
  const [[targetUser]] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!targetUser) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }

  const [history] = await db.query(
    `SELECT r.request_code, e.name AS equipment_name, r.status, r.created_at, b.borrow_date, b.return_date
     FROM requests r JOIN equipment e ON e.id = r.equipment_id
     LEFT JOIN borrowings b ON b.request_id = r.id
     WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 30`,
    [targetUser.id]
  );

  res.render('admin/user-details', { title: targetUser.full_name, active: 'users', targetUser, history });
};

exports.toggleUserStatus = async (req, res) => {
  const [[targetUser]] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  const newStatus = targetUser.account_status === 'active' ? 'inactive' : 'active';
  await db.query('UPDATE users SET account_status = ? WHERE id = ?', [newStatus, req.params.id]);
  await logAudit(req.session.user.id, `${newStatus === 'active' ? 'Activated' : 'Deactivated'} user ${targetUser.full_name}`, 'Users', '', req);
  req.flash('success', `${targetUser.full_name} is now ${newStatus}.`);
  res.redirect('/admin/users');
};

exports.updateUser = async (req, res) => {
  const { full_name, email, department, program, role, contact_number } = req.body;
  await db.query(
    'UPDATE users SET full_name=?, email=?, department=?, program=?, role=?, contact_number=? WHERE id=?',
    [full_name, email, department, program, role, contact_number, req.params.id]
  );
  await logAudit(req.session.user.id, `Updated user profile for ${full_name}`, 'Users', '', req);
  req.flash('success', 'User updated successfully.');
  res.redirect(`/admin/users/${req.params.id}`);
};

// ---------------------------------------------------------------------------
// REPORTS & ANALYTICS
// ---------------------------------------------------------------------------
exports.reports = async (req, res) => {
  const { from, to, category, department, report_type } = req.query;
  const type = report_type || 'daily';

  let where = ['1=1'];
  const params = [];
  if (from) { where.push('r.created_at >= ?'); params.push(from); }
  if (to) { where.push('r.created_at <= ?'); params.push(`${to} 23:59:59`); }
  if (category && category !== 'all') { where.push('c.name = ?'); params.push(category); }
  if (department && department !== 'all') { where.push('r.department_program = ?'); params.push(department); }

  const [summary] = await db.query(
    `SELECT DATE(r.created_at) AS day, COUNT(*) AS total
     FROM requests r JOIN equipment e ON e.id = r.equipment_id LEFT JOIN categories c ON c.id = e.category_id
     WHERE ${where.join(' AND ')} GROUP BY day ORDER BY day DESC LIMIT 30`,
    params
  );

  const [mostBorrowed] = await db.query(
    `SELECT e.name, COUNT(*) AS total FROM requests r JOIN equipment e ON e.id = r.equipment_id
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE ${where.join(' AND ')} GROUP BY e.id ORDER BY total DESC LIMIT 10`,
    params
  );

  const [overdueReport] = await db.query(
    `SELECT r.request_code, u.full_name, e.name AS equipment_name, b.due_date
     FROM borrowings b JOIN requests r ON r.id = b.request_id JOIN users u ON u.id = b.user_id
     JOIN equipment e ON e.id = b.equipment_id WHERE b.status = 'overdue'`
  );

  const [damageReport] = await db.query(
    `SELECT r.request_code, u.full_name, e.name AS equipment_name, b.condition_after, b.return_date, b.remarks
     FROM borrowings b JOIN requests r ON r.id = b.request_id JOIN users u ON u.id = b.user_id
     JOIN equipment e ON e.id = b.equipment_id
     WHERE b.condition_after IN ('Damaged','Missing Parts','Minor Damage') ORDER BY b.return_date DESC LIMIT 20`
  );

  const [categories] = await db.query('SELECT name FROM categories ORDER BY name');
  const [departments] = await db.query('SELECT DISTINCT department_program FROM requests WHERE department_program IS NOT NULL');

  res.render('admin/reports', {
    title: 'Reports & Analytics',
    active: 'reports',
    summary,
    mostBorrowed,
    overdueReport,
    damageReport,
    categories,
    departments,
    filters: { from: from || '', to: to || '', category: category || 'all', department: department || 'all', report_type: type }
  });
};

exports.exportReportCsv = async (req, res) => {
  const [rows] = await db.query(
    `SELECT r.request_code, u.full_name AS borrower, e.name AS equipment, r.status,
            r.date_needed, r.expected_return_date, b.borrow_date, b.return_date, b.condition_after
     FROM requests r JOIN users u ON u.id = r.user_id JOIN equipment e ON e.id = r.equipment_id
     LEFT JOIN borrowings b ON b.request_id = r.id ORDER BY r.created_at DESC`
  );

  const header = 'Request ID,Borrower,Equipment,Status,Date Needed,Expected Return,Borrow Date,Return Date,Condition\n';
  const csv = rows.map((r) => [
    r.request_code, r.borrower, r.equipment, r.status, r.date_needed, r.expected_return_date,
    r.borrow_date || '', r.return_date || '', r.condition_after || ''
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="cspc-borrowing-report.csv"');
  res.send(header + csv);
};

// ---------------------------------------------------------------------------
// AUDIT TRAIL
// ---------------------------------------------------------------------------
exports.auditTrail = async (req, res) => {
  const { q, module, from, to } = req.query;
  let where = ['1=1'];
  const params = [];
  if (q) { where.push('(u.full_name LIKE ? OR a.action LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (module && module !== 'all') { where.push('a.module = ?'); params.push(module); }
  if (from) { where.push('a.created_at >= ?'); params.push(from); }
  if (to) { where.push('a.created_at <= ?'); params.push(`${to} 23:59:59`); }

  const [rows] = await db.query(
    `SELECT a.*, u.full_name, u.role FROM audit_trail a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 300`,
    params
  );
  const [modules] = await db.query('SELECT DISTINCT module FROM audit_trail ORDER BY module');

  res.render('admin/audit-trail', {
    title: 'Audit Trail',
    active: 'audit',
    rows,
    modules,
    filters: { q: q || '', module: module || 'all', from: from || '', to: to || '' }
  });
};

// Lightweight status-only update used from the Maintenance page quick-select,
// so it never touches the rest of the equipment record.
exports.updateEquipmentMaintenanceStatus = async (req, res) => {
  const { maintenance_status } = req.body;
  const [[equipment]] = await db.query('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
  if (!equipment) { req.flash('error', 'Equipment not found.'); return res.redirect('/admin/maintenance'); }

  await db.query('UPDATE equipment SET maintenance_status = ? WHERE id = ?', [maintenance_status, req.params.id]);
  await logAudit(req.session.user.id, `Changed maintenance status of ${equipment.equipment_code} to ${maintenance_status}`, 'Maintenance', '', req);
  req.flash('success', 'Equipment status updated.');
  res.redirect('/admin/maintenance');
};
