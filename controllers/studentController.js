const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const db = require('../config/db');
const { nextRequestCode } = require('../utils/helpers');
const { refreshOverdueStatuses, generateDueSoonNotifications, checkAvailability } = require('../utils/statusEngine');
const { logAudit, notify } = require('../utils/audit');

const categoryEquipmentImages = {
  Laptops: '/images/equipment-laptop.svg',
  Cameras: '/images/equipment-camera.svg',
  Microphones: '/images/equipment-microphone.svg',
  Projectors: '/images/equipment-projector.svg',
  Speakers: '/images/equipment-speaker.svg',
  'Networking Equipment': '/images/equipment-networking.svg',
  Cables: '/images/equipment-cables.svg',
  Tools: '/images/equipment-tools.svg',
  'Other Equipment': '/images/equipment-other.svg'
};

function getEquipmentImage(equipment) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const imagesDirectory = path.join(__dirname, '..', 'public', 'images');
  const equipmentCodes = [equipment.equipment_code, equipment.equipment_code.replace(/-/g, '_')];
  const itemImageFilename = equipmentCodes
    .flatMap((code) => imageExtensions.map((extension) => `${code}${extension}`))
    .find((filename) => fs.existsSync(path.join(imagesDirectory, filename)));

  if (itemImageFilename) return `/images/${itemImageFilename}`;
  if (equipment.image) return equipment.image;

  const categoryImage = categoryEquipmentImages[equipment.category_name];
  return categoryImage && fs.existsSync(path.join(__dirname, '..', 'public', categoryImage.slice(1)))
    ? categoryImage
    : null;
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
exports.dashboard = async (req, res) => {
  const userId = req.session.user.id;
  await refreshOverdueStatuses();
  await generateDueSoonNotifications();

  const [[stats]] = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(quantity_available),0) FROM equipment WHERE status = 'active') AS available_equipment,
       (SELECT COALESCE(SUM(quantity_total),0) FROM equipment WHERE status = 'active') AS total_equipment,
       (SELECT COUNT(*) FROM borrowings WHERE user_id = ? AND status IN ('active','overdue')) AS active_borrowings,
       (SELECT COUNT(*) FROM requests WHERE user_id = ? AND status IN ('submitted','under_review')) AS pending_requests,
       (SELECT COUNT(*) FROM borrowings WHERE user_id = ? AND status = 'overdue') AS overdue_items,
       (SELECT COALESCE(
          ROUND(
            100.0 * SUM(CASE WHEN return_date IS NOT NULL AND return_date <= due_date THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN return_date IS NOT NULL OR due_date < NOW() THEN 1 ELSE 0 END), 0),
            0
          ),
          100
        )
        FROM borrowings WHERE user_id = ?) AS on_time_return_rate`,
    [userId, userId, userId, userId]
  );

  const [upcomingReturns] = await db.query(
    `SELECT b.id, b.due_date, b.status, e.name, e.equipment_code, c.icon
     FROM borrowings b
     JOIN equipment e ON e.id = b.equipment_id
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE b.user_id = ? AND b.status IN ('active','overdue')
     ORDER BY b.due_date ASC LIMIT 5`,
    [userId]
  );

  const [recentRequests] = await db.query(
    `SELECT r.id, r.request_code, r.status, r.created_at, r.date_needed, e.name AS equipment_name
     FROM requests r JOIN equipment e ON e.id = r.equipment_id
     WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 5`,
    [userId]
  );

  const [popularEquipment] = await db.query(
    `SELECT e.*, c.name AS category_name, c.icon AS category_icon FROM equipment e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.status = 'active'
     ORDER BY e.quantity_available DESC, e.name ASC LIMIT 5`
  );
  popularEquipment.forEach((item) => {
    item.catalogImage = getEquipmentImage(item);
  });

  const [notifications] = await db.query(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
    [userId]
  );

  const [[borrowingCount]] = await db.query(
    `SELECT COUNT(*) AS total FROM borrowings WHERE user_id = ?`,
    [userId]
  );

  res.render('student/dashboard', {
    title: 'Dashboard',
    active: 'dashboard',
    stats,
    upcomingReturns,
    recentRequests,
    popularEquipment,
    notifications,
    totalBorrowings: borrowingCount.total
  });
};

// ---------------------------------------------------------------------------
// EQUIPMENT CATALOG
// ---------------------------------------------------------------------------
exports.equipmentCatalog = async (req, res) => {
  const { category, availability, condition, location, q, sort, page: pageParam } = req.query;
  const searchQuery = typeof q === 'string' ? q.trim() : '';
  const hasActiveFilters = Boolean(
    (category && category !== 'all') ||
    (availability && availability !== '') ||
    (condition && condition !== 'all') ||
    (location && location !== 'all')
  );
  const defaultCatalogView = !searchQuery && !availability && !condition && !location && (!category || category === 'all');
  const hasSearched = searchQuery.length > 0 || hasActiveFilters || defaultCatalogView;
  const page = Math.max(parseInt(pageParam) || 1, 1);
  const perPage = defaultCatalogView && page === 1 ? 9999 : 8;

  let where = ['e.status = "active"'];
  const params = [];

  if (category && category !== 'all') {
    where.push('c.name = ?');
    params.push(category);
  }
  if (availability === 'available') where.push('e.quantity_available > 0 AND e.maintenance_status = "Operational"');
  if (availability === 'borrowed') where.push('e.quantity_available < e.quantity_total');
  if (availability === 'maintenance') where.push('e.maintenance_status != "Operational"');
  if (condition && condition !== 'all') {
    where.push('e.condition_status = ?');
    params.push(condition);
  }
  if (location && location !== 'all') {
    where.push('e.location = ?');
    params.push(location);
  }
  if (searchQuery) {
    where.push('(e.name = ? OR e.name LIKE ? OR e.equipment_code = ? OR e.equipment_code LIKE ? OR e.brand_model LIKE ? OR c.name = ? OR c.name LIKE ?)');
    params.push(
      searchQuery,
      `${searchQuery}%`,
      searchQuery,
      `${searchQuery}%`,
      `%${searchQuery}%`,
      searchQuery,
      `${searchQuery}%`
    );
  }

  let orderBy = 'e.quantity_available DESC, e.name ASC';
  if (sort === 'name') orderBy = 'e.name ASC';
  if (sort === 'newest') orderBy = 'e.created_at DESC';

  const whereSql = where.join(' AND ');

  let total = 0;
  let items = [];
  if (hasSearched) {
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total FROM equipment e LEFT JOIN categories c ON c.id = e.category_id WHERE ${whereSql}`,
      params
    );
    total = countRow.total;
    [items] = await db.query(
      `SELECT e.*, c.name AS category_name, c.icon AS category_icon
       FROM equipment e LEFT JOIN categories c ON c.id = e.category_id
       WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    );
  }

  for (const item of items) {
    item.catalogImage = getEquipmentImage(item);
  }

  const [categories] = await db.query(
    `SELECT c.name, c.icon, COUNT(e.id) AS count
     FROM categories c LEFT JOIN equipment e ON e.category_id = c.id AND e.status = 'active'
     GROUP BY c.id ORDER BY c.name ASC`
  );
  const [[{ allCount }]] = await db.query(`SELECT COUNT(*) AS allCount FROM equipment WHERE status = 'active'`);

  const [locations] = await db.query(`SELECT DISTINCT location FROM equipment WHERE status = 'active' ORDER BY location`);

  res.render('student/equipment-catalog', {
    title: 'Equipment Catalog',
    active: ['admin', 'staff'].includes(req.session.user.role) ? 'equipment-catalog' : 'equipment',
    items,
    categories,
    allCount,
    locations,
    hasSearched,
    hasFilters: hasActiveFilters,
    filters: { category: category || 'all', availability: availability || '', condition: condition || 'all', location: location || 'all', q: q || '', sort: sort || 'popular' },
    pagination: { page, perPage, total, totalPages: Math.max(Math.ceil(total / perPage), 1) }
  });
};

// ---------------------------------------------------------------------------
// EQUIPMENT DETAILS
// ---------------------------------------------------------------------------
exports.equipmentDetails = async (req, res) => {
  const [[equipment]] = await db.query(
    `SELECT e.*, c.name AS category_name FROM equipment e
     LEFT JOIN categories c ON c.id = e.category_id WHERE e.id = ?`,
    [req.params.id]
  );
  if (!equipment) {
    req.flash('error', 'Equipment not found.');
    return res.redirect('/equipment');
  }
  equipment.catalogImage = getEquipmentImage(equipment);

  const [history] = await db.query(
    `SELECT b.borrow_date, b.return_date, u.full_name, u.program, b.status
     FROM borrowings b JOIN users u ON u.id = b.user_id
     WHERE b.equipment_id = ? ORDER BY b.borrow_date DESC LIMIT 10`,
    [equipment.id]
  );

  const [currentBorrower] = await db.query(
    `SELECT u.full_name, b.due_date FROM borrowings b JOIN users u ON u.id = b.user_id
     WHERE b.equipment_id = ? AND b.status IN ('active','overdue') LIMIT 1`,
    [equipment.id]
  );

  const [alternatives] = await db.query(
    `SELECT e.id, e.name, e.equipment_code, e.quantity_available, e.image, e.category_id, c.name AS category_name
     FROM equipment e JOIN categories c ON c.id = e.category_id
     WHERE e.category_id = ? AND e.id != ? AND e.status = 'active' AND e.quantity_available > 0 AND e.maintenance_status = 'Operational'
     LIMIT 3`,
    [equipment.category_id, equipment.id]
  );

  alternatives.forEach((item) => {
    item.catalogImage = getEquipmentImage(item);
  });

  res.render('student/equipment-details', {
    title: equipment.name,
    active: ['admin', 'staff'].includes(req.session.user.role)
      ? (req.baseUrl === '/admin' ? 'equipment' : 'equipment-catalog')
      : 'equipment',
    equipment,
    history,
    currentBorrower: currentBorrower[0] || null,
    alternatives,
    isAdmin: req.session.user.role === 'admin'
  });
};

// ---------------------------------------------------------------------------
// REQUEST EQUIPMENT (multi-step form rendered client-side, single POST)
// ---------------------------------------------------------------------------
exports.newRequestForm = async (req, res) => {
  const [equipmentList] = await db.query(
    `SELECT e.*, c.name AS category_name FROM equipment e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.status = 'active' ORDER BY e.name ASC`
  );
  const preselected = req.query.equipment ? parseInt(req.query.equipment) : null;

  res.render('student/request-equipment', {
    title: 'Request Equipment',
    active: 'request',
    equipmentList,
    preselected
  });
};

exports.createRequest = async (req, res) => {
  const userId = req.session.user.id;
  const {
    equipment_id, quantity, purpose, date_needed, time_needed,
    expected_return_date, expected_return_time, activity_event, department_program
  } = req.body;

  try {
    if (!equipment_id || !date_needed || !expected_return_date || !purpose) {
      req.flash('error', 'Please complete all required fields.');
      return res.redirect('/request-equipment');
    }
    if (dayjs(expected_return_date).isBefore(dayjs(date_needed))) {
      req.flash('error', 'Return date cannot be before the date needed.');
      return res.redirect('/request-equipment');
    }

    const qty = parseInt(quantity) || 1;
    const availability = await checkAvailability(equipment_id, qty, date_needed, expected_return_date);
    if (!availability.ok) {
      req.flash('error', availability.reason);
      return res.redirect(`/request-equipment?equipment=${equipment_id}`);
    }

    const [[{ maxNum }]] = await db.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(request_code, 5) AS UNSIGNED)), 0) AS maxNum FROM requests`
    );
    const requestCode = nextRequestCode(parseInt(maxNum, 10) || 0);
    const supportingDocument = req.file ? `/uploads/documents/${req.file.filename}` : null;

    const [result] = await db.query(
      `INSERT INTO requests
       (request_code, user_id, equipment_id, quantity, purpose, activity_event, department_program,
        date_needed, time_needed, expected_return_date, expected_return_time, supporting_document, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [requestCode, userId, equipment_id, qty, purpose, activity_event || null,
        department_program || null, date_needed, time_needed || null,
        expected_return_date, expected_return_time || null, supportingDocument]
    );

    const [[equipment]] = await db.query('SELECT name FROM equipment WHERE id = ?', [equipment_id]);
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND account_status = 'active'");
    await Promise.all(admins.map((admin) => notify(
      admin.id,
      'info',
      'New equipment request',
      `${req.session.user.full_name} requested ${equipment.name} (${requestCode}).`,
      result.insertId
    )));

    await logAudit(userId, `Submitted request ${requestCode}`, 'Requests', `Equipment ID ${equipment_id}`, req);

    req.flash('success', `Request Submitted Successfully — your Request ID is ${requestCode}.`);
    res.redirect(`/requests/${result.insertId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong while submitting your request. Please try again.');
    res.redirect('/request-equipment');
  }
};

