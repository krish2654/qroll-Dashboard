// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const classRoutes = require('./routes/classes');
const lectureRoutes = require('./routes/lectures');
const sessionRoutes = require('./routes/sessions');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration - Allow multiple origins
const allowedOrigins = [
  'https://qroll-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'https://localhost:5173',
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

// Static files (removed uploads as file feature is removed)

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
    features: [
      'Google Authentication',
      'Class Management', 
      'Live Lectures with QR',
      'Attendance Tracking'
    ],
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
      classes: '/api/classes',
      lectures: '/api/lectures',
      sessions: '/api/sessions',
      health: '/api'
    },
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/lectures', lectureRoutes);
app.use('/api/sessions', sessionRoutes);

// Join session route (for QR code scanning)
app.get('/join-session/:qrToken', (req, res) => {
  const { qrToken } = req.params;
  
  // Redirect to frontend with the QR token
  const redirectUrl = `${process.env.FRONTEND_URL}/join-session/${qrToken}`;
  
  res.redirect(redirectUrl);
});

// Removed file sharing routes as file feature is removed

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
  
  // Removed file upload error handling as file feature is removed
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Cleanup expired lectures every hour
setInterval(async () => {
  try {
    const Lecture = require('./models/Lecture');
    await Lecture.cleanupExpiredTokens();
  } catch (error) {
    console.error('Error cleaning up expired lectures:', error);
  }
}, 60 * 60 * 1000); // 1 hour

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
⚡ Features: Auth, Classes, Lectures, Attendance
⏰ Started at: ${new Date().toISOString()}
  `);
});

module.exports = app;
