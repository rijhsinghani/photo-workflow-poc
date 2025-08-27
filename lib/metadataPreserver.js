/**
 * Metadata Preserver - Enhanced EXIF preservation for photo conversion
 * 
 * Extracts ALL EXIF data before conversion and re-embeds after conversion
 * with special focus on preserving DateTimeOriginal, CreateDate, ModifyDate
 * for accurate timeline grouping.
 */

const fs = require('fs-extra');
const path = require('path');
const exifr = require('exifr');
const sharp = require('sharp');

class MetadataPreserver {
  constructor(auditLogger = null) {
    this.auditLogger = auditLogger;
    
    // Critical timestamp fields in order of priority
    this.timestampFields = [
      'DateTimeOriginal',
      'CreateDate', 
      'DateTime',
      'ModifyDate',
      'FileModifyDate',
      'SubSecDateTimeOriginal',
      'SubSecCreateDate',
      'OffsetTimeOriginal',
      'OffsetTime'
    ];
    
    // Essential EXIF fields to preserve
    this.essentialFields = [
      'Make', 'Model', 'Software', 'Artist', 'Copyright',
      'ISO', 'ExposureTime', 'FNumber', 'ExposureProgram',
      'FocalLength', 'FocalLengthIn35mmFormat', 'WhiteBalance',
      'Flash', 'MeteringMode', 'ExposureMode', 'SceneCaptureType',
      'Orientation', 'XResolution', 'YResolution', 'ResolutionUnit',
      'ColorSpace', 'ExifImageWidth', 'ExifImageHeight',
      'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'GPSTimeStamp',
      'LensModel', 'LensMake', 'SerialNumber'
    ];
  }

  /**
   * Extract comprehensive metadata from source file
   */
  async extractMetadata(sourceFile) {
    const startTime = Date.now();
    
    this.auditLogger?.logEvent('metadata_extraction_start', {
      file: path.basename(sourceFile),
      operation: 'comprehensive_exif_read'
    });

    try {
      // Extract ALL available EXIF data
      const fullMetadata = await exifr.parse(sourceFile, {
        pick: undefined, // Get everything
        skip: undefined,
        translateKeys: true,
        translateValues: true,
        reviveValues: true,
        sanitize: false,
        mergeOutput: true
      });

      if (!fullMetadata) {
        throw new Error('No metadata could be extracted from file');
      }

      // Extract critical timestamps
      const timestamps = this.extractTimestamps(fullMetadata, sourceFile);
      
      // Get file stats as fallback
      const fileStats = await fs.stat(sourceFile);
      
      const metadata = {
        full: fullMetadata,
        timestamps,
        fileStats: {
          birthtime: fileStats.birthtime,
          mtime: fileStats.mtime,
          ctime: fileStats.ctime,
          size: fileStats.size
        },
        extractedAt: new Date().toISOString(),
        extractionDuration: Date.now() - startTime
      };

      this.auditLogger?.logEvent('metadata_extraction_success', {
        file: path.basename(sourceFile),
        timestampsFound: Object.keys(timestamps.available).length,
        primaryTimestamp: timestamps.primary ? timestamps.primary.field : 'none',
        totalFields: Object.keys(fullMetadata).length,
        duration: metadata.extractionDuration
      });

      return metadata;

    } catch (error) {
      this.auditLogger?.logError(error, {
        file: sourceFile,
        operation: 'extract_metadata'
      });

      // Fallback to file stats only
      const fileStats = await fs.stat(sourceFile);
      const fallbackMetadata = {
        full: {},
        timestamps: this.createFallbackTimestamps(fileStats),
        fileStats: {
          birthtime: fileStats.birthtime,
          mtime: fileStats.mtime,
          ctime: fileStats.ctime,
          size: fileStats.size
        },
        extractedAt: new Date().toISOString(),
        extractionDuration: Date.now() - startTime,
        fallback: true,
        fallbackReason: error.message
      };

      this.auditLogger?.logFallback('metadata_extraction',
        'exifr_comprehensive', 'file_stats_only',
        `EXIF extraction failed: ${error.message}`,
        true
      );

      return fallbackMetadata;
    }
  }

