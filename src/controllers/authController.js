const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const pool        = require('../config/database');
const { sendVerificationEmail, sendWelcomeEmail } = require('../services/emailService');
const {
  escapeHtml,
  escapeJsString,
  assertPassword,
  MIN_PASSWORD_LENGTH,
} = require('../utils/security');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

// REGISTER
async function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }

  const passwordError = assertPassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    // Check if email already exists
    const existing = await pool.query(
      'SELECT id, is_verified FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (!user.is_verified) {
        return res.status(409).json({
          error: 'Account exists but not verified. Check your email for the verification link.',
        });
      }
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password
    const salt         = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generate verification token
    const verifyToken   = crypto.randomBytes(32).toString('hex');
    const tokenExpires  = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save user — not verified yet
    const result = await pool.query(
      `INSERT INTO users 
         (name, email, password, is_verified, verify_token, verify_token_expires)
       VALUES ($1, $2, $3, FALSE, $4, $5)
       RETURNING id, name, email`,
      [name, email.toLowerCase(), passwordHash, verifyToken, tokenExpires]
    );

    const user = result.rows[0];

    // Create streak record
    await pool.query(
      'INSERT INTO streaks (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
      [user.id]
    );

    // Send verification email. If delivery fails, keep the account so the user
    // can resend after the mail configuration is fixed.
    try {
      await sendVerificationEmail(user.email, user.name, verifyToken);
    } catch (emailErr) {
      console.error('[register:sendVerificationEmail]', emailErr.cause || emailErr);
      return res.status(202).json({
        message: 'Account created, but the verification email could not be sent.',
        email: user.email,
        emailDeliveryFailed: true,
        error: emailErr.publicMessage || 'Verification email could not be sent. Please try resending it later.',
      });
    }

    res.status(201).json({
      message: 'Account created! Please check your email to verify your account before logging in.',
      email:   user.email,
    });

  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
}

// VERIFY EMAIL
async function verifyEmail(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(errorPage('Missing verification token.'));
  }

  try {
    // Find user with this token
    const result = await pool.query(
      `SELECT id, name, email, is_verified, verify_token_expires
       FROM users
       WHERE verify_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).send(errorPage('Invalid verification link.'));
    }

    const user = result.rows[0];

    if (user.is_verified) {
      return res.send(successPage(user.name, 'already verified'));
    }

    // Check if token has expired
    if (new Date() > new Date(user.verify_token_expires)) {
      return res.status(400).send(errorPage('Verification link has expired. Please register again.'));
    }

    // Mark as verified
    await pool.query(
      `UPDATE users
       SET is_verified = TRUE, verify_token = NULL, verify_token_expires = NULL
       WHERE id = $1`,
      [user.id]
    );

    await sendWelcomeEmail(user.email, user.name);

    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1, $2, $3, 'welcome')`,
      [
        user.id,
        'Welcome to CrackJAMB',
        `Nagode ${user.name}! Your account is verified. Start with a topic, then try a quiz.`,
      ]
    );

    // Return success HTML page
    res.send(successPage(user.name, 'verified'));

  } catch (err) {
    console.error('[verifyEmail]', err);
    res.status(500).send(errorPage('Verification failed. Please try again.'));
  }
}

// RESEND VERIFICATION EMAIL
async function resendVerification(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, is_verified, verify_token, verify_token_expires
       FROM users
       WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      // Same message as a successful send so callers cannot probe for accounts.
      return res.json({ message: 'If an account needs verification, a link has been sent.' });
    }

    const user = result.rows[0];

    if (user.is_verified) {
      return res.json({ message: 'If an account needs verification, a link has been sent.' });
    }

    let verifyToken = user.verify_token;
    const tokenIsValid =
      verifyToken &&
      user.verify_token_expires &&
      new Date(user.verify_token_expires) > new Date();

    if (!tokenIsValid) {
      verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await pool.query(
        `UPDATE users
         SET verify_token = $1, verify_token_expires = $2
         WHERE id = $3`,
        [verifyToken, tokenExpires, user.id]
      );
    }

    await sendVerificationEmail(user.email, user.name, verifyToken);

    res.json({ message: 'If an account needs verification, a link has been sent.' });

  } catch (err) {
    console.error('[resendVerification]', err);
    res.status(err.statusCode || 500).json({
      error: err.publicMessage || 'Could not resend verification email.',
    });
  }
}

// LOGIN
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    // Check if email is verified
    if (!user.is_verified) {
      return res.status(403).json({
        error:    'Please verify your email before logging in.',
        verified: false,
        email:    user.email,
      });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate token
    const isAdmin = Boolean(user.is_admin);
    const token = jwt.sign(
      { id: user.id, email: user.email, is_admin: isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      message: isAdmin ? 'Admin login successful.' : 'Login successful. Ka yi kyau!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: isAdmin,
      },
    });

  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}

