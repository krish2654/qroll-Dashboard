// models/Attendance.js - Updated for lecture support
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  lecture: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: false, // Optional for backward compatibility
    index: true
  },
  date: {
    type: Date,
    required: true,
    default: function() {
      // Set to beginning of day for daily attendance tracking
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today;
    },
    index: true
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'late', 'excused'],
    default: 'present'
  },
  markedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  markedBy: {
    type: String,
    enum: ['qr_scan', 'manual', 'auto', 'bulk_import'],
    default: 'qr_scan'
  },
  location: {
    latitude: {
      type: Number,
      min: -90,
      max: 90
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180
    },
    accuracy: Number, // in meters
    address: String
  },
  deviceInfo: {
    userAgent: String,
    ipAddress: String,
    deviceId: String
  },
  notes: {
    type: String,
    maxlength: 500
  },
  isVerified: {
    type: Boolean,
    default: true
  },
  verificationMethod: {
    type: String,
    enum: ['location', 'qr_code', 'manual', 'biometric'],
    default: 'qr_code'
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
attendanceSchema.index({ class: 1, date: 1 });
attendanceSchema.index({ student: 1, date: 1 });
attendanceSchema.index({ lecture: 1, student: 1 }, { unique: true, sparse: true });
attendanceSchema.index({ class: 1, student: 1, date: 1 }, { 
  unique: true,
  partialFilterExpression: { date: { $type: "date" } }
});

// Virtual for attendance duration (if lecture-based)
attendanceSchema.virtual('attendanceDuration').get(function() {
  if (this.lecture && this.populate('lecture')) {
    const lecture = this.lecture;
    if (lecture.endTime) {
      return Math.max(0, Math.min(
        lecture.endTime - this.markedAt,
        lecture.endTime - lecture.startTime
      ));
    }
    return Date.now() - this.markedAt;
  }
  return null;
});

// Virtual for late status
attendanceSchema.virtual('isLate').get(function() {
  if (this.lecture && this.populate('lecture')) {
    const lecture = this.lecture;
    const graceMinutes = lecture.settings?.lateJoinGracePeriod || 15;
    const lateThreshold = new Date(lecture.startTime.getTime() + graceMinutes * 60 * 1000);
    return this.markedAt > lateThreshold;
  }
  return false;
});

// Static method to mark attendance
attendanceSchema.statics.markAttendance = async function(data) {
  const {
    classId,
    studentId,
    lectureId,
    status = 'present',
    markedBy = 'qr_scan',
    location,
    deviceInfo,
    notes
  } = data;

  // Create date without time for daily attendance
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    let attendance;
    
    if (lectureId) {
      // Lecture-based attendance
      attendance = await this.findOneAndUpdate(
        {
          lecture: lectureId,
          student: studentId
        },
        {
          class: classId,
          student: studentId,
          lecture: lectureId,
          date: today,
          status,
          markedAt: new Date(),
          markedBy,
          ...(location && { location }),
          ...(deviceInfo && { deviceInfo }),
          ...(notes && { notes })
        },
        {
          upsert: true,
          new: true,
          runValidators: true
        }
      );
    } else {
      // Daily attendance (legacy)
      attendance = await this.findOneAndUpdate(
        {
          class: classId,
          student: studentId,
          date: today
        },
        {
          status,
          markedAt: new Date(),
          markedBy,
          ...(location && { location }),
          ...(deviceInfo && { deviceInfo }),
          ...(notes && { notes })
        },
        {
          upsert: true,
          new: true,
          runValidators: true
        }
      );
    }

    return attendance;
  } catch (error) {
    if (error.code === 11000) {
      throw new Error('Attendance already marked for this session');
    }
    throw error;
  }
};

