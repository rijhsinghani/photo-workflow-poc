/**
 * Imagen Download Stage - Download enhanced photos from Imagen AI
 * 
 * Checks upload status and downloads completed enhanced images,
 * organizing them for the finalization stage.
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream');
const { promisify } = require('util');

const streamPipeline = promisify(pipeline);

class ImagenDownloadStage {
  constructor(options = {}) {
    this.auditLogger = options.auditLogger;
    this.imagenApiKey = process.env.IMAGEN_API_KEY;
    this.imagenApiUrl = process.env.IMAGEN_API_URL || 'https://api.imagen-ai.com/v1';
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    this.batchSize = 10;
  }

  /**
   * Execute the download stage
   */
  async execute(options) {
    const startTime = Date.now();
    const { inputPath, outputPath, auditLogger, dryRun = false } = options;
    
    auditLogger.logEvent('imagen_download_stage_start', {
      inputPath,
      outputPath,
      dryRun,
      hasApiKey: !!this.imagenApiKey
    });

    try {
      // Load upload tracking data
      const trackingData = await this.loadUploadTrackingData(inputPath);
      
      if (!trackingData) {
        auditLogger.logDecision('no_tracking_data',
          { inputPath },
          'skip_download',
          'No upload tracking data found - run imagen-upload stage first'
        );
        
        return {
          success: false,
          error: 'No upload tracking data found',
          tasksProcessed: 0,
          filesDownloaded: 0,
          duration: Date.now() - startTime
        };
      }

      auditLogger.logEvent('tracking_data_loaded', {
        totalTasks: trackingData.uploadTasks.length,
        mockMode: trackingData.mockMode,
        uploadTimestamp: trackingData.uploadTimestamp
      });

      // Handle mock mode
      if (trackingData.mockMode && !this.imagenApiKey) {
        auditLogger.logFallback('imagen_download',
          'imagen_api', 'mock_download',
          'Mock mode detected and no API key available, creating mock downloads',
          true
        );
        
        return await this.mockDownloadProcess(trackingData, outputPath, options);
      }

      // Check API key for real downloads
      if (!this.imagenApiKey && !trackingData.mockMode) {
        auditLogger.logError(new Error('Imagen API key required for real downloads'), {
          operation: 'api_key_check'
        });
        
        return {
          success: false,
          error: 'Imagen API key required',
          tasksProcessed: 0,
          filesDownloaded: 0,
          duration: Date.now() - startTime
        };
      }

      // Process download tasks
      const results = {
        success: true,
        tasksProcessed: 0,
        filesDownloaded: 0,
        errors: [],
        completedTasks: [],
        pendingTasks: [],
        failedTasks: [],
        duration: 0
      };

      // Process tasks in batches
      const batches = this.createBatches(trackingData.uploadTasks, this.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        auditLogger.logEvent('batch_download_start', {
          batch: i + 1,
          totalBatches: batches.length,
          batchSize: batch.length
        });

        try {
          const batchResults = await this.processBatch(batch, outputPath, {
            auditLogger,
            dryRun
          });
          
          results.tasksProcessed += batchResults.tasksProcessed;
          results.filesDownloaded += batchResults.filesDownloaded;
          results.completedTasks.push(...batchResults.completedTasks);
          results.pendingTasks.push(...batchResults.pendingTasks);
          results.failedTasks.push(...batchResults.failedTasks);
          results.errors.push(...batchResults.errors);
          
        } catch (error) {
          auditLogger.logError(error, {
            batch: i + 1,
            batchTasks: batch.map(t => t.taskId),
            operation: 'batch_download'
          });
          
          results.errors.push({
            batch: i + 1,
            error: error.message,
            tasks: batch.map(t => t.taskId)
          });
        }
      }

      results.duration = Date.now() - startTime;
      
      // Save download results
      await this.saveDownloadResults(outputPath, results, trackingData);
      
      // Log download summary
      auditLogger.logEvent('imagen_download_stage_complete', {
        totalTasks: trackingData.uploadTasks.length,
        tasksProcessed: results.tasksProcessed,
        filesDownloaded: results.filesDownloaded,
        completedTasks: results.completedTasks.length,
        pendingTasks: results.pendingTasks.length,
        failedTasks: results.failedTasks.length,
        errors: results.errors.length,
        duration: results.duration
      });

      // Create download report
      await this.createDownloadReport(outputPath, results, trackingData);

      return results;

    } catch (error) {
      auditLogger.logError(error, {
        operation: 'imagen_download_stage_execution',
        inputPath,
        outputPath
      }, 'critical');
      
      return {
        success: false,
        error: error.message,
        tasksProcessed: 0,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Load upload tracking data
   */
  async loadUploadTrackingData(inputPath) {
    try {
      const trackingPath = path.join(inputPath, 'upload_tracking.json');
      
      if (!await fs.pathExists(trackingPath)) {
        return null;
      }
      
      return await fs.readJson(trackingPath);
      
    } catch (error) {
      this.auditLogger?.logError(error, {
        operation: 'load_upload_tracking_data',
        inputPath
      });
      return null;
    }
  }

  /**
   * Create batches for processing
   */
  createBatches(tasks, batchSize) {
    const batches = [];
    for (let i = 0; i < tasks.length; i += batchSize) {
      batches.push(tasks.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a batch of download tasks
   */
  async processBatch(batch, outputPath, options) {
    const { auditLogger, dryRun } = options;
    
    const results = {
      tasksProcessed: 0,
      filesDownloaded: 0,
      completedTasks: [],
      pendingTasks: [],
      failedTasks: [],
      errors: []
    };

    for (const task of batch) {
      try {
        const taskResult = await this.processTask(task, outputPath, {
          auditLogger,
          dryRun
        });
        
        results.tasksProcessed++;
        
        if (taskResult.status === 'completed') {
          results.filesDownloaded++;
          results.completedTasks.push(taskResult);
        } else if (taskResult.status === 'pending') {
          results.pendingTasks.push(taskResult);
        } else {
          results.failedTasks.push(taskResult);
        }
        
      } catch (error) {
        auditLogger.logError(error, {
          taskId: task.taskId,
          fileName: task.fileName,
          operation: 'process_single_task'
        });
        
        results.errors.push({
          taskId: task.taskId,
          fileName: task.fileName,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Process a single download task
   */
  async processTask(task, outputPath, options) {
    const { auditLogger, dryRun } = options;
    
    auditLogger.startOperation(`download_${task.fileName}`);
    
    try {
      // Handle mock tasks
      if (task.mockUpload) {
        return await this.processMockTask(task, outputPath, options);
      }

      // Check task status
      const statusResult = await this.checkTaskStatus(task.taskId);
      
      auditLogger.logEvent('task_status_checked', {
        taskId: task.taskId,
        fileName: task.fileName,
        status: statusResult.status,
        progress: statusResult.progress
      });

      if (statusResult.status === 'completed') {
        // Download the enhanced image
        if (!dryRun) {
          const downloadResult = await this.downloadEnhancedImage(
            task, 
            statusResult.downloadUrl, 
            outputPath, 
            auditLogger
          );
          
          auditLogger.endOperation({
            status: 'completed',
            downloaded: true,
            fileSize: downloadResult.fileSize
          });
          
          return {
            ...task,
            status: 'completed',
            downloadTime: new Date().toISOString(),
            enhancedPath: downloadResult.filePath,
            fileSize: downloadResult.fileSize,
            downloadUrl: statusResult.downloadUrl
          };
        } else {
          auditLogger.logEvent('dry_run_download', {
            taskId: task.taskId,
            fileName: task.fileName,
            downloadUrl: statusResult.downloadUrl
          });
          
          auditLogger.endOperation({ dryRun: true });
          
          return {
            ...task,
            status: 'completed',
            dryRun: true
          };
        }
        
      } else if (statusResult.status === 'processing') {
        auditLogger.logDecision('task_still_processing',
          { taskId: task.taskId, progress: statusResult.progress },
          'wait',
          `Task still processing (${statusResult.progress}% complete)`
        );
        
        auditLogger.endOperation({ status: 'pending' });
        
        return {
          ...task,
          status: 'pending',
          progress: statusResult.progress,
          lastChecked: new Date().toISOString()
        };
        
      } else if (statusResult.status === 'failed') {
        auditLogger.logError(new Error(`Task failed: ${statusResult.error}`), {
          taskId: task.taskId,
          fileName: task.fileName,
          operation: 'task_processing_failed'
        });
        
        auditLogger.endOperation({ status: 'failed' });
        
        return {
          ...task,
          status: 'failed',
          error: statusResult.error,
          lastChecked: new Date().toISOString()
        };
      }

    } catch (error) {
      auditLogger.endOperation({ error: error.message });
      
      return {
        ...task,
        status: 'error',
        error: error.message,
        lastChecked: new Date().toISOString()
      };
    }
  }

  /**
   * Check task status via API
   */
  async checkTaskStatus(taskId) {
    try {
      const response = await axios.get(
        `${this.imagenApiUrl}/tasks/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.imagenApiKey}`
          },
          timeout: 30000
        }
      );

      return {
        status: response.data.status,
        progress: response.data.progress || 0,
        downloadUrl: response.data.download_url,
        error: response.data.error_message
      };

    } catch (error) {
      if (error.response?.status === 404) {
        return {
          status: 'not_found',
          error: 'Task not found'
        };
      }
      
      throw error;
    }
  }

  /**
   * Download enhanced image
   */
  async downloadEnhancedImage(task, downloadUrl, outputPath, auditLogger) {
    const fileName = `enhanced_${task.fileName}`;
    const filePath = path.join(outputPath, fileName);
    
    try {
      // Download file
      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 60000 // 1 minute timeout
      });

      // Save to file
      await streamPipeline(response.data, fs.createWriteStream(filePath));
      
      // Verify file
      const stats = await fs.stat(filePath);
      
      auditLogger.logEvent('image_downloaded', {
        taskId: task.taskId,
        fileName: task.fileName,
        enhancedFileName: fileName,
        fileSize: stats.size,
        originalPath: task.originalPath
      });

      return {
        filePath,
        fileSize: stats.size
      };

    } catch (error) {
      // Clean up partial download
      try {
        await fs.remove(filePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      throw error;
    }
  }

  /**
   * Process mock task (for testing)
   */
  async processMockTask(task, outputPath, options) {
    const { auditLogger, dryRun } = options;
    
    auditLogger.logEvent('processing_mock_task', {
      taskId: task.taskId,
      fileName: task.fileName
    });

    if (dryRun) {
      auditLogger.endOperation({ mockTask: true, dryRun: true });
      
      return {
        ...task,
        status: 'completed',
        dryRun: true,
        mockDownload: true
      };
    }

    // Create mock enhanced image by copying original
    const originalPath = task.originalPath;
    const enhancedFileName = `enhanced_${task.fileName}`;
    const enhancedPath = path.join(outputPath, enhancedFileName);
    
    if (await fs.pathExists(originalPath)) {
      await fs.copy(originalPath, enhancedPath);
      
      const stats = await fs.stat(enhancedPath);
      
      auditLogger.logEvent('mock_image_created', {
        taskId: task.taskId,
        originalPath,
        enhancedPath,
        fileSize: stats.size
      });
      
      auditLogger.endOperation({ 
        mockDownload: true,
        fileSize: stats.size 
      });
      
      return {
        ...task,
        status: 'completed',
        downloadTime: new Date().toISOString(),
        enhancedPath,
        fileSize: stats.size,
        mockDownload: true
      };
    } else {
      throw new Error(`Original file not found: ${originalPath}`);
    }
  }

  /**
   * Mock download process for testing
   */
  async mockDownloadProcess(trackingData, outputPath, options) {
    const { auditLogger, dryRun } = options;
    
    auditLogger.logEvent('mock_download_start', {
      totalTasks: trackingData.uploadTasks.length
    });

    const results = {
      success: true,
      tasksProcessed: trackingData.uploadTasks.length,
      filesDownloaded: trackingData.uploadTasks.length,
      completedTasks: [],
      pendingTasks: [],
      failedTasks: [],
      errors: [],
      mockMode: true,
      duration: 2000 // Mock 2 second operation
    };

    if (!dryRun) {
      // Create mock enhanced images
      for (const task of trackingData.uploadTasks) {
        try {
          const mockResult = await this.processMockTask(task, outputPath, {
            auditLogger,
            dryRun: false
          });
          results.completedTasks.push(mockResult);
        } catch (error) {
          results.errors.push({
            taskId: task.taskId,
            error: error.message
          });
          results.failedTasks.push({
            ...task,
            status: 'failed',
            error: error.message
          });
        }
      }
    } else {
      // Simulate successful completion
      results.completedTasks = trackingData.uploadTasks.map(task => ({
        ...task,
        status: 'completed',
        dryRun: true,
        mockDownload: true
      }));
    }

    auditLogger.logEvent('mock_download_complete', {
      completed: results.completedTasks.length,
      failed: results.failedTasks.length
    });

    return results;
  }

  /**
   * Save download results
   */
  async saveDownloadResults(outputPath, results, originalTrackingData) {
    const downloadResults = {
      downloadTimestamp: new Date().toISOString(),
      originalUploadData: originalTrackingData,
      downloadResults: {
        tasksProcessed: results.tasksProcessed,
        filesDownloaded: results.filesDownloaded,
        completedTasks: results.completedTasks,
        pendingTasks: results.pendingTasks,
        failedTasks: results.failedTasks,
        errors: results.errors
      },
      mockMode: results.mockMode || false
    };

    const resultsPath = path.join(outputPath, 'download_results.json');
    await fs.writeJson(resultsPath, downloadResults, { spaces: 2 });

    // Save individual enhanced file mappings
    const mappingsPath = path.join(outputPath, 'enhanced_mappings.json');
    const mappings = results.completedTasks.map(task => ({
      originalFile: task.originalPath,
      enhancedFile: task.enhancedPath,
      taskId: task.taskId,
      downloadTime: task.downloadTime,
      fileSize: task.fileSize
    }));
    
    await fs.writeJson(mappingsPath, mappings, { spaces: 2 });
  }

  /**
   * Create download report
   */
  async createDownloadReport(outputPath, results, originalTrackingData) {
    const report = {
      stage: 'imagen-download',
      timestamp: new Date().toISOString(),
      summary: {
        totalUploadedTasks: originalTrackingData.uploadTasks.length,
        tasksProcessed: results.tasksProcessed,
        filesDownloaded: results.filesDownloaded,
        completedTasks: results.completedTasks.length,
        pendingTasks: results.pendingTasks.length,
        failedTasks: results.failedTasks.length,
        errors: results.errors.length,
        duration: results.duration,
        mockMode: results.mockMode || false,
        successRate: ((results.filesDownloaded / results.tasksProcessed) * 100).toFixed(2) + '%'
      },
      taskStatus: {
        completed: results.completedTasks.map(task => ({
          taskId: task.taskId,
          fileName: task.fileName,
          enhancedPath: task.enhancedPath,
          fileSize: task.fileSize,
          downloadTime: task.downloadTime
        })),
        pending: results.pendingTasks.map(task => ({
          taskId: task.taskId,
          fileName: task.fileName,
          progress: task.progress,
          lastChecked: task.lastChecked
        })),
        failed: results.failedTasks.map(task => ({
          taskId: task.taskId,
          fileName: task.fileName,
          error: task.error,
          lastChecked: task.lastChecked
        }))
      },
      nextSteps: {
        finalizeStage: 'Run finalize stage to apply XMP metadata and export',
        pendingTasksNote: results.pendingTasks.length > 0 
          ? `${results.pendingTasks.length} tasks still pending - re-run download stage later`
          : 'All tasks completed',
        enhancedMappingsFile: 'enhanced_mappings.json'
      }
    };

    const reportPath = path.join(outputPath, 'download_report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    return report;
  }
}

module.exports = ImagenDownloadStage;