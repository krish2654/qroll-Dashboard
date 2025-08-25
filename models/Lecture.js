// models/Lecture.js
const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  subjectId: {
    type: String,
    required: true // Subject code from the class subjects array
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number, // in minutes
    default: 60
  },
  qrToken: {
    type: String,
    unique: true,
    sparse: true
  },
  qrCode: {
    type: String // Base64 encoded QR code image
  },
  qrTokenExpiry: {
    type: Date
  },
  studentsJoined: {
    type: Number,
    default: 0
  },
  joinUrl: {
    type: String
  },
  location: {
    latitude: Number,
    longitude: Number,
    radius: { type: Number, default: 100 }
  },
  settings: {
    requireLocation: {
      type: Boolean,
      default: false
    },
    allowLateJoin: {
      type: Boolean,
      default: true
    },
    autoEnd: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
lectureSchema.index({ classId: 1 });
lectureSchema.index({ subjectId: 1 });
lectureSchema.index({ qrToken: 1 });
lectureSchema.index({ status: 1 });
lectureSchema.index({ startTime: 1 });

// Generate unique QR token with 5-second expiry
lectureSchema.methods.generateQRToken = function() {
  const token = Math.random().toString(36).substring(2, 15) + 
                Math.random().toString(36).substring(2, 15);
  this.qrToken = token;
  this.qrTokenExpiry = new Date(Date.now() + 5 * 1000); // 5 seconds
  return token;
};

// Check if QR token is valid
lectureSchema.methods.isQRTokenValid = function() {
  return this.qrToken && this.qrTokenExpiry && new Date() < this.qrTokenExpiry;
};

// Auto-refresh token every 5 seconds for active lectures
lectureSchema.methods.refreshToken = async function() {
  if (this.status === 'active') {
    this.generateQRToken();
    await this.save();
    return this.qrToken;
  }
  return null;
};

// Clean up expired tokens
lectureSchema.statics.cleanupExpiredTokens = async function() {
  const result = await this.updateMany(
    { qrTokenExpiry: { $lt: new Date() } },
    { $unset: { qrToken: 1, qrTokenExpiry: 1, qrCode: 1 } }
  );
  return result;
};


module.exports = mongoose.model('Lecture', lectureSchema);