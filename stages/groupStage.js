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
      // Load Stage 2 results if available
      const stage2Results = await this.loadStage2Results(inputPath, auditLogger);
      
      // Find all image files
      const imageFiles = await this.findImageFiles(inputPath);
      
      auditLogger.logEvent('images_found', {
        totalFiles: imageFiles.length,
        formats: this.getFormatStats(imageFiles),
        hasStage2Data: stage2Results !== null
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

      // Extract metadata and timestamps (enhanced with Stage 2 data)
      auditLogger.logEvent('metadata_extraction_start', {
        totalFiles: imageFiles.length,
        usingStage2Data: stage2Results !== null
      });

      const imageMetadata = await this.extractAllMetadata(imageFiles, auditLogger, stage2Results);
      
      // Perform temporal grouping (respecting Stage 2 duplicate groups)
      const temporalGroups = this.createTemporalGroups(imageMetadata, timeThreshold, auditLogger, stage2Results);
      
      // Refine groups with visual similarity (using Stage 2 duplicate info)
      const finalGroups = await this.refineGroupsWithSimilarity(temporalGroups, auditLogger, stage2Results);
      
      // Select representatives for Stage 4 (Imagen processing)
      const representatives = this.selectGroupRepresentatives(finalGroups, stage2Results, auditLogger);
      
      // Create group directories and organize files
      const results = {
        success: true,
        filesProcessed: imageFiles.length,
        groupsCreated: finalGroups.length,
        groups: [],
        duration: 0
      };

      if (!dryRun) {
        await this.organizeFilesIntoGroups(finalGroups, outputPath, auditLogger, representatives);
        results.groups = finalGroups.map(group => ({
          name: group.name,
          fileCount: group.files.length,
          timeSpan: group.timeSpan,
          averageTimestamp: group.averageTimestamp,
          representatives: representatives.filter(r => r.groupName === group.name).length
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
      
      // Save comprehensive representatives.json in parent output folder
      if (representatives.length > 0) {
        const representativesPath = path.join(path.dirname(outputPath), 'representatives.json');
        
        // Create comprehensive master list with all metadata
        const comprehensiveReps = representatives.map(rep => ({
          ...rep,
          // Add full metadata for each representative
          metadata: finalGroups
            .find(g => g.name === rep.groupName)
            ?.files.find(f => f.fileName === rep.fileName),
          // Add group statistics
          groupStats: {
            totalMembers: finalGroups.find(g => g.name === rep.groupName)?.files.length || 1,
            duplicateGroups: rep.isDuplicateRepresentative ? 1 : 0
          }
        }));
        
        await fs.writeJson(representativesPath, {
          stage: 'group',
          timestamp: new Date().toISOString(),
          workflowId: 'photo-workflow',
          totalRepresentatives: representatives.length,
          totalGroups: finalGroups.length,
          totalImages: imageFiles.length,
          compressionRatio: (imageFiles.length / representatives.length).toFixed(2),
          representatives: comprehensiveReps,
          groupSummary: finalGroups.map(g => ({
            name: g.name,
            fileCount: g.files.length,
            representatives: representatives.filter(r => r.groupName === g.name).length,
            hasDuplicates: g.files.some(f => f.duplicateGroupId)
          }))
        }, { spaces: 2 });
        
        auditLogger.logEvent('comprehensive_representatives_saved', {
          path: representativesPath,
          count: representatives.length,
          compressionRatio: (imageFiles.length / representatives.length).toFixed(2)
        });
        
        console.log(`\n✅ Master representatives list saved: ${representativesPath}`);
        console.log(`   📊 Compression: ${imageFiles.length} images → ${representatives.length} representatives`);
      }
      
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
   * Load Stage 2 culling results if available
   */
  async loadStage2Results(inputPath, auditLogger) {
    try {
      const cullingReportPath = path.join(inputPath, 'culling_report.json');
      
      if (await fs.pathExists(cullingReportPath)) {
        const stage2Data = await fs.readJson(cullingReportPath);
        
        auditLogger.logEvent('stage2_results_loaded', {
          selectedFiles: stage2Data.selectedFiles?.length || 0,
          duplicateGroups: stage2Data.duplicateGroups?.length || 0,
          qualityIssues: stage2Data.qualityIssues?.length || 0,
          suggestedGroupings: stage2Data.suggestedGroupings?.length || 0
        });
        
        // Create lookup maps for efficient access
        const qualityMap = new Map();
        const duplicateMap = new Map();
        
        // Map quality scores
        if (stage2Data.selectedFiles) {
          stage2Data.selectedFiles.forEach(file => {
            qualityMap.set(file.file, {
              rating: file.rating,
              reasoning: file.reasoning
            });
          });
        }
        
        // Map duplicate groups
        if (stage2Data.duplicateGroups) {
          stage2Data.duplicateGroups.forEach(group => {
            group.images.forEach(img => {
              duplicateMap.set(img, {
                groupId: group.group_id,
                isBest: img === group.best,
                groupDescription: group.description
              });
            });
          });
        }
        
        return {
          raw: stage2Data,
          qualityMap,
          duplicateMap,
          suggestedGroupings: stage2Data.suggestedGroupings || [],
          duplicateGroups: stage2Data.duplicateGroups || [],
          groupingWarnings: stage2Data.groupingWarnings || []
        };
      }
      
      auditLogger.logEvent('no_stage2_results', {
        reason: 'culling_report.json not found',
        path: cullingReportPath
      });
      
      return null;
      
    } catch (error) {
      auditLogger.logError(error, {
        operation: 'load_stage2_results',
        inputPath
      });
      return null;
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
  async extractAllMetadata(imageFiles, auditLogger, stage2Results = null) {
    auditLogger.startOperation('extract_all_metadata');
    
    const metadata = [];
    let processed = 0;
    let errors = 0;
    let enrichedFromStage2 = 0;

    for (const file of imageFiles) {
      try {
        const meta = await this.extractImageMetadata(file);
        
        // Enhance with Stage 2 data if available
        if (stage2Results) {
          const fileName = path.basename(file);
          
          // Add quality rating
          if (stage2Results.qualityMap.has(fileName)) {
            const quality = stage2Results.qualityMap.get(fileName);
            meta.qualityRating = quality.rating;
            meta.qualityReasoning = quality.reasoning;
            enrichedFromStage2++;
          }
          
          // Add duplicate group info
          if (stage2Results.duplicateMap.has(fileName)) {
            const dupInfo = stage2Results.duplicateMap.get(fileName);
            meta.duplicateGroupId = dupInfo.groupId;
            meta.isDuplicateBest = dupInfo.isBest;
            meta.duplicateGroupDescription = dupInfo.groupDescription;
          }
        }
        
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
      enrichedFromStage2,
      successRate: ((processed / imageFiles.length) * 100).toFixed(2) + '%'
    });

    return metadata.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * Extract metadata from a single image
   */
  async extractImageMetadata(filePath) {
    try {
      // Extract EXIF data including exposure settings
      const exif = await exifr.parse(filePath, {
        pick: ['DateTime', 'DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'GPS',
               'ISO', 'ISOSpeedRatings', 'ExposureTime', 'FNumber', 'ApertureValue',
               'ShutterSpeedValue', 'ExposureProgram', 'ExposureMode']
      });

      // Get file stats
      const stats = await fs.stat(filePath);
      
      // Determine best timestamp
      const timestamp = this.getBestTimestamp(exif, stats);
      
      // Get basic image info from EXIF
      const width = exif?.ImageWidth || exif?.ExifImageWidth || null;
      const height = exif?.ImageHeight || exif?.ExifImageHeight || null;

      return {
        filePath,
        fileName: path.basename(filePath),
        timestamp,
        camera: exif?.Make && exif?.Model ? `${exif.Make} ${exif.Model}` : 'Unknown',
        width,
        height,
        fileSize: stats.size,
        gps: exif?.GPS || null,
        // Exposure settings for grouping
        exposure: {
          iso: exif?.ISO || exif?.ISOSpeedRatings || null,
          aperture: exif?.FNumber || exif?.ApertureValue || null,
          shutterSpeed: exif?.ExposureTime || exif?.ShutterSpeedValue || null,
          exposureProgram: exif?.ExposureProgram || null
        },
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
  createTemporalGroups(imageMetadata, timeThreshold, auditLogger, stage2Results = null) {
    auditLogger.startOperation('create_temporal_groups');
    
    const groups = [];
    let currentGroup = null;
    
    // If we have Stage 2 suggested groupings, use them as initial structure
    const suggestedGroupings = stage2Results?.suggestedGroupings || [];
    
    for (const image of imageMetadata) {
      const imageTime = new Date(image.timestamp);
      
      if (!currentGroup) {
        // Start first group
        currentGroup = this.createNewGroup(image, groups.length + 1);
      } else {
        // Check if image fits in current group
        const lastImageTime = new Date(currentGroup.lastTimestamp);
        const timeDiff = differenceInMinutes(imageTime, lastImageTime);
        
        // Special handling for duplicate groups - never split them
        const sameGroup = this.shouldKeepInSameGroup(
          currentGroup, 
          image, 
          timeDiff, 
          timeThreshold, 
          stage2Results
        );
        
        if (sameGroup) {
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
              previousGroup: groups[groups.length - 1]?.name,
              newGroupStartTime: image.timestamp,
              duplicateGroupRespected: image.duplicateGroupId ? 'yes' : 'no'
            },
            'new_group',
            `Time gap of ${timeDiff} minutes exceeded threshold or duplicate group boundary`
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
   * Determine if image should stay in current group (time + exposure)
   */
  shouldKeepInSameGroup(currentGroup, image, timeDiff, timeThreshold, stage2Results) {
    // 1. Check time threshold (can be up to 60 minutes if exposure matches)
    const maxTimeGap = 60; // minutes
    const timeReasonable = Math.abs(timeDiff) <= maxTimeGap;
    
    if (!timeReasonable) {
      return false; // Too much time has passed
    }
    
    // 2. Check exposure similarity
    const exposureSimilar = this.isExposureSimilar(currentGroup, image);
    
    // 3. Both time AND exposure must be similar
    const shouldGroup = timeReasonable && exposureSimilar;
    
    // 4. Check for Stage 2 grouping warnings (Gemini sanity check)
    if (shouldGroup && stage2Results?.groupingWarnings) {
      const warnings = stage2Results.groupingWarnings;
      
      // Check if any warning involves both current group images and this image
      for (const warning of warnings) {
        const groupFileNames = currentGroup.files.map(f => f.fileName);
        const hasGroupFile = warning.images.some(img => groupFileNames.includes(img));
        const hasCurrentFile = warning.images.includes(image.fileName);
        
        if (hasGroupFile && hasCurrentFile && warning.severity === 'high') {
          this.auditLogger?.logDecision('gemini_grouping_warning',
            { 
              fileName: image.fileName,
              warningType: warning.warning_type,
              severity: warning.severity,
              description: warning.description,
              recommendation: warning.recommendation
            },
            'separate_group',
            `Gemini detected: ${warning.description}`
          );
          return false;
        }
      }
    }
    
    // Legacy check for quality issues (backward compatibility)
    if (shouldGroup && stage2Results?.qualityIssues) {
      const geminiWarning = stage2Results.qualityIssues.find(issue => 
        issue.type === 'grouping_warning' &&
        issue.images?.includes(image.fileName)
      );
      
      if (geminiWarning) {
        this.auditLogger?.logDecision('gemini_grouping_veto',
          { 
            fileName: image.fileName,
            reason: geminiWarning.description,
            currentGroup: currentGroup.name
          },
          'separate_group',
          `Gemini detected incompatible lighting despite similar exposure`
        );
        return false;
      }
    }
    
    // 5. Special case: Keep duplicate groups together
    if (stage2Results && image.duplicateGroupId) {
      const groupHasSameDuplicates = currentGroup.files.some(
        f => f.duplicateGroupId === image.duplicateGroupId
      );
      if (groupHasSameDuplicates) {
        return true; // Keep duplicates together
      }
    }
    
    return shouldGroup;
  }
  
  /**
   * Check if exposure settings are similar enough for grouping
   */
  isExposureSimilar(group, image) {
    if (!image.exposure || group.files.length === 0) {
      return true; // No exposure data, fall back to time-based
    }
    
    // Get average exposure of current group
    const groupExposures = group.files
      .filter(f => f.exposure && f.exposure.iso)
      .map(f => f.exposure);
    
    if (groupExposures.length === 0) {
      return true; // No exposure data in group
    }
    
    // Calculate group averages
    const avgISO = groupExposures.reduce((sum, e) => sum + (e.iso || 0), 0) / groupExposures.length;
    const avgAperture = groupExposures.reduce((sum, e) => sum + (e.aperture || 0), 0) / groupExposures.length;
    
    // Check if image exposure is similar to group average
    const isoSimilar = !image.exposure.iso || 
                       Math.abs(image.exposure.iso - avgISO) <= 400; // Allow 2 stops difference
    const apertureSimilar = !image.exposure.aperture || 
                            Math.abs(image.exposure.aperture - avgAperture) <= 1.5; // Allow 1.5 stops
    
    return isoSimilar && apertureSimilar;
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
   * Refine groups with visual similarity analysis (respecting duplicate groups)
   */
  async refineGroupsWithSimilarity(temporalGroups, auditLogger, stage2Results = null) {
    auditLogger.logEvent('similarity_analysis_start', {
      groupCount: temporalGroups.length,
      hasStage2Data: stage2Results !== null
    });

    const refinedGroups = [];

    for (const group of temporalGroups) {
      // Split very large groups (>50 images) into smaller sub-groups
      // But respect duplicate groups when splitting
      if (group.files.length > 50) {
        auditLogger.logDecision('split_large_group',
          { groupName: group.name, size: group.files.length },
          'split',
          `Group too large (${group.files.length} images), splitting intelligently`
        );
        
        const subGroups = this.splitLargeGroupIntelligently(group, stage2Results);
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
   * Split large groups intelligently (respecting duplicate groups)
   */
  splitLargeGroupIntelligently(group, stage2Results = null, maxSize = 25) {
    const subGroups = [];
    const files = group.files;
    
    if (!stage2Results || !stage2Results.duplicateGroups) {
      // Fall back to basic splitting if no Stage 2 data
      return this.splitLargeGroup(group, maxSize);
    }
    
    // Group files by their duplicate group ID
    const duplicateSets = new Map();
    const standaloneFiles = [];
    
    files.forEach(file => {
      if (file.duplicateGroupId) {
        if (!duplicateSets.has(file.duplicateGroupId)) {
          duplicateSets.set(file.duplicateGroupId, []);
        }
        duplicateSets.get(file.duplicateGroupId).push(file);
      } else {
        standaloneFiles.push(file);
      }
    });
    
    // Build sub-groups keeping duplicate sets together
    let currentSubGroup = [];
    let subGroupNumber = 1;
    
    // Add duplicate sets first (they must stay together)
    for (const [groupId, duplicateFiles] of duplicateSets) {
      if (currentSubGroup.length + duplicateFiles.length > maxSize && currentSubGroup.length > 0) {
        // Create sub-group
        subGroups.push(this.createSubGroup(group, currentSubGroup, subGroupNumber++));
        currentSubGroup = [];
      }
      currentSubGroup.push(...duplicateFiles);
    }
    
    // Add standalone files
    for (const file of standaloneFiles) {
      if (currentSubGroup.length >= maxSize) {
        subGroups.push(this.createSubGroup(group, currentSubGroup, subGroupNumber++));
        currentSubGroup = [];
      }
      currentSubGroup.push(file);
    }
    
    // Add remaining files
    if (currentSubGroup.length > 0) {
      subGroups.push(this.createSubGroup(group, currentSubGroup, subGroupNumber));
    }
    
    return subGroups;
  }

  /**
   * Create a sub-group from parent group
   */
  createSubGroup(parentGroup, files, subGroupNumber) {
    const subGroup = {
      name: `${parentGroup.name}_Part${subGroupNumber}`,
      files: files,
      startTimestamp: files[0].timestamp,
      lastTimestamp: files[files.length - 1].timestamp,
      cameras: new Set(files.map(f => f.camera)),
      locations: files.filter(f => f.gps).map(f => f.gps),
      parentGroup: parentGroup.name
    };
    
    // Calculate time span and average timestamp
    const startTime = new Date(subGroup.startTimestamp);
    const endTime = new Date(subGroup.lastTimestamp);
    subGroup.timeSpan = differenceInMinutes(endTime, startTime);
    
    const timestamps = files.map(f => new Date(f.timestamp).getTime());
    const avgTime = timestamps.reduce((sum, time) => sum + time, 0) / timestamps.length;
    subGroup.averageTimestamp = new Date(avgTime).toISOString();
    
    return subGroup;
  }

  /**
   * Split large groups into smaller sub-groups (basic fallback)
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
   * Select representative images for Stage 4 processing
   */
  selectGroupRepresentatives(groups, stage2Results, auditLogger) {
    auditLogger.startOperation('select_representatives');
    
    const representatives = [];
    
    for (const group of groups) {
      const duplicateGroups = new Map();
      const standaloneImages = [];
      
      // Organize by duplicate groups
      group.files.forEach(file => {
        if (file.duplicateGroupId) {
          if (!duplicateGroups.has(file.duplicateGroupId)) {
            duplicateGroups.set(file.duplicateGroupId, []);
          }
          duplicateGroups.get(file.duplicateGroupId).push(file);
        } else {
          standaloneImages.push(file);
        }
      });
      
      // Select best from each duplicate group
      for (const [groupId, files] of duplicateGroups) {
        const bestFile = files.find(f => f.isDuplicateBest) || 
                        files.sort((a, b) => (b.qualityRating || 0) - (a.qualityRating || 0))[0];
        
        representatives.push({
          fileName: bestFile.fileName,
          filePath: bestFile.filePath,
          groupName: group.name,
          duplicateGroupId: groupId,
          isDuplicateRepresentative: true,
          duplicateCount: files.length,
          qualityRating: bestFile.qualityRating
        });
      }
      
      // Select best standalone images (up to 3 per group)
      const bestStandalone = standaloneImages
        .sort((a, b) => (b.qualityRating || 0) - (a.qualityRating || 0))
        .slice(0, 3);
      
      bestStandalone.forEach(file => {
        representatives.push({
          fileName: file.fileName,
          filePath: file.filePath,
          groupName: group.name,
          duplicateGroupId: null,
          isDuplicateRepresentative: false,
          duplicateCount: 1,
          qualityRating: file.qualityRating
        });
      });
    }
    
    auditLogger.endOperation({
      totalGroups: groups.length,
      totalRepresentatives: representatives.length,
      duplicateRepresentatives: representatives.filter(r => r.isDuplicateRepresentative).length,
      standaloneRepresentatives: representatives.filter(r => !r.isDuplicateRepresentative).length
    });
    
    return representatives;
  }

  /**
   * Organize files into group directories with simplified structure and macOS tags
   */
  async organizeFilesIntoGroups(groups, outputPath, auditLogger, representatives = []) {
    auditLogger.startOperation('organize_files_into_groups');
    
    let totalFilesCopied = 0;
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Helper function to apply macOS Finder tag
    const applyFinderTag = async (filePath, color) => {
      try {
        // Use xattr to set Finder tags
        // Green = 2, Blue = 4
        const tagValue = color === 'green' ? '2' : '4';
        const plistData = `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
<string>${tagValue}</string>
</array>
</plist>`;
        
        // Write plist to temp file and apply with xattr
        const tempFile = `/tmp/tag_${Date.now()}.plist`;
        await fs.writeFile(tempFile, plistData);
        await execAsync(`xattr -w com.apple.metadata:_kMDItemUserTags '${plistData}' "${filePath}"`);
        await fs.remove(tempFile);
        
        auditLogger.logEvent('finder_tag_applied', {
          file: path.basename(filePath),
          color
        });
      } catch (error) {
        auditLogger.logError(error, {
          operation: 'apply_finder_tag',
          file: filePath,
          color
        });
      }
    };
    
    for (const group of groups) {
      const groupDir = path.join(outputPath, group.name);
      await fs.ensureDir(groupDir);
      
      auditLogger.logEvent('group_directory_created', {
        groupName: group.name,
        groupDir,
        fileCount: group.files.length
      });
      
      // Get representatives for this group
      const groupReps = representatives.filter(r => r.groupName === group.name);
      const repFileNames = new Set(groupReps.map(r => r.fileName));
      
      // Copy all files to group directory with appropriate tags
      for (const imageFile of group.files) {
        const sourcePath = imageFile.filePath;
        const fileName = imageFile.fileName;
        const targetPath = path.join(groupDir, fileName);
        
        try {
          await fs.copy(sourcePath, targetPath);
          
          // Apply appropriate Finder tag
          const isRepresentative = repFileNames.has(fileName);
          if (isRepresentative) {
            await applyFinderTag(targetPath, 'green');
            auditLogger.logEvent('representative_tagged', {
              file: fileName,
              group: group.name
            });
          } else {
            await applyFinderTag(targetPath, 'blue');
            auditLogger.logEvent('member_tagged', {
              file: fileName,
              group: group.name
            });
          }
          
          totalFilesCopied++;
          
        } catch (error) {
          auditLogger.logError(error, {
            source: sourcePath,
            target: targetPath,
            group: group.name,
            operation: 'copy_file_to_group'
          });
        }
      }
      
      // Create group metadata file (enhanced with Stage 2 data and representatives)
      const groupRepresentatives = representatives.filter(r => r.groupName === group.name);
      await this.createGroupMetadataFile(groupDir, group, groupRepresentatives);
    }
    
    auditLogger.endOperation({
      totalGroups: groups.length,
      totalFilesCopied
    });
  }

  /**
   * Create metadata file for each group (enhanced with Stage 2 data)
   */
  async createGroupMetadataFile(groupDir, group, representatives = []) {
    // Calculate duplicate groups in this group
    const duplicateGroupsMap = new Map();
    group.files.forEach(f => {
      if (f.duplicateGroupId) {
        if (!duplicateGroupsMap.has(f.duplicateGroupId)) {
          duplicateGroupsMap.set(f.duplicateGroupId, {
            id: f.duplicateGroupId,
            files: [],
            best: null,
            description: f.duplicateGroupDescription
          });
        }
        duplicateGroupsMap.get(f.duplicateGroupId).files.push(f.fileName);
        if (f.isDuplicateBest) {
          duplicateGroupsMap.get(f.duplicateGroupId).best = f.fileName;
        }
      }
    });
    
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
      // Stage 2 integration
      duplicateGroups: Array.from(duplicateGroupsMap.values()),
      representatives: representatives.map(r => ({
        fileName: r.fileName,
        isDuplicateRepresentative: r.isDuplicateRepresentative,
        duplicateGroupId: r.duplicateGroupId,
        duplicateCount: r.duplicateCount,
        qualityRating: r.qualityRating
      })),
      // Enhanced file metadata
      files: group.files.map(f => ({
        fileName: f.fileName,
        timestamp: f.timestamp,
        camera: f.camera,
        fileSize: f.fileSize,
        dimensions: f.width && f.height ? `${f.width}x${f.height}` : null,
        // Stage 2 enhancements
        qualityRating: f.qualityRating || null,
        duplicateGroupId: f.duplicateGroupId || null,
        isDuplicateBest: f.isDuplicateBest || false
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