// ---------------------------------------------------------------------------
// REQUEST STATUS TRACKER
// ---------------------------------------------------------------------------
exports.requestStatus = async (req, res) => {
  const userId = req.session.user.id;
  const isAdmin = req.session.user.role === 'admin';

  const [[request]] = await db.query(
    `SELECT r.*, e.name AS equipment_name, e.equipment_code, e.image, u.full_name AS borrower_name
     FROM requests r JOIN equipment e ON e.id = r.equipment_id JOIN users u ON u.id = r.user_id
     WHERE r.id = ? ${isAdmin ? '' : 'AND r.user_id = ?'}`,
    isAdmin ? [req.params.id] : [req.params.id, userId]
  );

  if (!request) {
    req.flash('error', 'Request not found.');
    return res.redirect('/my-borrowings');
  }

  const [[borrowing]] = await db.query('SELECT * FROM borrowings WHERE request_id = ?', [request.id]);

  res.render('student/request-status', {
    title: `Request ${request.request_code}`,
    active: 'request',
    request,
    borrowing: borrowing || null
  });
};

// ---------------------------------------------------------------------------
// MY BORROWINGS
// ---------------------------------------------------------------------------
exports.myBorrowings = async (req, res) => {
  const userId = req.session.user.id;
  await refreshOverdueStatuses();
  const tab = req.query.tab || 'active';

  const statusMap = {
    active: ['borrowed'],
    pending: ['submitted', 'under_review'],
    approved: ['ready_for_pickup'],
    returned: ['returned', 'completed'],
    overdue: ['overdue']
  };

  let rows;
  if (tab === 'overdue') {
    [rows] = await db.query(
      `SELECT r.*, e.name AS equipment_name, e.equipment_code, e.image, c.name AS category_name,
              b.id AS borrowing_id, b.due_date, b.status AS borrow_status
       FROM requests r JOIN equipment e ON e.id = r.equipment_id
       LEFT JOIN categories c ON c.id = e.category_id
       JOIN borrowings b ON b.request_id = r.id
       WHERE r.user_id = ? AND b.status = 'overdue' ORDER BY b.due_date ASC`,
      [userId]
    );
  } else {
    const statuses = statusMap[tab] || statusMap.active;
    [rows] = await db.query(
      `SELECT r.*, e.name AS equipment_name, e.equipment_code, e.image, c.name AS category_name,
              b.id AS borrowing_id, b.due_date, b.return_date, b.status AS borrow_status
       FROM requests r JOIN equipment e ON e.id = r.equipment_id
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN borrowings b ON b.request_id = r.id
       WHERE r.user_id = ? AND r.status IN (${statuses.map(() => '?').join(',')})
       ORDER BY r.created_at DESC`,
      [userId, ...statuses]
    );
  }
  rows.forEach((row) => {
    row.catalogImage = getEquipmentImage(row);
  });

  const [counts] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM requests WHERE user_id = ? AND status = 'borrowed') AS active,
       (SELECT COUNT(*) FROM requests WHERE user_id = ? AND status IN ('submitted','under_review')) AS pending,
       (SELECT COUNT(*) FROM requests WHERE user_id = ? AND status = 'ready_for_pickup') AS approved,
       (SELECT COUNT(*) FROM requests WHERE user_id = ? AND status IN ('returned','completed')) AS returned,
       (SELECT COUNT(*) FROM borrowings WHERE user_id = ? AND status = 'overdue') AS overdue`,
    [userId, userId, userId, userId, userId]
  );

  const [upcoming] = await db.query(
    `SELECT b.due_date, e.name FROM borrowings b JOIN equipment e ON e.id = b.equipment_id
     WHERE b.user_id = ? AND b.status IN ('active','overdue') ORDER BY b.due_date ASC LIMIT 3`,
    [userId]
  );

  res.render('student/my-borrowings', {
    title: 'My Borrowings',
    active: 'borrowings',
    rows,
    tab,
    counts: counts[0],
    upcoming
  });
};

// ---------------------------------------------------------------------------
// QR CODE (borrow pickup / return presentation)
// ---------------------------------------------------------------------------
exports.borrowingQr = async (req, res) => {
  const userId = req.session.user.id;
  const isAdmin = ['admin', 'staff'].includes(req.session.user.role);

  const [[request]] = await db.query(
    `SELECT r.*, e.name AS equipment_name, e.equipment_code, e.image, e.location, e.specifications
     FROM requests r JOIN equipment e ON e.id = r.equipment_id
     WHERE r.id = ? ${isAdmin ? '' : 'AND r.user_id = ?'}`,
    isAdmin ? [req.params.requestId] : [req.params.requestId, userId]
  );

  if (!request) {
    req.flash('error', 'Request not found.');
    return res.redirect('/my-borrowings');
  }

  if (!isAdmin && request.status !== 'ready_for_pickup') {
    req.flash('error', 'The pickup QR code is available after your request is approved and ready for pickup.');
    return res.redirect('/my-borrowings');
  }

  const [[borrowing]] = await db.query('SELECT * FROM borrowings WHERE request_id = ?', [request.id]);

  const qrPayload = JSON.stringify({ type: 'request', code: request.request_code });
  const QRCode = require('qrcode');
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 320, margin: 1, color: { dark: '#174A8B', light: '#FFFFFF' } });

  res.render('student/qr-code', {
    title: 'QR Code',
    active: 'borrowings',
    request,
    borrowing,
    qrDataUrl
  });
};

// ---------------------------------------------------------------------------
// QR SCANNER (staff/admin process transactions; students can look up info)
// ---------------------------------------------------------------------------
exports.qrScannerPage = (req, res) => {
  res.render('student/qr-scanner', {
    title: 'Pickup & Return QR Scanner',
    active: 'scanner',
    canRelease: ['admin', 'staff'].includes(req.session.user.role),
    canReturn: ['admin', 'staff'].includes(req.session.user.role)
  });
};

exports.qrScanLookup = async (req, res) => {
  try {
    const scannedCode = String(req.body.code || '').trim();
    if (!scannedCode) {
      return res.status(400).json({ ok: false, message: 'Scan a pickup QR code or enter a request ID.' });
    }

    let payload;
    try {
      payload = JSON.parse(scannedCode);
    } catch {
      payload = { type: 'request', code: scannedCode };
    }
    if (!payload || !['request', 'pickup_request', 'equipment'].includes(payload.type) || typeof payload.code !== 'string' || !payload.code.trim()) {
      return res.status(400).json({ ok: false, message: 'This QR code is not a valid request or equipment code.' });
    }

    if (payload.type === 'equipment') {
      const [matches] = await db.query(
        `SELECT r.*, b.id AS borrowing_id, b.status AS borrowing_status, b.due_date,
                e.name AS equipment_name, e.equipment_code, e.image, e.location,
                u.full_name AS borrower_name, u.role AS borrower_role, u.program, u.id_number, u.email, u.photo
         FROM borrowings b
         JOIN requests r ON r.id = b.request_id
         JOIN equipment e ON e.id = b.equipment_id
         JOIN users u ON u.id = b.user_id
         WHERE e.equipment_code = ? AND b.status IN ('active', 'overdue')
         ORDER BY b.due_date ASC`,
        [payload.code]
      );

      if (matches.length === 0) {
        return res.json({ ok: false, message: 'No active or overdue borrowing was found for this equipment.' });
      }

      if (req.session.user.role === 'staff' && matches.some((match) => !['borrowed', 'overdue'].includes(match.status))) {
        return res.status(409).json({ ok: false, message: 'Only active or overdue equipment can be returned.' });
      }

      return res.json({
        ok: true,
        action: matches.length === 1 ? 'return' : 'select_return',
        request: matches[0],
        matches
      });
    }

    const [[request]] = await db.query(
      `SELECT r.*, e.name AS equipment_name, e.equipment_code, e.image, e.location,
              u.full_name AS borrower_name, u.role AS borrower_role, u.program, u.id_number, u.email, u.photo
       FROM requests r
       JOIN equipment e ON e.id = r.equipment_id
       JOIN users u ON u.id = r.user_id
       WHERE r.request_code = ?`,
      [payload.code]
    );

    if (!request) {
      return res.json({ ok: false, message: 'No matching request found for this QR code.' });
    }
    if (req.session.user.role === 'staff' && !['ready_for_pickup', 'borrowed'].includes(request.status)) {
      return res.status(409).json({ ok: false, message: 'Staff can only process approved pickups or active equipment returns.' });
    }

    const [[borrowing]] = await db.query('SELECT * FROM borrowings WHERE request_id = ?', [request.id]);

    let action = null;
    if (request.status === 'ready_for_pickup') action = 'release';
    else if (['borrowed', 'overdue'].includes(request.status) || (borrowing && ['active', 'overdue'].includes(borrowing.status))) action = 'return';

    res.json({ ok: true, request, borrowing, action });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: 'Could not process that code.' });
  }
};

exports.qrScanConfirm = async (req, res) => {
  const { requestId, action, condition, remarks } = req.body;
  const { releaseBorrowing, returnBorrowing } = require('../utils/transactions');

  try {
    if (action === 'release') {
      if (!['admin', 'staff'].includes(req.session.user.role)) {
        return res.status(403).json({ ok: false, message: 'Only staff or administrators can release equipment.' });
      }
      await releaseBorrowing(requestId, req.session.user.id, req);
      return res.json({ ok: true, message: 'Equipment released. Transaction recorded.' });
    }

    if (action === 'return') {
      if (!['admin', 'staff'].includes(req.session.user.role)) {
        return res.status(403).json({ ok: false, message: 'Only staff or administrators can process equipment returns.' });
      }
      const [[borrowing]] = await db.query('SELECT id FROM borrowings WHERE request_id = ?', [requestId]);
      if (!borrowing) return res.json({ ok: false, message: 'No active borrowing found for this request.' });
      const result = await returnBorrowing(borrowing.id, req.session.user.id, condition || 'Good', remarks, req);
      return res.json({ ok: true, message: 'Return successfully recorded.', flaggedForMaintenance: result.needsMaintenance });
    }

    return res.json({ ok: false, message: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return res.json({ ok: false, message: err.message || 'Transaction failed.' });
  }
};

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------
exports.notifications = async (req, res) => {
  const userId = req.session.user.id;
  const [items] = await db.query(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
    [userId]
  );
  res.render('student/notifications', { title: 'Notifications', active: 'notifications', items });
};

exports.markNotificationRead = async (req, res) => {
  await db.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  res.redirect('back');
};

exports.markNotificationUnread = async (req, res) => {
  await db.query('UPDATE notifications SET is_read = 0 WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  res.redirect('back');
};

exports.markAllNotificationsRead = async (req, res) => {
  await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.user.id]);
  req.flash('success', 'All notifications marked as read.');
  res.redirect('/notifications');
};

exports.deleteNotification = async (req, res) => {
  await db.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  req.flash('success', 'Notification deleted.');
  res.redirect('/notifications');
};

exports.deleteAllNotifications = async (req, res) => {
  await db.query('DELETE FROM notifications WHERE user_id = ?', [req.session.user.id]);
  req.flash('success', 'All notifications deleted.');
  res.redirect('/notifications');
};

// ---------------------------------------------------------------------------
// BORROWING HISTORY
// ---------------------------------------------------------------------------
exports.borrowingHistory = async (req, res) => {
  const userId = req.session.user.id;
  const { q, from, to, status } = req.query;

  let where = ['r.user_id = ?'];
  const params = [userId];

  if (q) {
    where.push('(e.name LIKE ? OR r.request_code LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (from) { where.push('r.date_needed >= ?'); params.push(from); }
  if (to) { where.push('r.date_needed <= ?'); params.push(to); }
  if (status && status !== 'all') { where.push('r.status = ?'); params.push(status); }

  const [rows] = await db.query(
    `SELECT r.*, e.name AS equipment_name, e.equipment_code, b.borrow_date, b.return_date, b.condition_after
     FROM requests r JOIN equipment e ON e.id = r.equipment_id
     LEFT JOIN borrowings b ON b.request_id = r.id
     WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 200`,
    params
  );

  res.render('student/borrowing-history', {
    title: 'Borrowing History',
    active: 'history',
    rows,
    filters: { q: q || '', from: from || '', to: to || '', status: status || 'all' }
  });
};

// ---------------------------------------------------------------------------
// PROFILE
// ---------------------------------------------------------------------------
exports.profile = async (req, res) => {
  const userId = req.session.user.id;
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

  const [[stats]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM borrowings WHERE user_id = ?) AS total_borrowings,
       (SELECT COUNT(*) FROM borrowings WHERE user_id = ? AND status IN ('active','overdue')) AS active_borrowings,
       (SELECT COUNT(*) FROM requests WHERE user_id = ? AND status = 'completed') AS completed_borrowings,
       (SELECT COUNT(*) FROM borrowings
        WHERE user_id = ? AND (
          status = 'overdue' OR (return_date IS NOT NULL AND return_date > due_date)
        )) AS overdue_records`,
    [userId, userId, userId, userId]
  );

  res.render('student/profile', { title: 'My Profile', active: 'profile', profileUser: user, stats });
};

exports.updateProfile = async (req, res) => {
  const userId = req.session.user.id;
  const { full_name, email, contact_number, program, department } = req.body;

  await db.query(
    'UPDATE users SET full_name = ?, email = ?, contact_number = ?, program = ?, department = ? WHERE id = ?',
    [full_name, email, contact_number, program, department, userId]
  );

  if (req.file) {
    await db.query('UPDATE users SET photo = ? WHERE id = ?', [`/uploads/avatars/${req.file.filename}`, userId]);
    req.session.user.photo = `/uploads/avatars/${req.file.filename}`;
  }

  req.session.user.full_name = full_name;
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/profile');
};
