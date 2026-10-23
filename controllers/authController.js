const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const mailer = require('../utils/mailer');
const { logAudit } = require('../utils/audit');

const normalizeRole = (role) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return normalizedRole === 'faculty' ? 'instructor' : normalizedRole;
};

exports.showLogin = (req, res) => {
  res.locals.errorMsg = (res.locals.errorMsg || []).filter(
    (message) => !message.includes('Your account is pending activation')
  );
  res.render('auth/login', { title: 'Login', hideChrome: true });
};

exports.showRegister = (req, res) => {
  res.render('auth/register', {
    title: 'Create Account',
    hideChrome: true,
    formData: { role: 'student' }
  });
};

exports.register = async (req, res) => {
  const formData = {
    full_name: String(req.body.full_name || '').trim(),
    id_number: String(req.body.id_number || '').trim(),
    email: String(req.body.email || '').trim().toLowerCase(),
    department: String(req.body.department || '').trim(),
    program: String(req.body.program || '').trim(),
    role: normalizeRole(req.body.role)
  };
  const { password, confirm_password: confirmPassword } = req.body;
  const renderError = (message) => {
    req.flash('error', message);
    return res.status(400).render('auth/register', {
      title: 'Create Account',
      hideChrome: true,
      formData
    });
  };

  if (!formData.full_name || !formData.id_number || !formData.email || !formData.department || !formData.role || !password || !confirmPassword) {
    return renderError('Please complete all required fields.');
  }
  if (!['student', 'instructor', 'staff'].includes(formData.role)) {
    return renderError('Choose either Student, Instructor, or Staff for registration.');
  }
  if (formData.full_name.length > 150 || formData.id_number.length > 30 || formData.email.length > 150 ||
      formData.department.length > 150 || formData.program.length > 150) {
    return renderError('One or more fields exceed the allowed length.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    return renderError('Please enter a valid email address.');
  }
  if (password.length < 8) {
    return renderError('Password must be at least 8 characters long.');
  }
  if (password !== confirmPassword) {
    return renderError('Passwords do not match.');
  }

  try {
    const [existingUsers] = await db.query(
      'SELECT id FROM users WHERE id_number = ? LIMIT 1',
      [formData.id_number]
    );
    if (existingUsers.length > 0) {
      return renderError('An account with that school ID already exists.');
    }
    const [emailMatches] = await db.query(
      'SELECT id FROM users WHERE email = ? LIMIT 2',
      [formData.email]
    );
    if (emailMatches.length > 0) {
      return renderError('An account with that email already exists. Sign in or contact the administrator.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO users (id_number, password_hash, full_name, email, role, department, program, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [formData.id_number, passwordHash, formData.full_name, formData.email,
        formData.role, formData.department, formData.program || null]
    );

    await logAudit(result.insertId, `Registered ${formData.role} account for ${formData.full_name}`, 'Authentication', `ID ${formData.id_number}`, req);
    req.session.user = {
      id: result.insertId,
      id_number: formData.id_number,
      full_name: formData.full_name,
      role: formData.role,
      department: formData.department,
      program: formData.program || null,
      photo: null,
      email: formData.email
    };
    req.flash('success', 'Your account is ready. Welcome!');
    return res.redirect(formData.role === 'staff' ? '/qr-scanner' : '/dashboard');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return renderError('An account with that school ID already exists.');
    }
    console.error(err);
    return renderError('Could not create your account right now. Please try again.');
  }
};

exports.login = async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  const { password, remember } = req.body;

  if (!identifier || !password) {
    req.flash('error', 'Please enter your School ID or email and password.');
    return res.redirect('/login');
  }

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE id_number = ? OR LOWER(email) = ? LIMIT 2',
      [identifier, identifier.toLowerCase()]
    );
    if (rows.length > 1) {
      req.flash('error', 'Your School ID or email matches multiple accounts. Please contact the administrator.');
      return res.redirect('/login');
    }
    const user = rows[0];

    if (!user) {
      req.flash('error', 'No account found with that School ID or email.');
      return res.redirect('/login');
    }

    if (user.account_status !== 'active') {
      req.flash('error', 'Your account has been deactivated. Please contact the IT Office.');
      return res.redirect('/login');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      req.flash('error', 'Incorrect password. Please try again.');
      return res.redirect('/login');
    }

    req.session.user = {
      id: user.id,
      id_number: user.id_number,
      full_name: user.full_name,
      role: normalizeRole(user.role),
      department: user.department,
      program: user.program,
      photo: user.photo,
      email: user.email
    };

    if (remember) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    await logAudit(user.id, `${user.full_name} logged in`, 'Authentication', `ID ${user.id_number}`, req);

    return res.redirect(req.session.user.role === 'admin' || req.session.user.role === 'staff' ? '/admin/dashboard' : '/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Something went wrong while signing you in. Please try again.');
    return res.redirect('/login');
  }
};

exports.logout = async (req, res) => {
  const user = req.session.user;
  if (user) {
    await logAudit(user.id, `${user.full_name} logged out`, 'Authentication', '', req);
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
};

exports.showForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password', hideChrome: true });
};

exports.forgotPassword = async (req, res) => {
  const idNumber = String(req.body.id_number || '').trim();
  if (!idNumber) {
    req.flash('error', 'Enter your school ID to continue.');
    return res.redirect('/forgot-password');
  }

  const emailService = mailer.createMailer();
  const [users] = await db.query(
    "SELECT id, email FROM users WHERE id_number = ? AND email IS NOT NULL AND email <> '' LIMIT 1",
    [idNumber]
  );

  if (users.length) {
    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
      [user.id, tokenHash]
    );

    try {
      await emailService.sendPasswordReset(user.email, token);
    } catch (err) {
      console.error('[Password Reset Email Error]', err.message);
      await db.query('DELETE FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
    }
  }

  req.flash('success', 'If an account with that ID and a registered email exists, you should receive a password reset link shortly. Check your inbox and spam folder. If no email arrives, contact the IT Office.');
  res.redirect('/login');
};

exports.showResetPassword = async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const [tokens] = await db.query(
    'SELECT id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > NOW() LIMIT 1',
    [tokenHash]
  );

  if (!tokens.length) {
    req.flash('error', 'That password reset link is invalid or has expired. Please request a new one.');
    return res.redirect('/forgot-password');
  }

  res.render('auth/reset-password', {
    title: 'Choose a New Password',
    hideChrome: true,
    token: req.params.token
  });
};

exports.resetPassword = async (req, res) => {
  const { password, confirm_password: confirmPassword } = req.body;
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');

  if (typeof password !== 'string' || password.length < 8) {
    req.flash('error', 'Your new password must be at least 8 characters long.');
    return res.redirect(`/reset-password/${encodeURIComponent(req.params.token)}`);
  }
  if (password !== confirmPassword) {
    req.flash('error', 'The passwords do not match.');
    return res.redirect(`/reset-password/${encodeURIComponent(req.params.token)}`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [tokens] = await connection.query(
      'SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > NOW() FOR UPDATE',
      [tokenHash]
    );

    if (!tokens.length) {
      await connection.rollback();
      req.flash('error', 'That password reset link is invalid or has expired. Please request a new one.');
      return res.redirect('/forgot-password');
    }

    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, tokens[0].user_id]);
    await connection.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [tokens[0].user_id]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  req.flash('success', 'Your password has been reset. Sign in with your new password.');
  res.redirect('/login');
};
