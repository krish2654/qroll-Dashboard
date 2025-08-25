const mongoose = require('mongoose');

const teacherClassMapSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  subjects: [{
    code: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: String,
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  assignedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for unique teacher-class mapping
teacherClassMapSchema.index({ teacherId: 1, classId: 1 }, { unique: true });
teacherClassMapSchema.index({ teacherId: 1 });
teacherClassMapSchema.index({ classId: 1 });

// Static method to assign subjects to teacher for a class
teacherClassMapSchema.statics.assignSubjects = async function(teacherId, classId, subjects) {
  return this.findOneAndUpdate(
    { teacherId, classId },
    { 
      subjects,
      isActive: true,
      assignedAt: new Date()
    },
    { 
      upsert: true, 
      new: true,
      runValidators: true
    }
  );
};

// Static method to get teacher's classes with subjects
teacherClassMapSchema.statics.getTeacherClasses = async function(teacherId) {
  return this.find({ teacherId, isActive: true })
    .populate('classId', 'name section classCode students')
    .sort({ assignedAt: -1 });
};

// Static method to get class teachers with their subjects
teacherClassMapSchema.statics.getClassTeachers = async function(classId) {
  return this.find({ classId, isActive: true })
    .populate('teacherId', 'name email profilePicture')
    .sort({ assignedAt: -1 });
};

module.exports = mongoose.model('TeacherClassMap', teacherClassMapSchema);
