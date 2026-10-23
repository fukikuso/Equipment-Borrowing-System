const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const authController = require('../utils/catchAsync').wrapAll(require('../controllers/authController'));
const { redirectIfAuthed } = require('../middleware/auth');

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'Too many password reset attempts. Please wait 15 minutes and try again.');
    res.redirect(req.path.startsWith('/reset-password') ? req.path : '/forgot-password');
  }
});

router.get('/login', redirectIfAuthed, authController.showLogin);
router.post('/login', authController.login);
router.get('/register', redirectIfAuthed, authController.showRegister);
router.post('/register', redirectIfAuthed, authController.register);
router.get('/logout', authController.logout);
router.get('/forgot-password', redirectIfAuthed, authController.showForgotPassword);
router.post('/forgot-password', passwordResetLimiter, authController.forgotPassword);
router.get('/reset-password/:token', redirectIfAuthed, authController.showResetPassword);
router.post('/reset-password/:token', redirectIfAuthed, passwordResetLimiter, authController.resetPassword);

module.exports = router;
