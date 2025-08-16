// routes/auth.js
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Google Login Route
router.post('/google-login', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential is required'
      });
    }

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, name, email, picture } = payload;

    // Check if user exists or create new user
    let user = await User.findOne({ googleId });

    if (!user) {
      // Create new user
      user = new User({
        googleId,
        name,
        email,
        profilePicture: picture
      });
      await user.save();
      console.log('New user created:', email);
    } else {
      // Update existing user's last login
      user.lastLoginAt = new Date();
      user.profilePicture = picture; // Update profile picture if changed
      await user.save();
      console.log('User logged in:', email);
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        role: user.role,
        isNewUser: !user.role // If role is null, user needs to select role
      }
    });

  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        role: user.role,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile',
      error: error.message
    });
  }
});

// Update user role
router.put('/set-role', authenticateToken, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user._id;

    if (!role || !['teacher', 'student'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Valid role is required (teacher or student)'
      });
    }

    // Update user role
    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    );

    console.log(`User ${user.email} role set to: ${role}`);

    res.json({
      success: true,
      message: 'Role updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profilePicture: user.profilePicture,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Set role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update role',
      error: error.message
    });
  }
});

// Logout route (mainly for token cleanup on client side)
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // In a real app, you might want to blacklist the token
    // For now, we'll just return success and let client handle token removal
    
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
});

module.exports = router;