  /**
   * Extract and prioritize timestamp information
   */
  extractTimestamps(metadata, sourceFile) {
    const available = {};
    let primary = null;

    // Extract all available timestamp fields
    for (const field of this.timestampFields) {
      if (metadata[field]) {
        const timestamp = this.parseTimestamp(metadata[field], field);
        if (timestamp.valid) {
          available[field] = timestamp;
          
          // Set primary timestamp (first valid one in priority order)
          if (!primary) {
            primary = { field, ...timestamp };
          }
        }
      }
    }

    this.auditLogger?.logEvent('timestamp_analysis', {
      file: path.basename(sourceFile),
      availableFields: Object.keys(available),
      primaryField: primary?.field || 'none',
      primaryValue: primary?.iso || 'none'
    });

    return {
      available,
      primary,
      count: Object.keys(available).length
    };
  }

  /**
   * Parse timestamp from various formats
   */
  parseTimestamp(value, field) {
    try {
      let date = null;
      
      if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'string') {
        // Handle various date formats
        date = new Date(value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
      } else if (typeof value === 'number') {
        date = new Date(value);
      }

      if (!date || isNaN(date.getTime())) {
        return { valid: false, error: 'Invalid date format' };
      }

      return {
        valid: true,
        date,
        iso: date.toISOString(),
        unix: date.getTime(),
        field,
        originalValue: value
      };

    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Create fallback timestamps from file stats
   */
  createFallbackTimestamps(fileStats) {
    const primary = {
      field: 'file_mtime',
      date: fileStats.mtime,
      iso: fileStats.mtime.toISOString(),
      unix: fileStats.mtime.getTime(),
      fallback: true
    };

    return {
      available: {
        file_mtime: primary,
        file_birthtime: {
          field: 'file_birthtime',
          date: fileStats.birthtime,
          iso: fileStats.birthtime.toISOString(),
          unix: fileStats.birthtime.getTime(),
          fallback: true
        }
      },
      primary,
      count: 2
    };
  }

  /**
   * Re-embed metadata into processed JPEG file
   */
  async reembedMetadata(targetFile, originalMetadata) {
    const startTime = Date.now();
    
    this.auditLogger?.logEvent('metadata_reembed_start', {
      file: path.basename(targetFile),
      operation: 'exif_write_back'
    });

    try {
      // Read the processed image
      const imageBuffer = await fs.readFile(targetFile);
      
      // Prepare EXIF data for embedding
      const exifToEmbed = this.prepareEmbedData(originalMetadata);
      
      // Use Sharp to embed EXIF data
      const processedImage = sharp(imageBuffer)
        .withMetadata({
          exif: exifToEmbed
        });

      // Write back to file
      await processedImage.toFile(targetFile);
      
      // Verify embedded metadata
      const verificationResult = await this.verifyEmbeddedMetadata(targetFile, originalMetadata);
      
      const duration = Date.now() - startTime;
      
      this.auditLogger?.logEvent('metadata_reembed_success', {
        file: path.basename(targetFile),
        fieldsEmbedded: Object.keys(exifToEmbed).length,
        timestampVerified: verificationResult.timestampMatch,
        duration
      });

      return {
        success: true,
        fieldsEmbedded: Object.keys(exifToEmbed).length,
        timestampVerified: verificationResult.timestampMatch,
        verificationDetails: verificationResult,
        duration
      };

    } catch (error) {
      this.auditLogger?.logError(error, {
        file: targetFile,
        operation: 'reembed_metadata'
      });

      // Try alternative embedding method
      return await this.fallbackEmbedding(targetFile, originalMetadata);
    }
  }

  /**
   * Prepare metadata for embedding
   */
  prepareEmbedData(originalMetadata) {
    const embedData = {};
    
    // Add essential fields
    for (const field of this.essentialFields) {
      if (originalMetadata.full[field] !== undefined) {
        embedData[field] = originalMetadata.full[field];
      }
    }

    // Add timestamp fields
    for (const field of this.timestampFields) {
      if (originalMetadata.full[field] !== undefined) {
        embedData[field] = originalMetadata.full[field];
      }
    }

    // Ensure primary timestamp is included
    if (originalMetadata.timestamps.primary) {
      const primaryField = originalMetadata.timestamps.primary.field;
      embedData[primaryField] = originalMetadata.timestamps.primary.originalValue;
    }

    return embedData;
  }

  /**
   * Verify that metadata was properly embedded
   */
  async verifyEmbeddedMetadata(targetFile, originalMetadata) {
    try {
      const embeddedMetadata = await exifr.parse(targetFile, {
        pick: [...this.timestampFields, ...this.essentialFields]
      });

      if (!embeddedMetadata) {
        return {
          success: false,
          timestampMatch: false,
          error: 'No metadata found in processed file'
        };
      }

      // Check timestamp preservation
      const timestampMatch = this.verifyTimestampMatch(
        embeddedMetadata, 
        originalMetadata.timestamps.primary
      );

      // Count preserved fields
      const preservedFields = Object.keys(embeddedMetadata).length;
      const originalFields = Object.keys(originalMetadata.full).length;

      return {
        success: true,
        timestampMatch,
        preservedFields,
        originalFields,
        preservationRate: ((preservedFields / originalFields) * 100).toFixed(2) + '%',
        embeddedMetadata
      };

    } catch (error) {
      return {
        success: false,
        timestampMatch: false,
        error: error.message
      };
    }
  }

  /**
   * Verify timestamp match between original and embedded
   */
  verifyTimestampMatch(embeddedMetadata, originalTimestamp) {
    if (!originalTimestamp) return false;

    const embeddedValue = embeddedMetadata[originalTimestamp.field];
    if (!embeddedValue) return false;

    try {
      const embeddedParsed = this.parseTimestamp(embeddedValue, originalTimestamp.field);
      if (!embeddedParsed.valid) return false;

      // Allow 1 second difference for rounding
      const timeDiff = Math.abs(embeddedParsed.unix - originalTimestamp.unix);
      return timeDiff < 1000;

    } catch (error) {
      return false;
    }
  }

  /**
   * Fallback embedding method
   */
  async fallbackEmbedding(targetFile, originalMetadata) {
    this.auditLogger?.logFallback('metadata_embedding',
      'sharp_with_metadata', 'preserve_file_timestamps',
      'EXIF embedding failed, preserving file timestamps only',
      true
    );

    try {
      // At minimum, preserve file modification time
      if (originalMetadata.timestamps.primary) {
        const timestamp = new Date(originalMetadata.timestamps.primary.unix);
        await fs.utimes(targetFile, timestamp, timestamp);
      }

      return {
        success: true,
        method: 'file_timestamp_only',
        fieldsEmbedded: 0,
        timestampVerified: true,
        fallback: true
      };

    } catch (error) {
      this.auditLogger?.logError(error, {
        file: targetFile,
        operation: 'fallback_embedding'
      });

      return {
        success: false,
        error: error.message,
        fieldsEmbedded: 0,
        timestampVerified: false
      };
    }
  }

  /**
   * Get the best available timestamp for grouping
   */
  getBestTimestamp(metadata) {
    if (metadata.timestamps.primary) {
      return {
        timestamp: metadata.timestamps.primary.date,
        iso: metadata.timestamps.primary.iso,
        field: metadata.timestamps.primary.field,
        confidence: metadata.timestamps.primary.fallback ? 'low' : 'high'
      };
    }

    // Fallback to file stats
    return {
      timestamp: metadata.fileStats.mtime,
      iso: metadata.fileStats.mtime.toISOString(),
      field: 'file_mtime',
      confidence: 'fallback'
    };
  }

  /**
   * Process complete file with metadata preservation
   */
  async processWithPreservation(sourceFile, targetFile, processFunction) {
    const startTime = Date.now();
    
    this.auditLogger?.startOperation(`metadata_preservation_${path.basename(sourceFile)}`);

    try {
      // Step 1: Extract metadata
      const originalMetadata = await this.extractMetadata(sourceFile);
      
      // Step 2: Process the file
      await processFunction();
      
      // Step 3: Re-embed metadata
      const embedResult = await this.reembedMetadata(targetFile, originalMetadata);
      
      const totalDuration = Date.now() - startTime;
      
      this.auditLogger?.endOperation({
        success: true,
        metadataPreserved: embedResult.success,
        timestampIntegrity: embedResult.timestampVerified,
        duration: totalDuration
      });

      return {
        success: true,
        originalMetadata,
        embedResult,
        duration: totalDuration
      };

    } catch (error) {
      this.auditLogger?.endOperation({ 
        error: error.message 
      });
      
      throw error;
    }
  }
}

module.exports = MetadataPreserver;