// GET CURRENT USER
async function getMe(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, email, is_verified, created_at,
              exam_date, selected_subjects, avatar_uri, onboarding_complete, is_admin
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];
    let selectedSubjects = ['english'];
    try {
      const parsed = user.selected_subjects ? JSON.parse(user.selected_subjects) : [];
      if (Array.isArray(parsed) && parsed.length > 0) selectedSubjects = parsed;
    } catch {
      selectedSubjects = ['english'];
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_verified: user.is_verified,
        created_at: user.created_at,
        examDate: user.exam_date,
        selectedSubjects,
        avatarUri: user.avatar_uri,
        onboardingComplete: Boolean(user.onboarding_complete),
        is_admin: Boolean(user.is_admin),
      },
    });

  } catch (err) {
    console.error('[getMe]', err);
    res.status(500).json({ error: 'Could not fetch user.' });
  }
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const result = await pool.query(
      `SELECT id, name, email FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    // Always return success even if email not found (security)
    if (result.rows.length === 0) {
      return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
      [resetToken, expires, user.id]
    );

    const BASE = process.env.APP_BASE_URL || 'http://localhost:5000';
    const resetUrl = `${BASE}/api/auth/reset-password?token=${resetToken}`;

    const { sendPasswordResetEmail } = require('../services/emailService');
    await sendPasswordResetEmail(user.email, user.name, resetUrl);

    res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    console.error('[forgotPassword]', err);
    res.status(500).json({ error: 'Could not send reset email. Please try again later.' });
  }
}

async function resetPasswordPage(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(errorPage('Missing reset token. Please request a new password reset link.'));
  }

  // Check token is valid before showing the form
  try {
    const result = await pool.query(
      `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).send(errorPage('This reset link is invalid or has expired. Please request a new one.'));
    }
  } catch (err) {
    console.error('[resetPasswordPage]', err);
    return res.status(500).send(errorPage('Something went wrong. Please try again.'));
  }

  const BASE = process.env.APP_BASE_URL || 'http://localhost:5000';

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>CrackJAMB — Reset Password</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; background: #f4f6fb;
               display: flex; justify-content: center; align-items: center;
               min-height: 100vh; padding: 16px; }
        .card { background: #fff; border-radius: 16px; padding: 36px 28px;
                max-width: 420px; width: 100%;
                box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .logo { text-align: center; font-size: 20px; font-weight: 800;
                letter-spacing: 1px; text-transform: uppercase;
                color: #1b2a4a; margin-bottom: 16px; }
        h1 { color: #1b2a4a; text-align: center; font-size: 22px; margin-bottom: 6px; }
        p  { color: #6b7c9a; text-align: center; font-size: 14px; margin-bottom: 24px; }
        label { display: block; font-size: 13px; font-weight: 700;
                color: #1b2a4a; margin-bottom: 6px; }
        input { width: 100%; padding: 13px 16px; border: 1.5px solid #dde3ef;
                border-radius: 10px; font-size: 15px; color: #1b2a4a;
                background: #f4f6fb; margin-bottom: 14px; outline: none; }
        input:focus { border-color: #1b2a4a; }
        button { width: 100%; padding: 14px; background: #1b2a4a; color: #fff;
                 border: none; border-radius: 10px; font-size: 15px;
                 font-weight: 800; cursor: pointer; margin-top: 4px; }
        button:hover { background: #2e4a7a; }
        .error { color: #c0392b; font-size: 13px; margin-top: -8px;
                 margin-bottom: 10px; display: none; }
        .success { background: #eafaf1; border: 1px solid #27ae60; border-radius: 10px;
                   padding: 14px; color: #1e8449; font-size: 14px; text-align: center;
                   display: none; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">CrackJAMB</div>
        <h1>Reset your password</h1>
        <p>Enter a new password for your CrackJAMB account.</p>
        <form id="resetForm">
          <label>New password</label>
          <input type="password" id="password" placeholder="Min. ${MIN_PASSWORD_LENGTH} characters" required minlength="${MIN_PASSWORD_LENGTH}" />
          <label>Confirm new password</label>
          <input type="password" id="confirmPassword" placeholder="Re-enter new password" required />
          <div class="error" id="errorMsg"></div>
          <button type="submit" id="submitBtn">Reset Password</button>
        </form>
        <div class="success" id="successMsg">
          ✓ Password reset! You can now open the CrackJAMB app and login.
        </div>
      </div>
      <script>
        document.getElementById('resetForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const password        = document.getElementById('password').value;
          const confirmPassword = document.getElementById('confirmPassword').value;
          const errorMsg        = document.getElementById('errorMsg');
          const successMsg      = document.getElementById('successMsg');
          const submitBtn       = document.getElementById('submitBtn');
          errorMsg.style.display = 'none';

          if (password !== confirmPassword) {
            errorMsg.textContent   = 'Passwords do not match.';
            errorMsg.style.display = 'block';
            return;
          }
          if (password.length < ${MIN_PASSWORD_LENGTH}) {
            errorMsg.textContent   = 'Password must be at least ${MIN_PASSWORD_LENGTH} characters.';
            errorMsg.style.display = 'block';
            return;
          }

          submitBtn.textContent = 'Resetting…';
          submitBtn.disabled    = true;

          try {
            const res = await fetch('${escapeJsString(BASE)}/api/auth/reset-password', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ token: '${escapeJsString(token)}', password }),
            });
            const data = await res.json();
            if (!res.ok) {
              errorMsg.textContent   = data.error || 'Reset failed. Please try again.';
              errorMsg.style.display = 'block';
              submitBtn.textContent  = 'Reset Password';
              submitBtn.disabled     = false;
            } else {
              document.getElementById('resetForm').style.display = 'none';
              successMsg.style.display = 'block';
            }
          } catch (err) {
            errorMsg.textContent   = 'Network error. Please check your connection.';
            errorMsg.style.display = 'block';
            submitBtn.textContent  = 'Reset Password';
            submitBtn.disabled     = false;
          }
        });
      </script>
    </body>
    </html>
  `);
}

async function resetPassword(req, res) {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }

  const passwordError = assertPassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  try {
    const result = await pool.query(
      `SELECT id FROM users
       WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }

    const salt     = await bcrypt.genSalt(10);
    const hashPwd  = await bcrypt.hash(password, salt);

    // Following the link proves the address belongs to them, so an account
    // that was still pending verification is confirmed here too.
    await pool.query(
      `UPDATE users
       SET password = $1,
           reset_token = NULL,
           reset_token_expires = NULL,
           is_verified = TRUE,
           verify_token = NULL,
           verify_token_expires = NULL
       WHERE id = $2`,
      [hashPwd, result.rows[0].id]
    );

    res.json({ message: 'Password reset successful. You can now login.' });
  } catch (err) {
    console.error('[resetPassword]', err);
    res.status(500).json({ error: 'Could not reset password.' });
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTML PAGE HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function successPage(name, action) {
  const safeName = escapeHtml(name);
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>CrackJAMB — Email Verified</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: Arial, sans-serif; background: #f4f6fb;
               display: flex; justify-content: center; align-items: center;
               min-height: 100vh; margin: 0; }
        .card { background: #fff; border-radius: 16px; padding: 40px;
                text-align: center; max-width: 420px; width: 90%;
                box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .wordmark { font-size: 20px; font-weight: 800; letter-spacing: 1px;
                    text-transform: uppercase; color: #1b2a4a; margin-bottom: 16px; }
        h1 { color: #1b2a4a; margin: 0 0 12px; }
        p  { color: #6b7c9a; line-height: 1.6; }
        .badge { background: #d4ac0d; color: #1b2a4a; font-weight: 800;
                 padding: 6px 16px; border-radius: 20px; font-size: 14px;
                 display: inline-block; margin-top: 8px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="wordmark">CrackJAMB</div>
        <h1>${action === 'already verified' ? 'Already Verified!' : 'Email Verified!'}</h1>
        <p>
          ${action === 'already verified'
            ? `${safeName}, your account is already verified. Open the CrackJAMB app and login.`
            : `Nagode ${safeName}! Your account is now active. Open the CrackJAMB app and login to start studying.`
          }
        </p>
        <div class="badge">Ka yi kyau!</div>
      </div>
    </body>
    </html>
  `;
}

function errorPage(message) {
  const safeMessage = escapeHtml(message);
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>CrackJAMB — Verification Failed</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: Arial, sans-serif; background: #f4f6fb;
               display: flex; justify-content: center; align-items: center;
               min-height: 100vh; margin: 0; }
        .card { background: #fff; border-radius: 16px; padding: 40px;
                text-align: center; max-width: 420px; width: 90%;
                box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .wordmark { font-size: 20px; font-weight: 800; letter-spacing: 1px;
                    text-transform: uppercase; color: #1b2a4a; margin-bottom: 16px; }
        h1 { color: #e74c3c; margin: 0 0 12px; }
        p  { color: #6b7c9a; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="wordmark">CrackJAMB</div>
        <h1>Verification Failed</h1>
        <p>${safeMessage}</p>
      </div>
    </body>
    </html>
  `;
}

module.exports = { register, verifyEmail, resendVerification, login, getMe, forgotPassword, resetPassword, resetPasswordPage };
