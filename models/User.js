const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    unique: true  // This already creates an index
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true  // This already creates an index
  },
  profilePicture: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['teacher', 'student', null],
    default: null,
    index: true  // Only add index for role since it's not unique
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

module.exports = mongoose.model('User', userSchema);