// routes/sessions.js - Enhanced session management with location and token refresh
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const crypto = require('crypto');
const Class = require('../models/Class');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// In-memory session storage (in production, use Redis or database)
const activeSessions = new Map();

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Generate QR token and code
async function generateQRCode(sessionId) {
  const token = crypto.randomBytes(16).toString('hex');
  const qrData = `${process.env.FRONTEND_URL}/join-session/${token}`;
  
  try {
    const qrCodeUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    return { token, qrCodeUrl, qrData };
  } catch (error) {
    throw new Error('Failed to generate QR code');
  }
}

// Create new session
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { classId, subjectId, duration, location } = req.body;
    const teacherId = req.user.id;

    // Validate class ownership
    const classDoc = await Class.findOne({ _id: classId, teacherId });
    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found or unauthorized'
      });
    }

    // Find subject
    const subject = classDoc.subjects.find(s => s.code === subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    // Generate session ID and QR code
    const sessionId = crypto.randomUUID();
    const { token, qrCodeUrl } = await generateQRCode(sessionId);

    // Create session object
    const session = {
      _id: sessionId,
      classId,
      subjectId,
      subjectName: subject.name,
      teacherId,
      duration: parseInt(duration),
      location,
      qrToken: token,
      qrCodeUrl,
      startTime: new Date(),
      endTime: new Date(Date.now() + duration * 60 * 1000),
      isActive: true,
      attendees: []
    };

    // Store in memory (in production, save to database)
    activeSessions.set(sessionId, session);

    res.json({
      success: true,
      message: 'Session created successfully',
      session
    });

  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create session'
    });
  }
});

// Refresh QR token
router.post('/:sessionId/refresh-token', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session || session.teacherId !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or unauthorized'
      });
    }

    if (!session.isActive || new Date() > session.endTime) {
      return res.status(400).json({
        success: false,
        message: 'Session has ended'
      });
    }

    // Generate new QR code
    const { token, qrCodeUrl } = await generateQRCode(sessionId);
    
    // Update session
    session.qrToken = token;
    session.qrCodeUrl = qrCodeUrl;
    activeSessions.set(sessionId, session);

    res.json({
      success: true,
      qrToken: token,
      qrCodeUrl
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
});

// Join session (for students)
router.post('/join/:token', authenticateToken, async (req, res) => {
  try {
    const { token } = req.params;
    const { location } = req.body;
    const studentId = req.user.id;

    // Find session by token
    let targetSession = null;
    for (const [sessionId, session] of activeSessions) {
      if (session.qrToken === token && session.isActive) {
        targetSession = session;
        break;
      }
    }

    if (!targetSession) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired session token'
      });
    }

    // Check if session is still active
    if (new Date() > targetSession.endTime) {
      targetSession.isActive = false;
      return res.status(400).json({
        success: false,
        message: 'Session has ended'
      });
    }

    // Check location restrictions
    if (targetSession.location.type === 'restricted' && location) {
      const distance = calculateDistance(
        targetSession.location.coordinates.lat,
        targetSession.location.coordinates.lng,
        location.lat,
        location.lng
      );

      if (distance > targetSession.location.radius) {
        return res.status(400).json({
          success: false,
          message: `You must be within ${targetSession.location.radius}m of the session location`
        });
      }
    }

    // Check if already marked attendance
    const existingAttendance = await Attendance.findOne({
      lectureId: targetSession._id,
      studentId
    });

    if (existingAttendance) {
      return res.status(400).json({
        success: false,
        message: 'Attendance already marked for this session'
      });
    }

    // Mark attendance
    const attendance = new Attendance({
      lectureId: targetSession._id,
      studentId,
      timestamp: new Date()
    });

    await attendance.save();

    // Add to session attendees
    const student = await User.findById(studentId).select('name email');
    targetSession.attendees.push({
      studentId,
      studentName: student.name,
      email: student.email,
      timestamp: new Date()
    });

    activeSessions.set(targetSession._id, targetSession);

    res.json({
      success: true,
      message: 'Attendance marked successfully',
      session: {
        subjectName: targetSession.subjectName,
        duration: targetSession.duration
      }
    });

  } catch (error) {
    console.error('Join session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join session'
    });
  }
});

// Get live attendance for a session
router.get('/:sessionId/attendance', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session || session.teacherId !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or unauthorized'
      });
    }

    res.json({
      success: true,
      attendance: session.attendees || []
    });

  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance'
    });
  }
});

// Export session report
router.get('/:sessionId/export', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { format = 'csv' } = req.query;
    const session = activeSessions.get(sessionId);

    if (!session || session.teacherId !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or unauthorized'
      });
    }

    const attendees = session.attendees || [];

    if (format === 'csv') {
      // Generate CSV
      let csv = 'Name,Email,Timestamp\n';
      attendees.forEach(attendee => {
        csv += `"${attendee.studentName}","${attendee.email}","${attendee.timestamp.toISOString()}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="session-${sessionId}.csv"`);
      res.send(csv);

    } else if (format === 'pdf') {
      // PDF generation placeholder
      res.status(501).json({
        success: false,
        message: 'PDF export coming soon'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid format. Use csv or pdf'
      });
    }

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export report'
    });
  }
});

// List active sessions for teacher
router.get('/my-sessions', authenticateToken, async (req, res) => {
  try {
    const teacherId = req.user.id;
    const sessions = [];

    for (const [sessionId, session] of activeSessions) {
      if (session.teacherId === teacherId) {
        sessions.push({
          _id: sessionId,
          subjectName: session.subjectName,
          startTime: session.startTime,
          endTime: session.endTime,
          isActive: session.isActive && new Date() <= session.endTime,
          attendeeCount: session.attendees.length
        });
      }
    }

    res.json({
      success: true,
      sessions
    });

  } catch (error) {
    console.error('List sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sessions'
    });
  }
});

// End session manually
router.post('/:sessionId/end', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session || session.teacherId !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or unauthorized'
      });
    }

    session.isActive = false;
    session.endTime = new Date();
    activeSessions.set(sessionId, session);

    res.json({
      success: true,
      message: 'Session ended successfully'
    });

  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end session'
    });
  }
});

// Cleanup expired sessions (called periodically)
function cleanupExpiredSessions() {
  const now = new Date();
  for (const [sessionId, session] of activeSessions) {
    if (now > session.endTime) {
      session.isActive = false;
      // Could move to archived sessions or remove completely
      activeSessions.delete(sessionId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

module.exports = router;
