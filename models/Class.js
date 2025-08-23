const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  classCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    length: 6
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  schedule: {
    days: [{
      type: String,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    }],
    startTime: String, // Format: "09:00"
    endTime: String,   // Format: "10:30"
    room: String
  },
  settings: {
    allowLateJoin: {
      type: Boolean,
      default: true
    },
    maxStudents: {
      type: Number,
      default: null // null means unlimited
    },
    requireApproval: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
classSchema.index({ teacher: 1 });
classSchema.index({ classCode: 1 });
classSchema.index({ students: 1 });

// Generate unique class code
classSchema.statics.generateClassCode = async function() {
  let code;
  let exists = true;
  
  while (exists) {
    // Generate 6-character alphanumeric code
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const existingClass = await this.findOne({ classCode: code });
    exists = !!existingClass;
  }
  
  return code;
};

// Virtual for student count
classSchema.virtual('studentCount').get(function() {
  return this.students.length;
});

// Ensure virtual fields are serialized
classSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Class', classSchema);