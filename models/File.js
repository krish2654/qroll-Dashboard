// models/File.js
const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    enum: [
      'lecture_notes',
      'assignments',
      'syllabus',
      'lab_manuals',
      'reference_materials',
      'presentations',
      'videos',
      'general'
    ],
    default: 'general',
    index: true
  },
  description: {
    type: String,
    maxlength: 500
  },
  tags: [{
    type: String,
    trim: true
  }],
  isPublic: {
    type: Boolean,
    default: true
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  lastDownloadedAt: {
    type: Date,
    default: null
  },
  shareSettings: {
    isShared: {
      type: Boolean,
      default: false
    },
    shareToken: {
      type: String,
      unique: true,
      sparse: true // Only create index for non-null values
    },
    shareExpiry: {
      type: Date,
      default: null
    },
    allowDownload: {
      type: Boolean,
      default: true
    },
    sharedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    sharedAt: {
      type: Date,
      default: null
    }
  },
  metadata: {
    checksum: String, // For file integrity
    thumbnailPath: String, // For image/video thumbnails
    processedAt: Date,
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'completed'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
fileSchema.index({ class: 1, category: 1 });
fileSchema.index({ uploadedBy: 1, createdAt: -1 });
fileSchema.index({ 'shareSettings.shareToken': 1 }, { sparse: true });
fileSchema.index({ 'shareSettings.shareExpiry': 1 }, { sparse: true });

// Virtual for file extension
fileSchema.virtual('fileExtension').get(function() {
  return this.originalName.split('.').pop().toLowerCase();
});

// Virtual for formatted file size
fileSchema.virtual('formattedSize').get(function() {
  const bytes = this.fileSize;
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Virtual for file type icon
fileSchema.virtual('fileIcon').get(function() {
  const ext = this.fileExtension;
  const iconMap = {
    pdf: 'file-text',
    doc: 'file-text',
    docx: 'file-text',
    ppt: 'presentation',
    pptx: 'presentation',
    xls: 'file-spreadsheet',
    xlsx: 'file-spreadsheet',
    jpg: 'image',
    jpeg: 'image',
    png: 'image',
    gif: 'image',
    mp4: 'video',
    avi: 'video',
    mov: 'video',
    zip: 'archive',
    rar: 'archive',
    txt: 'file-text'
  };
  return iconMap[ext] || 'file';
});

// Static method to get files by category
fileSchema.statics.getByCategory = async function(classId, category, options = {}) {
  const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = options;
  
  const query = {
    class: classId,
    category: category,
    isPublic: true,
    isActive: true
  };

  const skip = (page - 1) * limit;
  
  const files = await this.find(query)
    .populate('uploadedBy', 'name email')
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit);

  const total = await this.countDocuments(query);

  return {
    files,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalFiles: total,
      hasNext: skip + files.length < total,
      hasPrev: page > 1
    }
  };
};

// Static method to get popular files (most downloaded)
fileSchema.statics.getPopularFiles = async function(classId, limit = 10) {
  return this.find({
    class: classId,
    isPublic: true,
    isActive: true,
    downloadCount: { $gt: 0 }
  })
  .populate('uploadedBy', 'name email')
  .sort({ downloadCount: -1, createdAt: -1 })
  .limit(limit);
};

// Static method to get recent files
fileSchema.statics.getRecentFiles = async function(classId, limit = 10) {
  return this.find({
    class: classId,
    isPublic: true,
    isActive: true
  })
  .populate('uploadedBy', 'name email')
  .sort({ createdAt: -1 })
  .limit(limit);
};

// Static method to search files
fileSchema.statics.searchFiles = async function(classId, searchTerm, options = {}) {
  const { category, page = 1, limit = 20 } = options;
  
  const query = {
    class: classId,
    isPublic: true,
    isActive: true,
    $or: [
      { originalName: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { tags: { $in: [new RegExp(searchTerm, 'i')] } }
    ]
  };

  if (category) {
    query.category = category;
  }

  const skip = (page - 1) * limit;
  
  const files = await this.find(query)
    .populate('uploadedBy', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await this.countDocuments(query);

  return {
    files,
    searchTerm,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalFiles: total,
      hasNext: skip + files.length < total,
      hasPrev: page > 1
    }
  };
};

// Static method to get storage stats for a class
fileSchema.statics.getStorageStats = async function(classId) {
  const stats = await this.aggregate([
    { $match: { class: classId, isActive: true } },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        totalSize: { $sum: '$fileSize' },
        avgDownloads: { $avg: '$downloadCount' }
      }
    },
    { $sort: { totalSize: -1 } }
  ]);

  const totalStats = await this.aggregate([
    { $match: { class: classId, isActive: true } },
    {
      $group: {
        _id: null,
        totalFiles: { $sum: 1 },
        totalSize: { $sum: '$fileSize' },
        totalDownloads: { $sum: '$downloadCount' }
      }
    }
  ]);

  return {
    byCategory: stats,
    overall: totalStats[0] || { totalFiles: 0, totalSize: 0, totalDownloads: 0 }
  };
};

// Instance method to increment download count
fileSchema.methods.incrementDownload = async function() {
  this.downloadCount += 1;
  this.lastDownloadedAt = new Date();
  return this.save();
};

// Instance method to check if file is shared and not expired
fileSchema.methods.isValidShare = function() {
  if (!this.shareSettings.isShared || !this.shareSettings.shareToken) {
    return false;
  }
  
  if (this.shareSettings.shareExpiry && this.shareSettings.shareExpiry < new Date()) {
    return false;
  }
  
  return true;
};

// Instance method to revoke share
fileSchema.methods.revokeShare = async function() {
  this.shareSettings.isShared = false;
  this.shareSettings.shareToken = undefined;
  this.shareSettings.shareExpiry = undefined;
  return this.save();
};

// Pre-save middleware to clean up expired shares
fileSchema.pre('save', function(next) {
  if (this.shareSettings.shareExpiry && this.shareSettings.shareExpiry < new Date()) {
    this.shareSettings.isShared = false;
    this.shareSettings.shareToken = undefined;
    this.shareSettings.shareExpiry = undefined;
  }
  next();
});

// Pre-remove middleware to clean up file from disk
fileSchema.pre('remove', async function(next) {
  const fs = require('fs').promises;
  try {
    await fs.unlink(this.filePath);
    if (this.metadata.thumbnailPath) {
      await fs.unlink(this.metadata.thumbnailPath);
    }
  } catch (error) {
    console.error('Error cleaning up file:', error);
  }
  next();
});

// Ensure virtual fields are serialized
fileSchema.set('toJSON', { virtuals: true });
fileSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('File', fileSchema);