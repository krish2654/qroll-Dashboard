const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  classGroup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClassGroup',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
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
  }
}, {
  timestamps: true
});

// Index for faster queries
classSchema.index({ teacher: 1 });
classSchema.index({ classGroup: 1 });

module.exports = mongoose.model('Class', classSchema);