const dayjs = require('dayjs');
const db = require('../config/db');
const { logAudit } = require('./audit');
const { notify } = require('./audit');
const { checkAvailability } = require('./statusEngine');

function genToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

/** Admin marks a submitted request as being actively reviewed. */
async function markUnderReview(requestId, staffId, req) {
  await db.query('UPDATE requests SET status = "under_review" WHERE id = ? AND status = "submitted"', [requestId]);
  await logAudit(staffId, `Marked request #${requestId} as Under Review`, 'Requests', '', req);
}

/** APPROVE a request: re-validates availability, reserves the equipment, notifies the borrower. */
async function approveRequest(requestId, staffId, req) {
  const [[request]] = await db.query('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) throw new Error('Request not found.');
  if (!['submitted', 'under_review'].includes(request.status)) {
    throw new Error('Only pending requests can be approved.');
  }

  const availability = await checkAvailability(
    request.equipment_id,
    request.quantity,
    request.date_needed,
    request.expected_return_date,
    request.id
  );
  if (!availability.ok) throw new Error(availability.reason);

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await db.query(
    'UPDATE requests SET status = "ready_for_pickup", reviewed_by = ?, reviewed_at = ?, ready_at = ? WHERE id = ?',
    [staffId, now, now, requestId]
  );

  const [[equipment]] = await db.query('SELECT name FROM equipment WHERE id = ?', [request.equipment_id]);

  await notify(
    request.user_id,
    'approved',
    'Request approved',
    `Your request for ${equipment.name} has been approved and is ready for pickup.`,
    requestId
  );
  await logAudit(staffId, `Approved request #${request.request_code}`, 'Requests', `Equipment: ${equipment.name}`, req);

  return request;
}

/** REJECT a request with a required reason. */
async function rejectRequest(requestId, staffId, reason, req) {
  const [[request]] = await db.query('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) throw new Error('Request not found.');
  if (!['submitted', 'under_review'].includes(request.status)) {
    throw new Error('Only pending requests can be rejected.');
  }

  await db.query(
    'UPDATE requests SET status = "rejected", rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
    [reason, staffId, requestId]
  );

  const [[equipment]] = await db.query('SELECT name FROM equipment WHERE id = ?', [request.equipment_id]);

  await notify(
    request.user_id,
    'rejected',
    'Request rejected',
    `Your request for ${equipment.name} was rejected: ${reason}`,
    requestId
  );
  await logAudit(staffId, `Rejected request #${request.request_code}`, 'Requests', reason, req);

  return request;
}

/**
 * RELEASE (borrow): staff scans/confirms an approved request. Creates the
 * borrowing record, decrements available stock, and starts the due-date clock.
 */
async function releaseBorrowing(requestId, staffId, req) {
  const [[request]] = await db.query('SELECT * FROM requests WHERE id = ?', [requestId]);
  if (!request) throw new Error('Request not found.');
  if (!['ready_for_pickup'].includes(request.status)) {
    throw new Error('This request is not ready for pickup.');
  }

  const [[equipment]] = await db.query('SELECT * FROM equipment WHERE id = ?', [request.equipment_id]);
  if (equipment.quantity_available < request.quantity) {
    throw new Error('Not enough units currently available to release.');
  }

  const dueDate = `${request.expected_return_date} ${request.expected_return_time || '17:00:00'}`;
  const token = genToken();

  await db.query(
    `INSERT INTO borrowings (request_id, user_id, equipment_id, qr_token, borrow_date, due_date, condition_before, released_by, status)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, 'active')`,
    [request.id, request.user_id, request.equipment_id, token, dueDate, equipment.condition_status, staffId]
  );

  await db.query('UPDATE equipment SET quantity_available = quantity_available - ? WHERE id = ?', [request.quantity, equipment.id]);
  await db.query('UPDATE requests SET status = "borrowed" WHERE id = ?', [request.id]);

  await notify(
    request.user_id,
    'info',
    'Equipment released',
    `${equipment.name} has been released to you. Please return it by the due date.`,
    request.id
  );
  await logAudit(staffId, `Released ${equipment.name} for request #${request.request_code}`, 'Borrowings', `Borrower ID ${request.user_id}`, req);

  return { requestId: request.id };
}

/**
 * RETURN: staff records condition. Good/minor-damage units return to the
 * available pool; damaged/missing units are auto-flagged for maintenance.
 */
async function returnBorrowing(borrowingId, staffId, condition, remarks, req) {
  const [[borrowing]] = await db.query('SELECT * FROM borrowings WHERE id = ?', [borrowingId]);
  if (!borrowing) throw new Error('Borrowing record not found.');
  if (borrowing.status === 'returned') throw new Error('This item has already been returned.');

  const [[equipment]] = await db.query('SELECT * FROM equipment WHERE id = ?', [borrowing.equipment_id]);
  const [[request]] = await db.query('SELECT * FROM requests WHERE id = ?', [borrowing.request_id]);

  await db.query(
    `UPDATE borrowings SET return_date = NOW(), condition_after = ?, remarks = ?, received_by = ?, status = 'returned' WHERE id = ?`,
    [condition, remarks || null, staffId, borrowingId]
  );
  await db.query('UPDATE requests SET status = "completed" WHERE id = ?', [borrowing.request_id]);

  const needsMaintenance = condition === 'Damaged' || condition === 'Missing Parts';

  if (needsMaintenance) {
    await db.query('UPDATE equipment SET maintenance_status = "Under Maintenance" WHERE id = ?', [equipment.id]);
    await db.query(
      `INSERT INTO maintenance_logs (equipment_id, problem, reported_by, date_reported, status, notes)
       VALUES (?, ?, ?, CURDATE(), 'Scheduled', ?)`,
      [equipment.id, `Reported as "${condition}" upon return`, staffId, remarks || null]
    );
    await notify(null, 'maintenance', 'Equipment flagged for maintenance', `${equipment.name} was returned as "${condition}" and has been flagged for maintenance.`, null);
  } else {
    // Good or Minor Damage: unit goes back into the available pool.
    await db.query('UPDATE equipment SET quantity_available = quantity_available + ? WHERE id = ?', [request.quantity, equipment.id]);
  }

  await notify(
    borrowing.user_id,
    'returned',
    'Return recorded',
    `Your return of ${equipment.name} has been recorded as "${condition}". Thank you!`,
    borrowing.request_id
  );
  await logAudit(
    staffId,
    `Processed return of ${equipment.name} for request #${request.request_code}`,
    'Returns',
    `Condition: ${condition}${needsMaintenance ? ' — flagged for maintenance' : ''}`,
    req
  );

  return { needsMaintenance };
}

module.exports = { markUnderReview, approveRequest, rejectRequest, releaseBorrowing, returnBorrowing, genToken };
