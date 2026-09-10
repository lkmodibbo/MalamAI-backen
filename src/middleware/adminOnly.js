const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    // Still compare to keep timing closer when lengths differ.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function allowSecretKeyBypass() {
  const key = process.env.ADMIN_SECRET_KEY || '';
  if (!key || key.length < 32) return false;
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ADMIN_SECRET_KEY !== 'true') {
    return false;
  }
  return true;
}

/**
 * Admin gate used by /api/admin/*.
 *
 * Prefer a live DB check on the JWT user so demotions take effect immediately.
 * A long ADMIN_SECRET_KEY may act as break-glass automation only when explicitly
 * enabled (and always outside production unless ALLOW_ADMIN_SECRET_KEY=true).
 */
async function adminOnly(req, res, next) {
  try {
    const provided = req.headers['x-admin-key'];
    if (provided && allowSecretKeyBypass()) {
      if (timingSafeEqualString(provided, process.env.ADMIN_SECRET_KEY)) {
        req.user = { id: null, email: 'service-key', is_admin: true, via_secret_key: true };
        return next();
      }
      return res.status(403).json({ error: 'Admin access only.' });
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Admin access only. Please login.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    const result = await pool.query(
      'SELECT id, email, is_admin FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access only.' });
    }

    req.user = { id: user.id, email: user.email, is_admin: true };
    return next();
  } catch (err) {
    console.error('[adminOnly]', err.message);
    return res.status(500).json({ error: 'Could not verify admin access.' });
  }
}

module.exports = adminOnly;
