const jwt = require('jsonwebtoken');

module.exports = function authMiddleware(req, res, next) {
  // Get token from the Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    // Verify the token using your JWT secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // attach user info to request
    next();
  } catch (err) {
    // 401, not 403: the request is unauthenticated rather than forbidden, which
    // is how the client tells an expired session apart from a permission denial.
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};