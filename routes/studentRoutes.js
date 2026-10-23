const express = require('express');
const router = express.Router();
const studentController = require('../utils/catchAsync').wrapAll(require('../controllers/studentController'));
const { requireAuth, requireRole } = require('../middleware/auth');
const { documentUpload, avatarUpload } = require('../middleware/upload');

router.use(requireAuth);

function blockRequestingRoles(req, res, next) {
	if (req.session.user.role === 'admin') {
		req.flash('error', 'Admin accounts cannot submit equipment requests.');
		return res.redirect('/admin/dashboard');
	}
	if (req.session.user.role === 'staff') {
		req.flash('error', 'Staff accounts use the QR scanner to process equipment pickup and return.');
		return res.redirect('/qr-scanner');
	}
	return next();
}

function blockBorrowingRoles(req, res, next) {
	if (req.session.user.role === 'staff') {
		req.flash('error', 'Staff accounts use the QR scanner to process equipment pickup and return.');
		return res.redirect('/qr-scanner');
	}
	if (req.session.user.role === 'admin') {
		req.flash('error', 'Admin accounts do not have personal borrowing records.');
		return res.redirect('/admin/dashboard');
	}
	return next();
}

function blockStaffNotifications(req, res, next) {
	if (req.session.user.role === 'staff') {
		req.flash('error', 'Staff accounts use the QR scanner to process equipment pickup and return.');
		return res.redirect('/qr-scanner');
	}
	return next();
}

router.get('/dashboard', (req, res, next) => {
	if (req.session.user.role === 'staff') return res.redirect('/qr-scanner');
	if (req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
	return next();
}, studentController.dashboard);

router.get('/equipment', studentController.equipmentCatalog);
router.get('/equipment/:id', studentController.equipmentDetails);

router.get('/request-equipment', blockRequestingRoles, studentController.newRequestForm);
router.post('/request-equipment', blockRequestingRoles, documentUpload.single('supporting_document'), studentController.createRequest);

router.get('/requests/:id', blockBorrowingRoles, studentController.requestStatus);

router.get('/my-borrowings', blockBorrowingRoles, studentController.myBorrowings);

router.get('/borrowings/:requestId/qr', blockBorrowingRoles, studentController.borrowingQr);

router.get('/qr-scanner', requireRole('staff', 'admin'), studentController.qrScannerPage);
router.post('/qr-scanner/lookup', requireRole('staff', 'admin'), studentController.qrScanLookup);
router.post('/qr-scanner/confirm', requireRole('staff', 'admin'), studentController.qrScanConfirm);

router.get('/notifications', blockStaffNotifications, studentController.notifications);
router.post('/notifications/:id/read', blockStaffNotifications, studentController.markNotificationRead);
router.post('/notifications/:id/unread', blockStaffNotifications, studentController.markNotificationUnread);
router.post('/notifications/mark-all-read', blockStaffNotifications, studentController.markAllNotificationsRead);
router.post('/notifications/:id/delete', blockStaffNotifications, studentController.deleteNotification);
router.post('/notifications/delete-all', blockStaffNotifications, studentController.deleteAllNotifications);

router.get('/borrowing-history', blockBorrowingRoles, studentController.borrowingHistory);

router.get('/profile', studentController.profile);
router.post('/profile', avatarUpload.single('photo'), studentController.updateProfile);

module.exports = router;
