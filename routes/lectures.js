// routes/lectures.js
const express = require('express');
const QRCode = require('qrcode');
const { authenticateToken, requireRole } = require('../middleware/auth');
const Lecture = require('../models/Lecture');
const Class = require('../models/Class');
const Attendance = require('../models/Attendance');

const router = express.Router();

// Start a new lecture session
router.post('/start', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { classId, subjectId, title, description, duration = 60 } = req.body;

    if (!classId || !subjectId) {
      return res.status(400).json({
        success: false,
        message: 'Class ID and Subject ID are required'
      });
    }

    // Verify teacher has access to this class
    const classDoc = await Class.findOne({
      _id: classId,
      teacher: req.user._id
    });

    if (!classDoc) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class'
      });
    }

    // Verify subject exists in class
    const subject = classDoc.subjects.find(s => s.code === subjectId);
    if (!subject) {
      return res.status(400).json({
        success: false,
        message: 'Subject not found in this class'
      });
    }

    // Check if there's already an active lecture for this class
    const existingLecture = await Lecture.findOne({
      classId: classId,
      status: 'active'
    });

    if (existingLecture) {
      return res.status(400).json({
        success: false,
        message: 'There is already an active lecture for this class'
      });
    }

    // Create new lecture
    const lecture = new Lecture({
      classId,
      subjectId,
      title: title || `${subject.name} Lecture`,
      description,
      startTime: new Date(),
      duration,
      status: 'active'
    });

    // Generate QR token and code
    const qrToken = lecture.generateQRToken();
    const qrCodeUrl = `${process.env.FRONTEND_URL}/join-lecture/${qrToken}`;
    
    // Generate QR code image
    const qrCodeImage = await QRCode.toDataURL(qrCodeUrl);
    
    lecture.qrCode = qrCodeImage;
    lecture.joinUrl = qrCodeUrl;

    await lecture.save();

    console.log(`Lecture started: ${lecture.title} for ${subject.name} in ${classDoc.name} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Lecture started successfully',
      lecture: {
        id: lecture._id,
        title: lecture.title,
        classId: lecture.classId,
        subjectId: lecture.subjectId,
        startTime: lecture.startTime,
        duration: lecture.duration,
        status: lecture.status,
        qrToken: lecture.qrToken,
        qrCode: lecture.qrCode,
        joinUrl: lecture.joinUrl,
        studentsJoined: lecture.studentsJoined
      }
    });

  } catch (error) {
    console.error('Start lecture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start lecture',
      error: error.message
    });
  }
});

// Stop lecture session
router.post('/stop/:lectureId', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { lectureId } = req.params;

    const lecture = await Lecture.findOne({
      _id: lectureId,
      teacher: req.user._id,
      isActive: true
    });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Active lecture not found'
      });
    }

    // Stop the lecture
    lecture.isActive = false;
    lecture.endTime = new Date();
    await lecture.save();

    // Get attendance count
    const attendanceCount = await Attendance.countDocuments({
      lecture: lectureId
    });

    console.log(`Lecture stopped: ${lectureId} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'Lecture stopped successfully',
      attendanceCount: attendanceCount
    });

  } catch (error) {
    console.error('Stop lecture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop lecture',
      error: error.message
    });
  }
});

// Get current lecture QR token (for refreshing)
router.get('/:lectureId/qr', authenticateToken, async (req, res) => {
  try {
    const { lectureId } = req.params;

    const lecture = await Lecture.findOne({
      _id: lectureId,
      isActive: true
    }).populate('class');

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Active lecture not found'
      });
    }

    // Check if user has access (teacher or student in class)
    const isTeacher = lecture.teacher.toString() === req.user._id.toString();
    const isStudent = req.user.role === 'student' && 
                     lecture.class.students.includes(req.user._id);

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this lecture'
      });
    }

    // Check if token needs refresh (older than 5 minutes)
    if (lecture.tokenExpiry < new Date()) {
      lecture.qrToken = generateQRToken();
      lecture.tokenExpiry = new Date(Date.now() + 5 * 60 * 1000);
      await lecture.save();
    }

    // Generate new QR code
    const joinUrl = `${process.env.FRONTEND_URL}/join-lecture/${lecture.qrToken}`;
    const qrCodeDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 200,
      margin: 2
    });

    // Get current attendance count
    const attendanceCount = await Attendance.countDocuments({
      lecture: lectureId
    });

    res.json({
      success: true,
      lecture: {
        id: lecture._id,
        qrToken: lecture.qrToken,
        qrCode: qrCodeDataUrl,
        joinUrl: joinUrl,
        studentsJoined: attendanceCount,
        startTime: lecture.startTime,
        isActive: lecture.isActive
      }
    });

  } catch (error) {
    console.error('Get QR error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get QR code',
      error: error.message
    });
  }
});

