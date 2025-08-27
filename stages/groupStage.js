/**
 * Group Stage - Smart grouping by time and visual similarity
 * 
 * Groups photos based on temporal proximity and visual similarity
 * to create logical collections for delivery.
 */

const fs = require('fs-extra');
const path = require('path');
const exifr = require('exifr');
const { glob } = require('glob');
const { differenceInMinutes, parseISO } = require('date-fns');
const sharp = require('sharp');
const HtmlReportGenerator = require('../lib/htmlReportGenerator');

class GroupStage {
  constructor(options = {}) {
    this.auditLogger = options.auditLogger;
    this.supportedFormats = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
    this.defaultTimeThreshold = 15; // minutes
    this.htmlReportGenerator = new HtmlReportGenerator({
      outputDir: options.outputDir || './output',
      verbose: options.verbose || false
    });
  }

  /**
   * Execute the grouping stage
   */
  async execute(options) {
    const startTime = Date.now();
    const { inputPath, outputPath, auditLogger, dryRun = false } = options;
    
    // Configuration
    const timeThreshold = parseInt(options.timeThreshold) || this.defaultTimeThreshold;
    
    auditLogger.logEvent('group_stage_start', {
      inputPath,
      outputPath,
      timeThreshold,
      dryRun
    });

    try {
      // Find all image files
      const imageFiles = await this.findImageFiles(inputPath);
      
      auditLogger.logEvent('images_found', {
        totalFiles: imageFiles.length,
        formats: this.getFormatStats(imageFiles)
      });

      if (imageFiles.length === 0) {
        auditLogger.logDecision('no_images_found',
          { inputPath },
          'skip_grouping',
          'No image files found in input directory'
        );
        
        return {
          success: true,
          filesProcessed: 0,
          groupsCreated: 0,
          duration: Date.now() - startTime
        };
      }

      // Extract metadata and timestamps
      auditLogger.logEvent('metadata_extraction_start', {
        totalFiles: imageFiles.length
      });

      const imageMetadata = await this.extractAllMetadata(imageFiles, auditLogger);
      
      // Perform temporal grouping
      const temporalGroups = this.createTemporalGroups(imageMetadata, timeThreshold, auditLogger);
      
      // Refine groups with visual similarity (if enough time/resources)
      const finalGroups = await this.refineGroupsWithSimilarity(temporalGroups, auditLogger);
      
      // Create group directories and organize files
      const results = {
        success: true,
        filesProcessed: imageFiles.length,
        groupsCreated: finalGroups.length,
        groups: [],
        duration: 0
      };

      if (!dryRun) {
        await this.organizeFilesIntoGroups(finalGroups, outputPath, auditLogger);
        results.groups = finalGroups.map(group => ({
          name: group.name,
          fileCount: group.files.length,
          timeSpan: group.timeSpan,
          averageTimestamp: group.averageTimestamp
        }));
      } else {
        auditLogger.logEvent('dry_run_grouping', {
          totalGroups: finalGroups.length,
          groupSizes: finalGroups.map(g => g.files.length)
        });
        results.groups = finalGroups.map(group => ({
          name: group.name,
          fileCount: group.files.length,
          timeSpan: group.timeSpan
        }));
      }

      results.duration = Date.now() - startTime;
      
      // Log grouping summary
      auditLogger.logEvent('group_stage_complete', {
        totalFiles: imageFiles.length,
        filesProcessed: results.filesProcessed,
        groupsCreated: results.groupsCreated,
        averageGroupSize: Math.round(results.filesProcessed / results.groupsCreated),
        duration: results.duration
      });

      // Create JSON grouping report
      await this.createGroupingReport(outputPath, results, finalGroups);
      
      // Generate HTML visual report
      try {
        const reportResult = await this.htmlReportGenerator.generateGroupingReport(
          finalGroups, 
          { duration: results.duration }, 
          auditLogger
        );
        
        auditLogger.logEvent('html_visual_report_generated', {
          reportPath: reportResult.reportPath,
          thumbnailCount: reportResult.thumbnailCount,
          groupCount: reportResult.groupCount
        });
        
        console.log(`\n📊 Visual report generated: ${reportResult.reportPath}`);
        
      } catch (error) {
        auditLogger.logError(error, {
          operation: 'generate_html_visual_report',
          stage: 'group'
        }, 'warning');
        console.warn('Warning: Could not generate HTML visual report:', error.message);
      }

      return results;

    } catch (error) {
      auditLogger.logError(error, {
        operation: 'group_stage_execution',
        inputPath,
        outputPath
      }, 'critical');
      
      return {
        success: false,
        error: error.message,
        filesProcessed: 0,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Find all image files in directory
   */
  async findImageFiles(inputPath) {
    try {
      const patterns = this.supportedFormats.map(ext => `**/*${ext}`);
      const allFiles = [];
      
      for (const pattern of patterns) {
        const files = await glob(pattern, { 
          cwd: inputPath, 
          nocase: true,
          absolute: true 
        });
        allFiles.push(...files);
      }
      
      return [...new Set(allFiles)].sort();
      
    } catch (error) {
      this.auditLogger?.logError(error, {
        operation: 'find_image_files',
        inputPath
      });
      throw error;
    }
  }

  /**
   * Extract metadata from all images
   */
  async extractAllMetadata(imageFiles, auditLogger) {
    auditLogger.startOperation('extract_all_metadata');
    
    const metadata = [];
    let processed = 0;
    let errors = 0;

    for (const file of imageFiles) {
      try {
        const meta = await this.extractImageMetadata(file);
        metadata.push(meta);
        processed++;
        
        if (processed % 10 === 0) {
          auditLogger.logEvent('metadata_progress', {
            processed,
            total: imageFiles.length,
            errors
          });
        }
        
      } catch (error) {
        auditLogger.logError(error, {
          file,
          operation: 'extract_single_metadata'
        });
        
        // Create fallback metadata
        const fallbackMeta = await this.createFallbackMetadata(file);
        metadata.push(fallbackMeta);
        errors++;
      }
    }

    auditLogger.endOperation({
      totalFiles: imageFiles.length,
      processed,
      errors,
      successRate: ((processed / imageFiles.length) * 100).toFixed(2) + '%'
    });

    return metadata.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * Extract metadata from a single image
   */
  async extractImageMetadata(filePath) {
    try {
      // Extract EXIF data
      const exif = await exifr.parse(filePath, {
        pick: ['DateTime', 'DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'GPS']
      });

      // Get file stats
      const stats = await fs.stat(filePath);
      
      // Determine best timestamp
      const timestamp = this.getBestTimestamp(exif, stats);
      
      // Get basic image info
      const imageInfo = await sharp(filePath).metadata();

      return {
        filePath,
        fileName: path.basename(filePath),
        timestamp,
        camera: exif?.Make && exif?.Model ? `${exif.Make} ${exif.Model}` : 'Unknown',
        width: imageInfo.width,
        height: imageInfo.height,
        fileSize: stats.size,
        gps: exif?.GPS || null,
        exif: {
          DateTime: exif?.DateTime,
          DateTimeOriginal: exif?.DateTimeOriginal,
          CreateDate: exif?.CreateDate
        }
      };

    } catch (error) {
      throw new Error(`Failed to extract metadata from ${filePath}: ${error.message}`);
    }
  }

  /**
   * Get best timestamp from available sources
   */
  getBestTimestamp(exif, fileStats) {
    // Priority: DateTimeOriginal > DateTime > CreateDate > file mtime
    const candidates = [
      exif?.DateTimeOriginal,
      exif?.DateTime,
      exif?.CreateDate,
      fileStats.mtime
    ].filter(Boolean);

    if (candidates.length === 0) {
      return fileStats.mtime.toISOString();
    }

    // Convert to ISO string if needed
    const timestamp = candidates[0];
    if (timestamp instanceof Date) {
      return timestamp.toISOString();
    }
    
    try {
      return new Date(timestamp).toISOString();
    } catch (error) {
      return fileStats.mtime.toISOString();
    }
  }

  /**
   * Create fallback metadata when extraction fails
   */
  async createFallbackMetadata(filePath) {
    const stats = await fs.stat(filePath);
    
    return {
      filePath,
      fileName: path.basename(filePath),
      timestamp: stats.mtime.toISOString(),
      camera: 'Unknown',
      width: null,
      height: null,
      fileSize: stats.size,
      gps: null,
      exif: {},
      fallback: true
    };
  }

  /**
   * Create temporal groups based on time proximity
   */
  createTemporalGroups(imageMetadata, timeThreshold, auditLogger) {
    auditLogger.startOperation('create_temporal_groups');
    
    const groups = [];
    let currentGroup = null;
    
    for (const image of imageMetadata) {
      const imageTime = new Date(image.timestamp);
      
      if (!currentGroup) {
        // Start first group
        currentGroup = this.createNewGroup(image, groups.length + 1);
      } else {
        // Check if image fits in current group
        const lastImageTime = new Date(currentGroup.lastTimestamp);
        const timeDiff = differenceInMinutes(imageTime, lastImageTime);
        
        if (Math.abs(timeDiff) <= timeThreshold) {
          // Add to current group
          this.addToGroup(currentGroup, image);
        } else {
          // Start new group
          groups.push(currentGroup);
          currentGroup = this.createNewGroup(image, groups.length + 1);
          
          auditLogger.logDecision('new_group_created',
            { 
              timeDiff, 
              timeThreshold,
              previousGroup: currentGroup?.name,
              newGroupStartTime: image.timestamp
            },
            'new_group',
            `Time gap of ${timeDiff} minutes exceeded threshold of ${timeThreshold} minutes`
          );
        }
      }
    }
    
    // Add final group
    if (currentGroup) {
      groups.push(currentGroup);
    }
    
    auditLogger.endOperation({
      totalGroups: groups.length,
      averageGroupSize: Math.round(imageMetadata.length / groups.length),
      groupSizes: groups.map(g => g.files.length)
    });

    return groups;
  }

  /**
   * Create a new group
   */
  createNewGroup(firstImage, groupNumber) {
    const timestamp = new Date(firstImage.timestamp);
    const groupName = `Group_${groupNumber.toString().padStart(2, '0')}_${this.formatTimestamp(timestamp)}`;
    
    return {
      name: groupName,
      files: [firstImage],
      startTimestamp: firstImage.timestamp,
      lastTimestamp: firstImage.timestamp,
      averageTimestamp: firstImage.timestamp,
      cameras: new Set([firstImage.camera]),
      locations: firstImage.gps ? [firstImage.gps] : []
    };
  }

  /**
   * Add image to existing group
   */
  addToGroup(group, image) {
    group.files.push(image);
    group.lastTimestamp = image.timestamp;
    group.cameras.add(image.camera);
    
    if (image.gps) {
      group.locations.push(image.gps);
    }
    
    // Update average timestamp
    const timestamps = group.files.map(f => new Date(f.timestamp).getTime());
    const avgTime = timestamps.reduce((sum, time) => sum + time, 0) / timestamps.length;
    group.averageTimestamp = new Date(avgTime).toISOString();
    
    // Calculate time span
    const startTime = new Date(group.startTimestamp);
    const endTime = new Date(group.lastTimestamp);
    group.timeSpan = differenceInMinutes(endTime, startTime);
  }

  /**
   * Refine groups with visual similarity analysis (basic implementation)
   */
  async refineGroupsWithSimilarity(temporalGroups, auditLogger) {
    auditLogger.logEvent('similarity_analysis_start', {
      groupCount: temporalGroups.length
    });

    // For now, we'll implement basic refinement
    // In a full implementation, you could:
    // 1. Extract visual features using image hashing
    // 2. Split groups that have very different visual content
    // 3. Merge small adjacent groups with similar content

    const refinedGroups = [];

    for (const group of temporalGroups) {
      // Split very large groups (>50 images) into smaller sub-groups
      if (group.files.length > 50) {
        auditLogger.logDecision('split_large_group',
          { groupName: group.name, size: group.files.length },
          'split',
          `Group too large (${group.files.length} images), splitting into sub-groups`
        );
        
        const subGroups = this.splitLargeGroup(group);
        refinedGroups.push(...subGroups);
      } else {
        refinedGroups.push(group);
      }
    }

    auditLogger.logEvent('similarity_analysis_complete', {
      originalGroups: temporalGroups.length,
      refinedGroups: refinedGroups.length
    });

    return refinedGroups;
  }

  /**
   * Split large groups into smaller sub-groups
   */
  splitLargeGroup(group, maxSize = 25) {
    const subGroups = [];
    const files = group.files;
    
    for (let i = 0; i < files.length; i += maxSize) {
      const subGroupFiles = files.slice(i, i + maxSize);
      const subGroupNumber = Math.floor(i / maxSize) + 1;
      
      const subGroup = {
        name: `${group.name}_Part${subGroupNumber}`,
        files: subGroupFiles,
        startTimestamp: subGroupFiles[0].timestamp,
        lastTimestamp: subGroupFiles[subGroupFiles.length - 1].timestamp,
        cameras: new Set(subGroupFiles.map(f => f.camera)),
        locations: subGroupFiles.filter(f => f.gps).map(f => f.gps),
        parentGroup: group.name
      };
      
      // Calculate time span and average timestamp
      const startTime = new Date(subGroup.startTimestamp);
      const endTime = new Date(subGroup.lastTimestamp);
      subGroup.timeSpan = differenceInMinutes(endTime, startTime);
      
      const timestamps = subGroupFiles.map(f => new Date(f.timestamp).getTime());
      const avgTime = timestamps.reduce((sum, time) => sum + time, 0) / timestamps.length;
      subGroup.averageTimestamp = new Date(avgTime).toISOString();
      
      subGroups.push(subGroup);
    }
    
    return subGroups;
  }

  /**
   * Organize files into group directories
   */
  async organizeFilesIntoGroups(groups, outputPath, auditLogger) {
    auditLogger.startOperation('organize_files_into_groups');
    
    let totalFilesCopied = 0;
    
    for (const group of groups) {
      const groupDir = path.join(outputPath, group.name);
      await fs.ensureDir(groupDir);
      
      auditLogger.logEvent('group_directory_created', {
        groupName: group.name,
        groupDir,
        fileCount: group.files.length
      });
      
      for (const imageFile of group.files) {
        const sourcePath = imageFile.filePath;
        const fileName = imageFile.fileName;
        const targetPath = path.join(groupDir, fileName);
        
        try {
          await fs.copy(sourcePath, targetPath);
          totalFilesCopied++;
          
          // Log every 10th file to avoid spam
          if (totalFilesCopied % 10 === 0) {
            auditLogger.logEvent('file_copy_progress', {
              filesCopied: totalFilesCopied,
              currentGroup: group.name
            });
          }
          
        } catch (error) {
          auditLogger.logError(error, {
            source: sourcePath,
            target: targetPath,
            group: group.name,
            operation: 'copy_file_to_group'
          });
        }
      }
      
      // Create group metadata file
      await this.createGroupMetadataFile(groupDir, group);
    }
    
    auditLogger.endOperation({
      totalGroups: groups.length,
      totalFilesCopied
    });
  }

  /**
   * Create metadata file for each group
   */
  async createGroupMetadataFile(groupDir, group) {
    const metadata = {
      groupName: group.name,
      createdAt: new Date().toISOString(),
      fileCount: group.files.length,
      timeSpan: {
        start: group.startTimestamp,
        end: group.lastTimestamp,
        durationMinutes: group.timeSpan || 0
      },
      cameras: Array.from(group.cameras || []),
      locations: group.locations || [],
      files: group.files.map(f => ({
        fileName: f.fileName,
        timestamp: f.timestamp,
        camera: f.camera,
        fileSize: f.fileSize,
        dimensions: f.width && f.height ? `${f.width}x${f.height}` : null
      }))
    };
    
    const metadataPath = path.join(groupDir, 'group_metadata.json');
    await fs.writeJson(metadataPath, metadata, { spaces: 2 });
  }

  /**
   * Format timestamp for group names
   */
  formatTimestamp(date) {
    return date.toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .substring(0, 16); // YYYY-MM-DD_HH-MM
  }

  /**
   * Get format statistics
   */
  getFormatStats(files) {
    const stats = {};
    files.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      stats[ext] = (stats[ext] || 0) + 1;
    });
    return stats;
  }

  /**
   * Create grouping report
   */
  async createGroupingReport(outputPath, results, groups) {
    const report = {
      stage: 'group',
      timestamp: new Date().toISOString(),
      summary: {
        totalInputFiles: results.filesProcessed,
        groupsCreated: results.groupsCreated,
        averageGroupSize: Math.round(results.filesProcessed / results.groupsCreated),
        duration: results.duration
      },
      groupDetails: groups.map(group => ({
        name: group.name,
        fileCount: group.files.length,
        timeSpan: {
          start: group.startTimestamp,
          end: group.lastTimestamp,
          durationMinutes: group.timeSpan || 0
        },
        cameras: Array.from(group.cameras || []),
        hasLocation: (group.locations || []).length > 0,
        averageFileSize: group.files.reduce((sum, f) => sum + (f.fileSize || 0), 0) / group.files.length
      })),
      statistics: {
        groupSizeDistribution: this.calculateGroupSizeDistribution(groups),
        timeSpanDistribution: this.calculateTimeSpanDistribution(groups),
        cameraDistribution: this.calculateCameraDistribution(groups)
      }
    };

    const reportPath = path.join(outputPath, 'grouping_report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    return report;
  }

  /**
   * Calculate group size distribution
   */
  calculateGroupSizeDistribution(groups) {
    const distribution = {
      '1-5': 0,
      '6-15': 0,
      '16-30': 0,
      '31-50': 0,
      '50+': 0
    };

    groups.forEach(group => {
      const size = group.files.length;
      if (size <= 5) distribution['1-5']++;
      else if (size <= 15) distribution['6-15']++;
      else if (size <= 30) distribution['16-30']++;
      else if (size <= 50) distribution['31-50']++;
      else distribution['50+']++;
    });

    return distribution;
  }

  /**
   * Calculate time span distribution
   */
  calculateTimeSpanDistribution(groups) {
    const distribution = {
      '0-15min': 0,
      '16-60min': 0,
      '1-4hrs': 0,
      '4+ hrs': 0
    };

    groups.forEach(group => {
      const span = group.timeSpan || 0;
      if (span <= 15) distribution['0-15min']++;
      else if (span <= 60) distribution['16-60min']++;
      else if (span <= 240) distribution['1-4hrs']++;
      else distribution['4+ hrs']++;
    });

    return distribution;
  }

  /**
   * Calculate camera distribution
   */
  calculateCameraDistribution(groups) {
    const allCameras = {};
    
    groups.forEach(group => {
      Array.from(group.cameras || []).forEach(camera => {
        allCameras[camera] = (allCameras[camera] || 0) + 1;
      });
    });

    return allCameras;
  }
}

module.exports = GroupStage;