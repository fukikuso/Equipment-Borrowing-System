/** Blocks access unless a user is logged in. */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.flash('error', 'Please sign in to continue.');
  return res.redirect('/login');
}

/** Blocks access unless the logged-in user's role is in the allowed list. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Please sign in to continue.');
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      req.flash('error', "You don't have permission to access that page.");
      return res.redirect(req.session.user.role === 'admin' || req.session.user.role === 'staff' ? '/admin/dashboard' : '/dashboard');
    }
    return next();
  };
}

/** If already logged in, skip the login page and go straight to the right dashboard. */
function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect(req.session.user.role === 'admin' || req.session.user.role === 'staff' ? '/admin/dashboard' : '/dashboard');
  }
  return next();
}

module.exports = { requireAuth, requireRole, redirectIfAuthed };
