const db = require('../config/db');

/**
 * Records an entry in the audit trail. Never throws — an audit logging
 * failure should never break the primary action the user is performing.
 */
async function logAudit(userId, action, module, details, req) {
  try {
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '—') : '—';
    await db.query(
      'INSERT INTO audit_trail (user_id, action, module, details, ip_address) VALUES (?, ?, ?, ?, ?)',
      [userId || null, action, module, details || null, ip]
    );
  } catch (err) {
    console.error('[Audit] Failed to log action:', err.message);
  }
}

/**
 * Creates a notification for a user. Never throws.
 */
async function notify(userId, type, title, message, relatedRequestId = null) {
  try {
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message, related_request_id) VALUES (?, ?, ?, ?, ?)',
      [userId, type, title, message, relatedRequestId]
    );
  } catch (err) {
    console.error('[Notify] Failed to create notification:', err.message);
  }
}

module.exports = { logAudit, notify };
