/**
 * Imagen Upload Stage - Upload photos to Imagen AI for enhancement
 * 
 * Uploads grouped photos to Imagen AI service and tracks upload status
 * for later download of enhanced images.
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { glob } = require('glob');

class ImagenUploadStage {
  constructor(options = {}) {
    this.auditLogger = options.auditLogger;
    this.imagenApiKey = process.env.IMAGEN_API_KEY;
    this.imagenApiUrl = process.env.IMAGEN_API_URL || 'https://api.imagen-ai.com/v1';
    this.supportedFormats = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
    this.maxFileSize = 50 * 1024 * 1024; // 50MB limit
    this.batchSize = 10; // Upload in batches
  }

  /**
   * Execute the upload stage
   */
  async execute(options) {
    const startTime = Date.now();
    const { inputPath, outputPath, auditLogger, dryRun = false } = options;
    
    auditLogger.logEvent('imagen_upload_stage_start', {
      inputPath,
      outputPath,
      dryRun,
      hasApiKey: !!this.imagenApiKey
    });

    try {
      // Check API key
      if (!this.imagenApiKey) {
        auditLogger.logFallback('imagen_upload',
          'imagen_api', 'mock_upload',
          'Imagen API key not available, creating mock upload tracking',
          true
        );
        
        return await this.mockUploadProcess(inputPath, outputPath, options);
      }

      // Find all group directories
      const groupDirs = await this.findGroupDirectories(inputPath);
      
      auditLogger.logEvent('groups_found', {
        totalGroups: groupDirs.length,
        groupNames: groupDirs.map(g => path.basename(g))
      });

      if (groupDirs.length === 0) {
        auditLogger.logDecision('no_groups_found',
          { inputPath },
          'skip_upload',
          'No group directories found in input directory'
        );
        
        return {
          success: true,
          groupsProcessed: 0,
          filesUploaded: 0,
          duration: Date.now() - startTime
        };
      }

      // Process each group
      const results = {
        success: true,
        groupsProcessed: 0,
        filesUploaded: 0,
        errors: [],
        uploadTasks: [],
        duration: 0
      };

      for (const groupDir of groupDirs) {
        try {
          const groupResult = await this.processGroup(groupDir, outputPath, {
            auditLogger,
            dryRun
          });
          
          results.groupsProcessed++;
          results.filesUploaded += groupResult.filesUploaded;
          results.uploadTasks.push(...groupResult.uploadTasks);
          results.errors.push(...groupResult.errors);
          
        } catch (error) {
          auditLogger.logError(error, {
            groupDir,
            operation: 'process_group_upload'
          });
          
          results.errors.push({
            group: path.basename(groupDir),
            error: error.message
          });
        }
      }

      results.duration = Date.now() - startTime;
      
      // Save upload tracking data
      await this.saveUploadTrackingData(outputPath, results);
      
      // Log upload summary
      auditLogger.logEvent('imagen_upload_stage_complete', {
        totalGroups: groupDirs.length,
        groupsProcessed: results.groupsProcessed,
        filesUploaded: results.filesUploaded,
        uploadTasks: results.uploadTasks.length,
        errors: results.errors.length,
        duration: results.duration
      });

      // Create upload report
      await this.createUploadReport(outputPath, results, groupDirs);

      return results;

    } catch (error) {
      auditLogger.logError(error, {
        operation: 'imagen_upload_stage_execution',
        inputPath,
        outputPath
      }, 'critical');
      
      return {
        success: false,
        error: error.message,
        groupsProcessed: 0,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Find all group directories
   */
  async findGroupDirectories(inputPath) {
    try {
      const entries = await fs.readdir(inputPath, { withFileTypes: true });
      const directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(inputPath, entry.name))
        .filter(async (dir) => {
          // Check if directory contains group_metadata.json
          const metadataPath = path.join(dir, 'group_metadata.json');
          return await fs.pathExists(metadataPath);
        });
      
      return directories;
      
    } catch (error) {
      this.auditLogger?.logError(error, {
        operation: 'find_group_directories',
        inputPath
      });
      throw error;
    }
  }

  /**
   * Process a single group for upload
   */
  async processGroup(groupDir, outputPath, options) {
    const { auditLogger, dryRun } = options;
    const groupName = path.basename(groupDir);
    
    auditLogger.startOperation(`upload_group_${groupName}`);
    
    try {
      // Read group metadata
      const metadataPath = path.join(groupDir, 'group_metadata.json');
      const groupMetadata = await fs.readJson(metadataPath);
      
      // Find all image files in group
      const imageFiles = await this.findImagesInGroup(groupDir);
      
      auditLogger.logEvent('group_analysis', {
        groupName,
        expectedFiles: groupMetadata.fileCount,
        foundFiles: imageFiles.length,
        timeSpan: groupMetadata.timeSpan
      });

      const results = {
        groupName,
        filesUploaded: 0,
        uploadTasks: [],
        errors: []
      };

      if (dryRun) {
        // Simulate upload process
        results.filesUploaded = imageFiles.length;
        results.uploadTasks = imageFiles.map(file => ({
          taskId: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          fileName: path.basename(file),
          status: 'uploaded',
          uploadTime: new Date().toISOString(),
          mockUpload: true
        }));
        
        auditLogger.logEvent('dry_run_group_upload', {
          groupName,
          filesSimulated: imageFiles.length
        });
        
        auditLogger.endOperation({ dryRun: true });
        return results;
      }

      // Process files in batches
      const batches = this.createBatches(imageFiles, this.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        auditLogger.logEvent('batch_upload_start', {
          groupName,
          batch: i + 1,
          totalBatches: batches.length,
          batchSize: batch.length
        });

        try {
          const batchResults = await this.uploadBatch(batch, groupMetadata, {
            auditLogger,
            groupName
          });
          
          results.filesUploaded += batchResults.filesUploaded;
          results.uploadTasks.push(...batchResults.uploadTasks);
          results.errors.push(...batchResults.errors);
          
        } catch (error) {
          auditLogger.logError(error, {
            groupName,
            batch: i + 1,
            batchFiles: batch.map(f => path.basename(f)),
            operation: 'batch_upload'
          });
          
          results.errors.push({
            batch: i + 1,
            error: error.message,
            files: batch.map(f => path.basename(f))
          });
        }
      }

      auditLogger.endOperation({
        filesUploaded: results.filesUploaded,
        uploadTasks: results.uploadTasks.length,
        errors: results.errors.length
      });

      return results;

    } catch (error) {
      auditLogger.endOperation({ error: error.message });
      throw error;
    }
  }

  /**
   * Find all images in a group directory
   */
  async findImagesInGroup(groupDir) {
    const patterns = this.supportedFormats.map(ext => `*${ext}`);
    const allFiles = [];
    
    for (const pattern of patterns) {
      const files = await glob(pattern, { 
        cwd: groupDir, 
        nocase: true,
        absolute: true 
      });
      allFiles.push(...files);
    }
    
    // Filter by file size
    const validFiles = [];
    for (const file of allFiles) {
      const stats = await fs.stat(file);
      if (stats.size <= this.maxFileSize) {
        validFiles.push(file);
      } else {
        this.auditLogger?.logDecision('file_too_large',
          { file, size: stats.size, maxSize: this.maxFileSize },
          'skip',
          `File exceeds maximum size limit of ${this.maxFileSize} bytes`
        );
      }
    }
    
    return validFiles.sort();
  }

  /**
   * Create batches for upload
   */
  createBatches(files, batchSize) {
    const batches = [];
    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Upload a batch of files
   */
  async uploadBatch(batch, groupMetadata, options) {
    const { auditLogger, groupName } = options;
    
    const results = {
      filesUploaded: 0,
      uploadTasks: [],
      errors: []
    };

    for (const file of batch) {
      try {
        const uploadResult = await this.uploadSingleFile(file, groupMetadata, auditLogger);
        
        if (uploadResult.success) {
          results.filesUploaded++;
          results.uploadTasks.push(uploadResult.task);
          
          auditLogger.logEvent('file_uploaded', {
            fileName: path.basename(file),
            taskId: uploadResult.task.taskId,
            groupName
          });
        } else {
          results.errors.push({
            file: path.basename(file),
            error: uploadResult.error
          });
        }
        
      } catch (error) {
        auditLogger.logError(error, {
          file,
          groupName,
          operation: 'upload_single_file'
        });
        
        results.errors.push({
          file: path.basename(file),
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Upload a single file to Imagen
   */
  async uploadSingleFile(filePath, groupMetadata, auditLogger) {
    try {
      // Prepare form data
      const formData = new FormData();
      formData.append('image', fs.createReadStream(filePath));
      formData.append('enhancement_type', 'auto');
      formData.append('quality', 'high');
      formData.append('metadata', JSON.stringify({
        groupName: groupMetadata.groupName,
        originalTimestamp: groupMetadata.timeSpan.start,
        cameras: groupMetadata.cameras
      }));

      // Make API request
      const response = await axios.post(
        `${this.imagenApiUrl}/enhance`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.imagenApiKey}`,
            ...formData.getHeaders()
          },
          timeout: 120000 // 2 minute timeout
        }
      );

      const uploadTask = {
        taskId: response.data.task_id,
        fileName: path.basename(filePath),
        status: 'uploaded',
        uploadTime: new Date().toISOString(),
        estimatedCompletionTime: response.data.estimated_completion_time,
        enhancementType: 'auto',
        originalPath: filePath
      };

      return {
        success: true,
        task: uploadTask
      };

    } catch (error) {
      auditLogger.logError(error, {
        file: filePath,
        operation: 'imagen_api_upload'
      });

      // Try fallback with different settings
      return await this.fallbackUpload(filePath, groupMetadata, auditLogger);
    }
  }

  /**
   * Fallback upload with reduced settings
   */
  async fallbackUpload(filePath, groupMetadata, auditLogger) {
    try {
      auditLogger.logFallback('imagen_upload',
        'high_quality', 'standard_quality',
        'High quality upload failed, trying standard quality',
        true
      );

      const formData = new FormData();
      formData.append('image', fs.createReadStream(filePath));
      formData.append('enhancement_type', 'basic');
      formData.append('quality', 'standard');

      const response = await axios.post(
        `${this.imagenApiUrl}/enhance`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.imagenApiKey}`,
            ...formData.getHeaders()
          },
          timeout: 60000 // 1 minute timeout
        }
      );

      const uploadTask = {
        taskId: response.data.task_id,
        fileName: path.basename(filePath),
        status: 'uploaded',
        uploadTime: new Date().toISOString(),
        estimatedCompletionTime: response.data.estimated_completion_time,
        enhancementType: 'basic',
        originalPath: filePath,
        fallback: true
      };

      return {
        success: true,
        task: uploadTask
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Mock upload process for testing
   */
  async mockUploadProcess(inputPath, outputPath, options) {
    const { auditLogger, dryRun } = options;
    
    auditLogger.logEvent('mock_upload_start', {
      reason: 'no_api_key'
    });

    // Find all group directories
    const groupDirs = await this.findGroupDirectories(inputPath);
    let totalFiles = 0;
    const mockTasks = [];

    for (const groupDir of groupDirs) {
      const imageFiles = await this.findImagesInGroup(groupDir);
      totalFiles += imageFiles.length;
      
      // Create mock tasks
      for (const file of imageFiles) {
        mockTasks.push({
          taskId: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          fileName: path.basename(file),
          status: 'uploaded',
          uploadTime: new Date().toISOString(),
          estimatedCompletionTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
          enhancementType: 'auto',
          originalPath: file,
          mockUpload: true
        });
      }
    }

    const results = {
      success: true,
      groupsProcessed: groupDirs.length,
      filesUploaded: totalFiles,
      uploadTasks: mockTasks,
      errors: [],
      mockMode: true,
      duration: 1000 // Mock fast operation
    };

    // Save tracking data
    if (!dryRun) {
      await this.saveUploadTrackingData(outputPath, results);
    }

    auditLogger.logEvent('mock_upload_complete', {
      groups: groupDirs.length,
      files: totalFiles,
      tasks: mockTasks.length
    });

    return results;
  }

  /**
   * Save upload tracking data for download stage
   */
  async saveUploadTrackingData(outputPath, results) {
    const trackingData = {
      uploadTimestamp: new Date().toISOString(),
      totalGroups: results.groupsProcessed,
      totalFiles: results.filesUploaded,
      uploadTasks: results.uploadTasks,
      errors: results.errors,
      mockMode: results.mockMode || false
    };

    const trackingPath = path.join(outputPath, 'upload_tracking.json');
    await fs.writeJson(trackingPath, trackingData, { spaces: 2 });

    // Also save individual task files for easier processing
    const tasksDir = path.join(outputPath, 'tasks');
    await fs.ensureDir(tasksDir);

    for (const task of results.uploadTasks) {
      const taskPath = path.join(tasksDir, `${task.taskId}.json`);
      await fs.writeJson(taskPath, task, { spaces: 2 });
    }
  }

  /**
   * Create upload report
   */
  async createUploadReport(outputPath, results, groupDirs) {
    const report = {
      stage: 'imagen-upload',
      timestamp: new Date().toISOString(),
      summary: {
        totalGroups: groupDirs.length,
        groupsProcessed: results.groupsProcessed,
        filesUploaded: results.filesUploaded,
        uploadTasks: results.uploadTasks.length,
        errors: results.errors.length,
        duration: results.duration,
        mockMode: results.mockMode || false
      },
      uploadTasks: results.uploadTasks.map(task => ({
        taskId: task.taskId,
        fileName: task.fileName,
        status: task.status,
        uploadTime: task.uploadTime,
        enhancementType: task.enhancementType,
        fallback: task.fallback || false,
        mockUpload: task.mockUpload || false
      })),
      errors: results.errors,
      nextSteps: {
        downloadStage: 'Run imagen-download stage to retrieve enhanced images',
        estimatedWaitTime: results.mockMode ? '0 minutes (mock)' : '15-30 minutes',
        trackingFile: 'upload_tracking.json'
      }
    };

    const reportPath = path.join(outputPath, 'upload_report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    return report;
  }
}

module.exports = ImagenUploadStage;