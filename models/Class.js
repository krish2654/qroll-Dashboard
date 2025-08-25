const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  section: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subjects: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    code: {
      type: String,
      required: true,
      trim: true
    },
    description: String
  }],
  classCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    length: 6
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
    startTime: String,
    endTime: String,
    room: String
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

classSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Class', classSchema);