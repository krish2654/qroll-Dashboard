// routes/classGroups.js
const express = require('express');
const ClassGroup = require('../models/ClassGroup');
const Class = require('../models/Class');
const User = require('../models/User');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all class groups for teacher
router.get('/my-groups', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const classGroups = await ClassGroup.find({ 
      teacher: req.user._id,
      isActive: true 
    })
    .populate('students', 'name email profilePicture')
    .populate('classes', 'subject description schedule')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      classGroups,
      count: classGroups.length
    });
  } catch (error) {
    console.error('Get class groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch class groups',
      error: error.message
    });
  }
});

// Create new class group
router.post('/create', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { name, description, settings, collegeLocation } = req.body;

    // Validation
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Class group name is required'
      });
    }

    // Generate unique group code
    const groupCode = await ClassGroup.generateGroupCode();

    const newClassGroup = new ClassGroup({
      name: name.trim(),
      description: description?.trim(),
      groupCode,
      teacher: req.user._id,
      settings: settings || {},
      collegeLocation: collegeLocation || {}
    });

    await newClassGroup.save();

    // Populate teacher info for response
    await newClassGroup.populate('teacher', 'name email');

    console.log(`New class group created: ${name} (${groupCode}) by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Class group created successfully',
      classGroup: newClassGroup
    });

  } catch (error) {
    console.error('Create class group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create class group',
      error: error.message
    });
  }
});

// Get class group details
router.get('/:groupId', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;

    const classGroup = await ClassGroup.findById(groupId)
      .populate('teacher', 'name email profilePicture')
      .populate('students', 'name email profilePicture')
      .populate('classes', 'subject description schedule');

    if (!classGroup) {
      return res.status(404).json({
        success: false,
        message: 'Class group not found'
      });
    }

    // Check if user has access to this class group
    const isTeacher = classGroup.teacher._id.toString() === req.user._id.toString();
    const isStudent = classGroup.students.some(student => 
      student._id.toString() === req.user._id.toString()
    );

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class group'
      });
    }

    res.json({
      success: true,
      classGroup,
      userRole: isTeacher ? 'teacher' : 'student'
    });

  } catch (error) {
    console.error('Get class group details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch class group details',
      error: error.message
    });
  }
});

// Update class group
router.put('/:groupId', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, description, settings, collegeLocation } = req.body;

    const classGroup = await ClassGroup.findOne({
      _id: groupId,
      teacher: req.user._id
    });

    if (!classGroup) {
      return res.status(404).json({
        success: false,
        message: 'Class group not found or access denied'
      });
    }

    // Update fields
    if (name) classGroup.name = name.trim();
    if (description !== undefined) classGroup.description = description?.trim();
    if (settings) classGroup.settings = { ...classGroup.settings, ...settings };
    if (collegeLocation) classGroup.collegeLocation = { ...classGroup.collegeLocation, ...collegeLocation };

    await classGroup.save();

    res.json({
      success: true,
      message: 'Class group updated successfully',
      classGroup
    });

  } catch (error) {
    console.error('Update class group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update class group',
      error: error.message
    });
  }
});

// Delete class group (soft delete)
router.delete('/:groupId', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { groupId } = req.params;

    const classGroup = await ClassGroup.findOne({
      _id: groupId,
      teacher: req.user._id
    });

    if (!classGroup) {
      return res.status(404).json({
        success: false,
        message: 'Class group not found or access denied'
      });
    }

    // Soft delete the group and all its classes
    classGroup.isActive = false;
    await classGroup.save();

    // Also deactivate all classes in this group
    await Class.updateMany(
      { classGroup: groupId },
      { isActive: false }
    );

    console.log(`Class group deleted: ${classGroup.name} (${classGroup.groupCode}) by ${req.user.email}`);

    res.json({
      success: true,
      message: 'Class group deleted successfully'
    });

  } catch (error) {
    console.error('Delete class group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete class group',
      error: error.message
    });
  }
});

// Add class to group
router.post('/:groupId/classes', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { groupId } = req.params;
    const { subject, description, schedule } = req.body;

    if (!subject) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required'
      });
    }

    const classGroup = await ClassGroup.findOne({
      _id: groupId,
      teacher: req.user._id
    });

    if (!classGroup) {
      return res.status(404).json({
        success: false,
        message: 'Class group not found or access denied'
      });
    }

    const newClass = new Class({
      subject: subject.trim(),
      description: description?.trim(),
      classGroup: groupId,
      teacher: req.user._id,
      schedule: schedule || {}
    });

    await newClass.save();

    // Add class to the group's classes array
    classGroup.classes.push(newClass._id);
    await classGroup.save();

    res.status(201).json({
      success: true,
      message: 'Class added to group successfully',
      class: newClass
    });

  } catch (error) {
    console.error('Add class to group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add class to group',
      error: error.message
    });
  }
});

// Get classes in a group
router.get('/:groupId/classes', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;

    const classGroup = await ClassGroup.findById(groupId);
    if (!classGroup) {
      return res.status(404).json({
        success: false,
        message: 'Class group not found'
      });
    }

    // Check access
    const isTeacher = classGroup.teacher.toString() === req.user._id.toString();
    const isStudent = classGroup.students.includes(req.user._id);

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class group'
      });
    }

    const classes = await Class.find({
      classGroup: groupId,
      isActive: true
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      classes,
      count: classes.length
    });

  } catch (error) {
    console.error('Get classes in group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch classes',
      error: error.message
    });
  }
});

// Remove class from group
router.delete('/:groupId/classes/:classId', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { groupId, classId } = req.params;

    const classGroup = await ClassGroup.findOne({
      _id: groupId,
      teacher: req.user._id
    });

    if (!classGroup) {
      return res.status(404).json({
        success: false,
        message: 'Class group not found or access denied'
      });
    }

    const classDoc = await Class.findOne({
      _id: classId,
      classGroup: groupId,
      teacher: req.user._id
    });

    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found or access denied'
      });
    }

    // Soft delete the class
    classDoc.isActive = false;
    await classDoc.save();

    // Remove from group's classes array
    classGroup.classes = classGroup.classes.filter(id => id.toString() !== classId);
    await classGroup.save();

    res.json({
      success: true,
      message: 'Class removed from group successfully'
    });

  } catch (error) {
    console.error('Remove class from group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove class from group',
      error: error.message
    });
  }
});

module.exports = router;