// Join lecture (for students)
router.post('/join/:qrToken', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const { qrToken } = req.params;
    const { latitude, longitude } = req.body;

    // Find active lecture by QR token
    const lecture = await Lecture.findOne({
      qrToken: qrToken,
      isActive: true,
      tokenExpiry: { $gt: new Date() } // Token not expired
    }).populate('class');

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired QR code'
      });
    }

    // Check if student is enrolled in this class
    if (!lecture.class.students.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not enrolled in this class'
      });
    }

    // Check if attendance already marked for this lecture
    const existingAttendance = await Attendance.findOne({
      lecture: lecture._id,
      student: req.user._id
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: 'Attendance already marked for this lecture'
      });
    }

    // Mark attendance
    const attendance = new Attendance({
      lecture: lecture._id,
      class: lecture.class._id,
      student: req.user._id,
      markedAt: new Date(),
      markedBy: 'qr_scan',
      location: latitude && longitude ? {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      } : undefined
    });

    await attendance.save();

    console.log(`Attendance marked: ${req.user.email} joined ${lecture.class.subject}`);

    res.json({
      success: true,
      message: 'Attendance marked successfully',
      attendance: {
        lectureId: lecture._id,
        className: lecture.class.subject,
        markedAt: attendance.markedAt
      }
    });

  } catch (error) {
    console.error('Join lecture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join lecture',
      error: error.message
    });
  }
});

// Get active lectures for a class
router.get('/active/:classId', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;

    const lecture = await Lecture.findOne({
      class: classId,
      isActive: true
    }).populate('class').populate('teacher', 'name email');

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'No active lecture found for this class'
      });
    }

    // Check access
    const isTeacher = lecture.teacher._id.toString() === req.user._id.toString();
    const isStudent = req.user.role === 'student' && 
                     lecture.class.students.includes(req.user._id);

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this lecture'
      });
    }

    // Get attendance count
    const attendanceCount = await Attendance.countDocuments({
      lecture: lecture._id
    });

    res.json({
      success: true,
      lecture: {
        id: lecture._id,
        classId: lecture.class._id,
        className: lecture.class.subject,
        teacherName: lecture.teacher.name,
        startTime: lecture.startTime,
        duration: lecture.duration,
        studentsJoined: attendanceCount,
        isActive: lecture.isActive
      }
    });

  } catch (error) {
    console.error('Get active lecture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active lecture',
      error: error.message
    });
  }
});

// Get lecture attendance list
router.get('/:lectureId/attendance', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { lectureId } = req.params;

    const lecture = await Lecture.findOne({
      _id: lectureId,
      teacher: req.user._id
    });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found or access denied'
      });
    }

    const attendanceList = await Attendance.find({
      lecture: lectureId
    }).populate('student', 'name email profilePicture')
      .sort({ markedAt: 1 });

    const attendanceData = attendanceList.map(attendance => ({
      id: attendance._id,
      student: {
        id: attendance.student._id,
        name: attendance.student.name,
        email: attendance.student.email,
        profilePicture: attendance.student.profilePicture
      },
      markedAt: attendance.markedAt,
      markedBy: attendance.markedBy,
      location: attendance.location
    }));

    res.json({
      success: true,
      attendance: attendanceData,
      total: attendanceData.length
    });

  } catch (error) {
    console.error('Get attendance list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attendance list',
      error: error.message
    });
  }
});

// Get lecture analytics
router.get('/:lectureId/analytics', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { lectureId } = req.params;

    const lecture = await Lecture.findOne({
      _id: lectureId,
      teacher: req.user._id
    }).populate('class');

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found or access denied'
      });
    }

    // Get attendance stats
    const totalStudents = lecture.class.students.length;
    const attendanceCount = await Attendance.countDocuments({
      lecture: lectureId
    });

    // Get attendance timeline (by minute)
    const attendanceTimeline = await Attendance.aggregate([
      { $match: { lecture: lecture._id } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%H:%M",
              date: "$markedAt"
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    // Calculate attendance rate
    const attendanceRate = totalStudents > 0 
      ? Math.round((attendanceCount / totalStudents) * 100) 
      : 0;

    // Get late joiners (joined after 10 minutes)
    const lateThreshold = new Date(lecture.startTime.getTime() + 10 * 60 * 1000);
    const lateJoiners = await Attendance.countDocuments({
      lecture: lectureId,
      markedAt: { $gt: lateThreshold }
    });

    res.json({
      success: true,
      analytics: {
        totalStudents,
        attendanceCount,
        attendanceRate,
        absentCount: totalStudents - attendanceCount,
        lateJoiners,
        attendanceTimeline,
        lectureDuration: lecture.endTime 
          ? Math.round((lecture.endTime - lecture.startTime) / 60000) 
          : Math.round((new Date() - lecture.startTime) / 60000)
      }
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get lecture analytics',
      error: error.message
    });
  }
});

// Generate QR token
function generateQRToken() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `qr_${timestamp}_${randomStr}`;
}

module.exports = router;