const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// CRITICAL: CORS must come BEFORE helmet
// Allow all origins for development
app.use(cors({
  origin: true, // This allows any origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight requests for all routes
app.options('*', cors());

// Security middleware - configured to work with CORS
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false
}));

// Body parser - must come BEFORE routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add request logging middleware for debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  next();
});

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, '../public')));

// Static files (for uploads)
app.use('/uploads', express.static('uploads'));

// API Routes - these must come after CORS and body parser
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/passenger', require('./routes/passenger.routes'));
app.use('/api/dispatcher', require('./routes/dispatcher.routes'));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BanTrans TMS API is running',
    timestamp: new Date().toISOString(),
    cors: 'enabled'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to BanTrans TMS API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      passenger: '/api/passenger',
      dispatcher: '/api/dispatcher',
      login: '/login.html',
      demo: '/frontend-demo.html'
    }
  });
});

// Fallback for frontend routes
app.get('*', (req, res, next) => {
  // If it's an API route, let it fall through to 404
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // Try to serve the requested file
  const filePath = path.join(__dirname, '../public', req.path);
  res.sendFile(filePath, (err) => {
    if (err) {
      // If file not found, redirect to login
      res.redirect('/login.html');
    }
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found',
    path: req.path
  });
});

// Error handler
app.use(errorHandler);

module.exports = app;