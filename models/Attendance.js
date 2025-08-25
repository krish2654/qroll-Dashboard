// models/Attendance.js - Simplified for minimalist app
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: true,
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
}, {
  timestamps: true
});

// Compound indexes for efficient queries
attendanceSchema.index({ lectureId: 1, studentId: 1 }, { unique: true });

// Static method to get lecture attendance
attendanceSchema.statics.getLectureAttendance = async function(lectureId) {
  return this.find({ lectureId })
    .populate('studentId', 'name email profilePicture')
    .sort({ timestamp: 1 });
};

// Static method to get student attendance history
attendanceSchema.statics.getStudentHistory = async function(studentId, classId) {
  const Lecture = mongoose.model('Lecture');
  
  const lectures = await Lecture.find({ classId }).select('_id');
  const lectureIds = lectures.map(l => l._id);
  
  return this.find({ 
    lectureId: { $in: lectureIds },
    studentId 
  })
  .populate('lectureId', 'title startTime subjectId')
  .sort({ timestamp: -1 });
};

module.exports = mongoose.model('Attendance', attendanceSchema);