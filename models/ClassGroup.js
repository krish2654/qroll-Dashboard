const mongoose = require('mongoose');

const classGroupSchema = new mongoose.Schema({
  name: {
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
  groupCode: {
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
  classes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    joinLocation: {
      type: String,
      enum: ['college_only', 'anywhere'],
      default: 'college_only'
    },
    allowLateJoin: {
      type: Boolean,
      default: true
    },
    requireApproval: {
      type: Boolean,
      default: false
    }
  },
  // College location for proximity check
  collegeLocation: {
    latitude: Number,
    longitude: Number,
    radius: { type: Number, default: 500 } // radius in meters
  }
}, {
  timestamps: true
});

// Index for faster queries
classGroupSchema.index({ teacher: 1 });
classGroupSchema.index({ groupCode: 1 });
classGroupSchema.index({ students: 1 });

// Generate unique group code
classGroupSchema.statics.generateGroupCode = async function() {
  let code;
  let exists = true;
  
  while (exists) {
    // Generate 6-character alphanumeric code
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const existingGroup = await this.findOne({ groupCode: code });
    exists = !!existingGroup;
  }
  
  return code;
};

// Virtual for student count
classGroupSchema.virtual('studentCount').get(function() {
  return this.students.length;
});

// Virtual for class count
classGroupSchema.virtual('classCount').get(function() {
  return this.classes.length;
});

// Ensure virtual fields are serialized
classGroupSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('ClassGroup', classGroupSchema);