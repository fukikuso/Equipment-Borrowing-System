const dayjs = require('dayjs');

/** Pad a running number into REQ-00001 / EQ-001 style codes */
function padCode(prefix, number, width) {
  return `${prefix}-${String(number).padStart(width, '0')}`;
}

function nextEquipmentCode(lastNumber) {
  return padCode('EQ', lastNumber + 1, 3);
}

function nextRequestCode(lastNumber) {
  return padCode('REQ', lastNumber + 1, 5);
}

function formatDate(date, fmt = 'MMM D, YYYY') {
  if (!date) return '—';
  return dayjs(date).format(fmt);
}

function formatDateTime(date, fmt = 'MMM D, YYYY · h:mm A') {
  if (!date) return '—';
  return dayjs(date).format(fmt);
}

function formatTime(date, fmt = 'h:mm A') {
  if (!date) return '—';
  return dayjs(date).format(fmt);
}

/** Human readable countdown string + urgency flag for due dates */
function countdown(dueDate) {
  if (!dueDate) return { text: '—', urgent: false, overdue: false };
  const now = dayjs();
  const due = dayjs(dueDate);
  const diffMinutes = due.diff(now, 'minute');

  if (diffMinutes < 0) {
    const days = Math.abs(due.diff(now, 'day'));
    return { text: `${days} day${days !== 1 ? 's' : ''} past due`, urgent: true, overdue: true };
  }

  const days = Math.floor(diffMinutes / (60 * 24));
  const hours = Math.floor((diffMinutes % (60 * 24)) / 60);

  if (days >= 1) {
    return { text: `${days} day${days !== 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''}`, urgent: days < 1, overdue: false };
  }
  return { text: `${hours} hour${hours !== 1 ? 's' : ''}`, urgent: true, overdue: false };
}

/** Maps a status string to a badge color class used across views */
const STATUS_BADGE = {
  available: 'badge-success',
  borrowed: 'badge-info',
  reserved: 'badge-warning',
  under_maintenance: 'badge-danger',
  active: 'badge-info',
  submitted: 'badge-neutral',
  under_review: 'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
  ready_for_pickup: 'badge-info',
  returned: 'badge-neutral',
  completed: 'badge-success',
  overdue: 'badge-danger',
  cancelled: 'badge-neutral',
  pending: 'badge-warning',
  good: 'badge-success',
  'minor damage': 'badge-warning',
  damaged: 'badge-danger',
  'missing parts': 'badge-danger',
  operational: 'badge-success',
  'scheduled maintenance': 'badge-warning',
  'under maintenance': 'badge-danger',
  'repair needed': 'badge-danger',
  retired: 'badge-neutral',
  active_account: 'badge-success',
  inactive: 'badge-neutral'
};

function badgeClass(status) {
  if (!status) return 'badge-neutral';
  return STATUS_BADGE[String(status).toLowerCase()] || 'badge-neutral';
}

function statusLabel(status) {
  if (!status) return '';
  return String(status)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(date) {
  if (!date) return '—';
  const now = dayjs();
  const then = dayjs(date);
  const minutes = now.diff(then, 'minute');
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = now.diff(then, 'hour');
  if (hours < 24) return `${hours}h ago`;
  const days = now.diff(then, 'day');
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

module.exports = {
  padCode,
  nextEquipmentCode,
  nextRequestCode,
  formatDate,
  formatDateTime,
  formatTime,
  countdown,
  badgeClass,
  statusLabel,
  timeAgo
};
