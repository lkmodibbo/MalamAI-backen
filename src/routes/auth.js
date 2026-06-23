const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { register, login, getMe, verifyEmail, resendVerification, forgotPassword, resetPassword } = require('../controllers/authController');

router.post('/register',              register);
router.post('/login',                 login);
router.get('/me',                     authMiddleware, getMe);
router.post('/resend-verification',   resendVerification);
router.get('/verify-email',           verifyEmail);
router.post('/forgot-password',       forgotPassword);
router.post('/reset-password',        resetPassword);

module.exports = router;