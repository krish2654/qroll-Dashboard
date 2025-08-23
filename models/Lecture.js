// models/Lecture.js
const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    default: 'Live Lecture'
  },
  startTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  endTime: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // in minutes
    default: 60
  },
  qrToken: {
    type: String,
    required: true,
    unique: true
  },
  tokenExpiry: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  location: {
    room: String,
    building: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  settings: {
    allowLateJoin: {
      type: Boolean,
      default: true
    },
    lateJoinGracePeriod: {
      type: Number, // in minutes
      default: 15
    },
    requireLocation: {
      type: Boolean,
      default: false
    }
  },
  metadata: {
    totalStudents: {
      type: Number,
      default: 0
    },
    attendanceCount: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
lectureSchema.index({ class: 1, isActive: 1 });
lectureSchema.index({ teacher: 1, startTime: -1 });
lectureSchema.index({ qrToken: 1 });
lectureSchema.index({ tokenExpiry: 1 });

// Virtual for lecture duration calculation
lectureSchema.virtual('actualDuration').get(function() {
  if (this.endTime) {
    return Math.round((this.endTime - this.startTime) / 60000); // in minutes
  }
  return Math.round((new Date() - this.startTime) / 60000);
});

// Virtual for attendance rate
lectureSchema.virtual('attendanceRate').get(function() {
  if (this.metadata.totalStudents === 0) return 0;
  return Math.round((this.metadata.attendanceCount / this.metadata.totalStudents) * 100);
});

// Static method to cleanup expired tokens
lectureSchema.statics.cleanupExpiredTokens = async function() {
  const result = await this.updateMany(
    { 
      tokenExpiry: { $lt: new Date() },
      isActive: true 
    },
    { 
      isActive: false,
      endTime: new Date()
    }
  );
  
  console.log(`Cleaned up ${result.modifiedCount} expired lectures`);
  return result.modifiedCount;
};

// Static method to get active lectures for a teacher
lectureSchema.statics.getActiveLecturesByTeacher = async function(teacherId) {
  return this.find({
    teacher: teacherId,
    isActive: true
  }).populate('class', 'subject name').sort({ startTime: -1 });
};

// Instance method to extend lecture duration
lectureSchema.methods.extendDuration = async function(additionalMinutes) {
  this.duration += additionalMinutes;
  return this.save();
};

// Instance method to refresh QR token
lectureSchema.methods.refreshQRToken = async function() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  this.qrToken = `qr_${timestamp}_${randomStr}`;
  this.tokenExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  return this.save();
};

// Pre-save middleware to update metadata
lectureSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('class')) {
    try {
      const Class = mongoose.model('Class');
      const classDoc = await Class.findById(this.class);
      if (classDoc) {
        this.metadata.totalStudents = classDoc.students.length;
      }
    } catch (error) {
      console.error('Error updating lecture metadata:', error);
    }
  }
  next();
});

// Ensure virtual fields are serialized
lectureSchema.set('toJSON', { virtuals: true });
lectureSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Lecture', lectureSchema);