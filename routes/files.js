// routes/files.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { authenticateToken, requireRole } = require('../middleware/auth');
const File = require('../models/File');
const Class = require('../models/Class');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/class-files');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error, null);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${fileExtension}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/zip',
    'application/x-zip-compressed'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, Word, PowerPoint, images, text and zip files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Maximum 10 files per request
  },
  fileFilter: fileFilter
});

// Upload files to a class
router.post('/upload/:classId', authenticateToken, requireRole(['teacher']), upload.array('files'), async (req, res) => {
  try {
    const { classId } = req.params;
    const { category = 'general', description = '' } = req.body;

    // Verify teacher owns this class
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

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    // Create file records in database
    const uploadedFiles = [];
    for (const file of req.files) {
      const fileRecord = new File({
        filename: file.filename,
        originalName: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        class: classId,
        uploadedBy: req.user._id,
        category: category,
        description: description,
        isPublic: true
      });

      await fileRecord.save();
      uploadedFiles.push({
        id: fileRecord._id,
        name: fileRecord.originalName,
        size: formatFileSize(fileRecord.fileSize),
        category: fileRecord.category,
        uploadedAt: fileRecord.createdAt,
        downloads: fileRecord.downloadCount
      });
    }

    console.log(`${uploadedFiles.length} files uploaded to class ${classDoc.subject} by ${req.user.email}`);

    res.json({
      success: true,
      message: `${uploadedFiles.length} file(s) uploaded successfully`,
      files: uploadedFiles
    });

  } catch (error) {
    console.error('File upload error:', error);
    
    // Clean up uploaded files on error
    if (req.files) {
      for (const file of req.files) {
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          console.error('Error cleaning up file:', unlinkError);
        }
      }
    }

    res.status(500).json({
      success: false,
      message: 'File upload failed',
      error: error.message
    });
  }
});

// Get files for a class
router.get('/class/:classId', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const { category, page = 1, limit = 50 } = req.query;

    // Check if user has access to this class
    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    const isTeacher = classDoc.teacher.toString() === req.user._id.toString();
    const isStudent = req.user.role === 'student' && classDoc.students.includes(req.user._id);

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class'
      });
    }

    // Build query
    const query = {
      class: classId,
      isPublic: true
    };

    if (category) {
      query.category = category;
    }

    // Get files with pagination
    const skip = (page - 1) * limit;
    const files = await File.find(query)
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalFiles = await File.countDocuments(query);

    const fileList = files.map(file => ({
      id: file._id,
      name: file.originalName,
      size: formatFileSize(file.fileSize),
      category: file.category,
      description: file.description,
      mimeType: file.mimeType,
      uploadedBy: file.uploadedBy.name,
      uploadedAt: file.createdAt,
      downloads: file.downloadCount,
      canDelete: isTeacher || file.uploadedBy._id.toString() === req.user._id.toString()
    }));

    res.json({
      success: true,
      files: fileList,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalFiles / limit),
        totalFiles: totalFiles,
        hasNext: skip + files.length < totalFiles,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get files',
      error: error.message
    });
  }
});

// Download a file
router.get('/download/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await File.findById(fileId).populate('class');
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check access
    const isTeacher = file.class.teacher.toString() === req.user._id.toString();
    const isStudent = req.user.role === 'student' && file.class.students.includes(req.user._id);

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this file'
      });
    }

    // Check if file exists on disk
    try {
      await fs.access(file.filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    // Increment download count
    file.downloadCount += 1;
    file.lastDownloadedAt = new Date();
    await file.save();

    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
    res.setHeader('Content-Type', file.mimeType);

    // Stream the file
    res.sendFile(path.resolve(file.filePath));

    console.log(`File downloaded: ${file.originalName} by ${req.user.email}`);

  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file',
      error: error.message
    });
  }
});

// Delete a file
router.delete('/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await File.findById(fileId).populate('class');
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check if user can delete (teacher or file uploader)
    const isTeacher = file.class.teacher.toString() === req.user._id.toString();
    const isUploader = file.uploadedBy.toString() === req.user._id.toString();

    if (!isTeacher && !isUploader) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied to delete this file'
      });
    }

    // Delete file from disk
    try {
      await fs.unlink(file.filePath);
    } catch (error) {
      console.error('Error deleting file from disk:', error);
    }

    // Delete file record from database
    await File.findByIdAndDelete(fileId);

    console.log(`File deleted: ${file.originalName} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file',
      error: error.message
    });
  }
});

// Get file categories for a class
router.get('/categories/:classId', authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;

    // Check access
    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    const isTeacher = classDoc.teacher.toString() === req.user._id.toString();
    const isStudent = req.user.role === 'student' && classDoc.students.includes(req.user._id);

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class'
      });
    }

    // Get categories with file counts
    const categories = await File.aggregate([
      { $match: { class: classDoc._id, isPublic: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalSize: { $sum: '$fileSize' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const categoryList = categories.map(cat => ({
      name: cat._id,
      count: cat.count,
      totalSize: formatFileSize(cat.totalSize)
    }));

    res.json({
      success: true,
      categories: categoryList
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories',
      error: error.message
    });
  }
});

// Share file (generate shareable link)
router.post('/share/:fileId', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const { fileId } = req.params;
    const { expiryHours = 24, allowDownload = true } = req.body;

    const file = await File.findById(fileId).populate('class');
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check if teacher owns the class
    if (file.class.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      });
    }

    // Generate share token
    const shareToken = generateShareToken();
    const expiryDate = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    // Update file with share settings
    file.shareSettings = {
      isShared: true,
      shareToken: shareToken,
      shareExpiry: expiryDate,
      allowDownload: allowDownload,
      sharedBy: req.user._id,
      sharedAt: new Date()
    };

    await file.save();

    const shareUrl = `${process.env.FRONTEND_URL}/shared/file/${shareToken}`;

    res.json({
      success: true,
      message: 'File shared successfully',
      shareUrl: shareUrl,
      expiresAt: expiryDate
    });

  } catch (error) {
    console.error('File share error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share file',
      error: error.message
    });
  }
});

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to generate share token
function generateShareToken() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `share_${timestamp}_${randomStr}`;
}

module.exports = router;