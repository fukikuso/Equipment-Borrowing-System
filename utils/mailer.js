const nodemailer = require('nodemailer');

function createMailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  const missing = [
    ['SMTP_HOST', SMTP_HOST],
    ['SMTP_USER', SMTP_USER],
    ['SMTP_PASSWORD', SMTP_PASSWORD],
    ['SMTP_FROM', SMTP_FROM]
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Password reset email is not configured. Set ${missing.map(([key]) => key).join(', ')} in .env.`);
  }
  const port = Number(SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT in .env must be a valid port number.');
  }

  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch (err) {
    throw new Error('APP_BASE_URL in .env must be a valid absolute URL.');
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    throw new Error('APP_BASE_URL in .env must use HTTP or HTTPS.');
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
  });

  return {
    async sendPasswordReset(email, token) {
      const resetUrl = new URL(`/reset-password/${encodeURIComponent(token)}`, parsedBaseUrl).toString();
      await transport.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: 'Reset your CSPC Equipment Borrowing System password',
        text: `We received a request to reset your password. Open this link within 30 minutes to choose a new password:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>We received a request to reset your CSPC Equipment Borrowing System password.</p><p><a href="${resetUrl}">Choose a new password</a>. This link expires in 30 minutes and can only be used once.</p><p>If you did not request this, you can ignore this email.</p>`
      });
    }
  };
}

module.exports = { createMailer };
