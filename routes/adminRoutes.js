const express = require('express');
const router = express.Router();
const adminController = require('../utils/catchAsync').wrapAll(require('../controllers/adminController'));
const { requireAuth, requireRole } = require('../middleware/auth');
const { equipmentUpload } = require('../middleware/upload');

router.use(requireAuth, requireRole('admin', 'staff'));

router.get('/dashboard', adminController.dashboard);

// Requests
router.get('/requests', adminController.requestsList);
router.get('/requests/:id', adminController.requestDetails);
router.post('/requests/:id/under-review', adminController.markUnderReview);
router.post('/requests/:id/approve', adminController.approveRequest);
router.post('/requests/:id/reject', adminController.rejectRequest);
router.post('/requests/:id/release', adminController.releaseFromRequest);

// Equipment
router.get('/equipment', adminController.equipmentList);
router.get('/equipment/new', requireRole('admin'), adminController.newEquipmentForm);
router.post('/equipment', requireRole('admin'), equipmentUpload.single('image'), adminController.createEquipment);
router.get('/equipment/:id/edit', requireRole('admin'), adminController.editEquipmentForm);
router.post('/equipment/:id', requireRole('admin'), equipmentUpload.single('image'), adminController.updateEquipment);
router.post('/equipment/:id/archive', requireRole('admin'), adminController.archiveEquipment);
router.post('/equipment/:id/restore', requireRole('admin'), adminController.restoreEquipment);
router.post('/equipment/:id/regenerate-qr', requireRole('admin'), adminController.regenerateQr);
router.post('/equipment/:id/maintenance-status', adminController.updateEquipmentMaintenanceStatus);

// Returns
router.get('/returns', adminController.returnsList);
router.post('/returns/:id', adminController.processReturn);

// Maintenance
router.get('/maintenance', adminController.maintenanceList);
router.post('/maintenance', adminController.createMaintenanceLog);
router.post('/maintenance/:id', adminController.updateMaintenanceStatus);

// Users
router.get('/users', requireRole('admin'), adminController.usersList);
router.get('/users/:id', requireRole('admin'), adminController.userDetails);
router.post('/users/:id', requireRole('admin'), adminController.updateUser);
router.post('/users/:id/toggle-status', requireRole('admin'), adminController.toggleUserStatus);

// Reports
router.get('/reports', requireRole('admin'), adminController.reports);
router.get('/reports/export.csv', requireRole('admin'), adminController.exportReportCsv);

// Audit Trail
router.get('/audit-trail', requireRole('admin'), adminController.auditTrail);

module.exports = router;
