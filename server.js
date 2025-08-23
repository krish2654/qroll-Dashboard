// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration - Allow multiple origins
const allowedOrigins = [
  'https://qroll-frontend.vercel.app',
  'http://51.20.108.121:5000/',
  // Add any other domains you might use
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()} - Origin: ${req.get('Origin') || 'No Origin'}`);
  next();
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(() => {
  console.log('✅ Connected to MongoDB Atlas');
  console.log('📊 Database:', mongoose.connection.name);
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  process.exit(1);
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🎯 Qroll Backend API is running!',
    version: '1.0.0',
    domain: 'https://qroll.duckdns.org',
    timestamp: new Date().toISOString()
  });
});

// API health check endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: '🎯 Qroll API is working!',
    version: '1.0.0',
    domain: 'https://qroll.duckdns.org',
    endpoints: {
      auth: '/api/auth',
      health: '/api'
    },
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('📊 Database connection closed.');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 Qroll Backend Server Started!
📍 Port: ${PORT}
🌐 Environment: ${process.env.NODE_ENV}
🔗 Domain: https://qroll.duckdns.org
🎯 Frontend URL: ${process.env.FRONTEND_URL}
📊 Database: Connected to MongoDB Atlas
⏰ Started at: ${new Date().toISOString()}
  `);
});

module.exports = app;