const db = require('../config/db');
const { notify } = require('./audit');

/**
 * AUTOMATIC OVERDUE DETECTION
 * Flips any active borrowing whose due date has passed into "overdue",
 * mirrors that onto the parent request, and fires a one-time notification.
 * Cheap enough to run at the top of the dashboard / borrowings routes.
 */
async function refreshOverdueStatuses() {
  const [toFlag] = await db.query(
    `SELECT b.id, b.user_id, b.request_id, e.name AS equipment_name
     FROM borrowings b
     JOIN equipment e ON e.id = b.equipment_id
     WHERE b.status = 'active' AND b.due_date < NOW()`
  );

  for (const row of toFlag) {
    await db.query('UPDATE borrowings SET status = "overdue" WHERE id = ?', [row.id]);
    await db.query('UPDATE requests SET status = "borrowed" WHERE id = ? AND status NOT IN ("returned","completed")', [row.request_id]);
    await notify(
      row.user_id,
      'overdue',
      'Equipment overdue',
      `${row.equipment_name} is now overdue. Please return it as soon as possible.`,
      row.request_id
    );
  }
}

/**
 * DUE-DATE COUNTDOWN + REMINDERS
 * Notifies borrowers once when their item is due within the next 24 hours.
 * Uses a lightweight marker (a matching 'due_soon' notification already sent
 * for that request) so it does not spam on every page load.
 */
async function generateDueSoonNotifications() {
  const [dueSoon] = await db.query(
    `SELECT b.id, b.user_id, b.request_id, e.name AS equipment_name
     FROM borrowings b
     JOIN equipment e ON e.id = b.equipment_id
     WHERE b.status = 'active'
       AND b.due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)`
  );

  for (const row of dueSoon) {
    const [existing] = await db.query(
      `SELECT id FROM notifications WHERE related_request_id = ? AND type = 'due_soon' LIMIT 1`,
      [row.request_id]
    );
    if (existing.length === 0) {
      await notify(
        row.user_id,
        'due_soon',
        'Borrowing due soon',
        `${row.equipment_name} is due within 24 hours. Please prepare to return it.`,
        row.request_id
      );
    }
  }
}

/**
 * RESERVATION CONFLICT DETECTION
 * Counts how many units of an equipment item are already committed
 * (approved / ready / borrowed) inside the requested date window and
 * makes sure at least `quantity` units remain free.
 */
async function checkAvailability(equipmentId, quantity, dateNeeded, expectedReturnDate, excludeRequestId = null) {
  const [[equipment]] = await db.query('SELECT * FROM equipment WHERE id = ?', [equipmentId]);
  if (!equipment) return { ok: false, reason: 'Equipment not found.' };
  if (equipment.status !== 'active') return { ok: false, reason: 'This equipment is no longer available.' };
  if (equipment.maintenance_status !== 'Operational') {
    return { ok: false, reason: 'This equipment is currently under maintenance.' };
  }

  let sql = `SELECT COALESCE(SUM(quantity), 0) AS committed FROM requests
     WHERE equipment_id = ?
       AND status IN ('submitted','under_review','approved','ready_for_pickup','borrowed')
       AND date_needed <= ? AND expected_return_date >= ?`;
  const params = [equipmentId, expectedReturnDate, dateNeeded];

  if (excludeRequestId) {
    sql += ' AND id != ?';
    params.push(excludeRequestId);
  }

  const [[{ committed }]] = await db.query(sql, params);
  const remaining = equipment.quantity_total - committed;

  if (remaining < quantity) {
    return {
      ok: false,
      reason: remaining <= 0
        ? 'This equipment is fully reserved for the selected dates.'
        : `Only ${remaining} unit(s) available for the selected dates.`,
      remaining
    };
  }

  return { ok: true, remaining, equipment };
}

module.exports = { refreshOverdueStatuses, generateDueSoonNotifications, checkAvailability };
