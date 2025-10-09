const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  const { firstname, lastname, email, password, phone_number, role } = req.body;

  try {
    // Check if user exists
    const [existingUsers] = await db.query(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await db.query(
      'INSERT INTO users (firstname, lastname, email, password, phone_number, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [firstname, lastname, email, hashedPassword, phone_number || null, role || 'passenger', 'active']
    );

    const userId = result.insertId;

    // Generate token
    const token = generateToken(userId);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user_id: userId,
        firstname,
        lastname,
        email,
        role: role || 'passenger'
      },
      token
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering user'
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Get user
    const [users] = await db.query(
      'SELECT user_id, firstname, lastname, email, password, role, status FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = users[0];

    // Check if account is active
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Account is not active'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken(user.user_id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user_id: user.user_id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        role: user.role
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in'
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  res.json({
    success: true,
    data: req.user
  });
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};