// Static method to get attendance statistics
attendanceSchema.statics.getStats = async function(classId, options = {}) {
  const { startDate, endDate, studentId, lectureId } = options;
  
  const matchQuery = { class: classId };
  
  if (startDate || endDate) {
    matchQuery.date = {};
    if (startDate) matchQuery.date.$gte = new Date(startDate);
    if (endDate) matchQuery.date.$lte = new Date(endDate);
  }
  
  if (studentId) {
    matchQuery.student = studentId;
  }

  if (lectureId) {
    matchQuery.lecture = lectureId;
  }

  const stats = await this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const result = stats.reduce((acc, stat) => {
    acc[stat._id] = stat.count;
    return acc;
  }, { present: 0, absent: 0, late: 0, excused: 0 });

  // Calculate total and percentage
  const total = Object.values(result).reduce((sum, count) => sum + count, 0);
  result.total = total;
  result.attendanceRate = total > 0 
    ? Math.round(((result.present + result.late) / total) * 100) 
    : 0;

  return result;
};

// Static method to get attendance by date range
attendanceSchema.statics.getAttendanceByDateRange = async function(classId, startDate, endDate, options = {}) {
  const { groupBy = 'date' } = options;
  
  const matchQuery = {
    class: classId,
    date: {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    }
  };

  let groupByField;
  switch (groupBy) {
    case 'week':
      groupByField = { 
        $dateToString: { 
          format: "%Y-W%U", 
          date: "$date" 
        } 
      };
      break;
    case 'month':
      groupByField = { 
        $dateToString: { 
          format: "%Y-%m", 
          date: "$date" 
        } 
      };
      break;
    default:
      groupByField = { 
        $dateToString: { 
          format: "%Y-%m-%d", 
          date: "$date" 
        } 
      };
  }

  const pipeline = [
    { $match: matchQuery },
    {
      $group: {
        _id: {
          period: groupByField,
          status: '$status'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.period',
        attendance: {
          $push: {
            status: '$_id.status',
            count: '$count'
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ];

  return this.aggregate(pipeline);
};

// Static method to get student attendance summary
attendanceSchema.statics.getStudentSummary = async function(classId, studentId, options = {}) {
  const { startDate, endDate } = options;
  
  const matchQuery = {
    class: classId,
    student: studentId
  };

  if (startDate || endDate) {
    matchQuery.date = {};
    if (startDate) matchQuery.date.$gte = new Date(startDate);
    if (endDate) matchQuery.date.$lte = new Date(endDate);
  }

  const summary = await this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: '$student',
        totalSessions: { $sum: 1 },
        presentCount: {
          $sum: {
            $cond: [
              { $in: ['$status', ['present', 'late']] },
              1,
              0
            ]
          }
        },
        lateCount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'late'] }, 1, 0]
          }
        },
        absentCount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'absent'] }, 1, 0]
          }
        },
        excusedCount: {
          $sum: {
            $cond: [{ $eq: ['$status', 'excused'] }, 1, 0]
          }
        },
        lastAttendance: { $max: '$markedAt' },
        firstAttendance: { $min: '$markedAt' }
      }
    }
  ]);

  if (summary.length === 0) {
    return {
      totalSessions: 0,
      presentCount: 0,
      lateCount: 0,
      absentCount: 0,
      excusedCount: 0,
      attendanceRate: 0,
      lastAttendance: null,
      firstAttendance: null
    };
  }

  const result = summary[0];
  result.attendanceRate = Math.round((result.presentCount / result.totalSessions) * 100);
  
  return result;
};

// Instance method to check if attendance is late
attendanceSchema.methods.checkLateStatus = async function() {
  if (!this.lecture) return false;
  
  await this.populate('lecture');
  const lecture = this.lecture;
  const graceMinutes = lecture.settings?.lateJoinGracePeriod || 15;
  const lateThreshold = new Date(lecture.startTime.getTime() + graceMinutes * 60 * 1000);
  
  const wasLate = this.markedAt > lateThreshold;
  
  if (wasLate && this.status === 'present') {
    this.status = 'late';
    await this.save();
  }
  
  return wasLate;
};

// Ensure virtual fields are serialized
attendanceSchema.set('toJSON', { virtuals: true });
attendanceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Attendance', attendanceSchema);