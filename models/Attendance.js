const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'late'],
    default: 'present'
  },
  markedAt: {
    type: Date,
    default: Date.now
  },
  markedBy: {
    type: String,
    enum: ['qr_scan', 'manual', 'auto'],
    default: 'qr_scan'
  },
  session: {
    startTime: Date,
    endTime: Date,
    qrCodeId: String // Reference to the QR code used for this session
  },
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number
  },
  notes: {
    type: String,
    maxlength: 200
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate attendance for same student, class, and date
attendanceSchema.index({ 
  class: 1, 
  student: 1, 
  date: 1 
}, { 
  unique: true,
  partialFilterExpression: {
    date: { $type: "date" }
  }
});

// Index for faster queries
attendanceSchema.index({ class: 1, date: 1 });
attendanceSchema.index({ student: 1, date: 1 });

// Static method to mark attendance
attendanceSchema.statics.markAttendance = async function(classId, studentId, options = {}) {
  const {
    status = 'present',
    markedBy = 'qr_scan',
    location,
    notes,
    sessionData
  } = options;

  // Create date without time for daily attendance
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const attendance = await this.findOneAndUpdate(
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
        ...(notes && { notes }),
        ...(sessionData && { session: sessionData })
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    return attendance;
  } catch (error) {
    if (error.code === 11000) {
      throw new Error('Attendance already marked for today');
    }
    throw error;
  }
};

// Static method to get attendance statistics
attendanceSchema.statics.getStats = async function(classId, options = {}) {
  const { startDate, endDate, studentId } = options;
  
  const matchQuery = { class: classId };
  
  if (startDate || endDate) {
    matchQuery.date = {};
    if (startDate) matchQuery.date.$gte = new Date(startDate);
    if (endDate) matchQuery.date.$lte = new Date(endDate);
  }
  
  if (studentId) {
    matchQuery.student = studentId;
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

  return stats.reduce((acc, stat) => {
    acc[stat._id] = stat.count;
    return acc;
  }, { present: 0, absent: 0, late: 0 });
};

module.exports = mongoose.model('Attendance', attendanceSchema);