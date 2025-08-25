// routes/classes.js
const express = require('express');
const Class = require('../models/Class');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all classes for teacher
router.get('/my-classes', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const classes = await Class.find({ 
      teacher: req.user._id,
      isActive: true 
    })
    .populate('students', 'name email profilePicture')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      classes,
      count: classes.length
    });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch classes',
      error: error.message
    });
  }
});

// Create new class
router.post('/create', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { name, section, subjects, description, schedule } = req.body;

    // Validation
    if (!name || !section) {
      return res.status(400).json({
        success: false,
        message: 'Class name and section are required'
      });
    }

    // Generate unique class code
    const classCode = await Class.generateClassCode();

    const newClass = new Class({
      name: name.trim(),
      section: section.trim(),
      subjects: subjects || [],
      classCode,
      teacher: req.user._id,
      schedule: schedule || {}
    });

    await newClass.save();

    // Populate teacher info for response
    await newClass.populate('teacher', 'name email');

    console.log(`New class created: ${name} ${section} (${classCode}) by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      class: newClass
    });

  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create class',
      error: error.message
    });
  }
});

// Get class details
router.get('/:classId', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;

    const classDoc = await Class.findById(classId)
      .populate('teacher', 'name email profilePicture')
      .populate('students', 'name email profilePicture');

    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    // Check if user has access to this class
    const isTeacher = classDoc.teacher._id.toString() === req.user._id.toString();
    const isStudent = classDoc.students.some(student => 
      student._id.toString() === req.user._id.toString()
    );

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class'
      });
    }

    res.json({
      success: true,
      class: classDoc,
      userRole: isTeacher ? 'teacher' : 'student'
    });

  } catch (error) {
    console.error('Get class details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch class details',
      error: error.message
    });
  }
});

// Update class
router.put('/:classId', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { classId } = req.params;
    const { name, subject, description, schedule, settings } = req.body;

    const classDoc = await Class.findOne({
      _id: classId,
      teacher: req.user._id
    });

    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found or access denied'
      });
    }

    // Update fields
    if (name) classDoc.name = name.trim();
    if (subject) classDoc.subject = subject.trim();
    if (description !== undefined) classDoc.description = description?.trim();
    if (schedule) classDoc.schedule = { ...classDoc.schedule, ...schedule };
    if (settings) classDoc.settings = { ...classDoc.settings, ...settings };

    await classDoc.save();

    res.json({
      success: true,
      message: 'Class updated successfully',
      class: classDoc
    });

  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update class',
      error: error.message
    });
  }
});

// Delete class (soft delete)
router.delete('/:classId', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { classId } = req.params;

    const classDoc = await Class.findOne({
      _id: classId,
      teacher: req.user._id
    });

    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found or access denied'
      });
    }

    // Soft delete
    classDoc.isActive = false;
    await classDoc.save();

    console.log(`Class deleted: ${classDoc.name} (${classDoc.classCode}) by ${req.user.email}`);

    res.json({
      success: true,
      message: 'Class deleted successfully'
    });

  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete class',
      error: error.message
    });
  }
});

// Get class statistics
router.get('/:classId/stats', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const { startDate, endDate } = req.query;

    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    // Check access
    const isTeacher = classDoc.teacher.toString() === req.user._id.toString();
    const isStudent = classDoc.students.includes(req.user._id);

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class'
      });
    }

    // Get attendance statistics
    const attendanceStats = await Attendance.getStats(classId, {
      startDate,
      endDate,
      studentId: req.user.role === 'student' ? req.user._id : undefined
    });

    // Get total sessions (days with attendance records)
    const totalSessions = await Attendance.distinct('date', {
      class: classId,
      ...(startDate && { date: { $gte: new Date(startDate) } }),
      ...(endDate && { date: { $lte: new Date(endDate) } })
    });

    const stats = {
      totalStudents: classDoc.students.length,
      totalSessions: totalSessions.length,
      attendanceStats,
      attendanceRate: totalSessions.length > 0 
        ? ((attendanceStats.present + attendanceStats.late) / 
           (attendanceStats.present + attendanceStats.absent + attendanceStats.late) * 100).toFixed(1)
        : 0
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get class stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch class statistics',
      error: error.message
    });
  }
});

module.exports = router;