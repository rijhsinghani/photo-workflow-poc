/**
 * Convert Stage - Simplified RAW to JPEG conversion using only dcraw
 * 
 * Removed Sharp dependency since it doesn't support Sony ARW files.
 * Uses dcraw for all RAW conversions with metadata preservation.
 */

const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const MetadataPreserver = require('../lib/metadataPreserver');
const DcrawConverter = require('../lib/dcrawConverter');

class ConvertStage {
  constructor(options = {}) {
    this.auditLogger = options.auditLogger;
    this.supportedFormats = ['.arw', '.cr2', '.nef', '.orf', '.dng', '.raw', '.raf'];
    this.metadataPreserver = new MetadataPreserver(this.auditLogger);
    this.dcrawConverter = new DcrawConverter(this.auditLogger);
  }

  /**
   * Execute the conversion stage
   */
  async execute(options) {
    const startTime = Date.now();
    const { inputPath, outputPath, auditLogger, dryRun = false, mock = false } = options;
    
    // Configuration
    const quality = parseInt(options.quality) || 90;
    const resize = options.resize || null;
    
    auditLogger.logEvent('convert_stage_start', {
      inputPath,
      outputPath,
      quality,
      resize,
      dryRun,
      mock
    });

    try {
      // Initialize dcraw converter
      const dcrawAvailable = await this.dcrawConverter.initialize();
      
      if (!dcrawAvailable && !mock) {
        throw new Error('dcraw is not installed. Install with: brew install dcraw');
      }

      // Find all RAW files
      const rawFiles = await this.findRawFiles(inputPath);
      
      if (rawFiles.length === 0) {
        auditLogger.logEvent('no_raw_files_found', { inputPath });
        return {
          filesProcessed: 0,
          success: true,
          message: 'No RAW files found in input directory'
        };
      }

      auditLogger.logEvent('raw_files_found', {
        totalFiles: rawFiles.length,
        formats: this.getFormatBreakdown(rawFiles)
      });

      // Ensure output directory exists
      await fs.ensureDir(outputPath);

      // Process files
      const results = [];
      const errors = [];
      
      for (const rawFile of rawFiles) {
        const fileName = path.basename(rawFile, path.extname(rawFile));
        const jpegFile = path.join(outputPath, `${fileName}.jpg`);
        
        // Process this file
        auditLogger.startOperation(`convert_${path.basename(rawFile)}`);
        
        try {
            // Extract metadata first
            auditLogger.logEvent('metadata_extraction_start', {
              file: path.basename(rawFile),
              operation: 'comprehensive_exif_read'
            });
            
            const metadata = await this.metadataPreserver.extractMetadata(rawFile);
            
            // Log extracted metadata details
            if (metadata?.timestamps?.primary) {
              auditLogger.logEvent('metadata_extracted_enhanced', {
                file: path.basename(rawFile),
                camera: metadata.full?.Make ? `${metadata.full.Make} ${metadata.full.Model}` : 'Unknown',
                iso: metadata.full?.ISO || 'Unknown',
                aperture: metadata.full?.FNumber || metadata.full?.ApertureValue || 'Unknown',
                shutterSpeed: metadata.full?.ExposureTime || metadata.full?.ShutterSpeedValue || 'Unknown',
                primaryTimestamp: metadata.timestamps.primary.value,
                timestampFields: Object.keys(metadata.timestamps.available).length,
                totalMetadataFields: Object.keys(metadata.full || {}).length
              });
            }

            if (dryRun) {
              auditLogger.logDecision('dry_run_skip', 'skip', {
                file: rawFile,
                wouldConvertTo: jpegFile
              });
              results.push({ 
                input: rawFile, 
                output: jpegFile, 
                dryRun: true,
                metadata: metadata?.timestamps?.primary
              });
              continue;
            }

            // Convert using dcraw
            const conversionResult = await this.dcrawConverter.convert(
              rawFile,
              jpegFile,
              { quality, resize, method: 'auto' }
            );

            // Re-embed critical EXIF metadata (especially timestamps) after dcraw conversion
            if (metadata && metadata.timestamps) {
              auditLogger.logEvent('preserving_timestamps', {
                file: path.basename(jpegFile),
                originalTimestamp: metadata.timestamps.primary?.value
              });
              
              try {
                await this.metadataPreserver.reembedMetadata(jpegFile, metadata);
                auditLogger.logEvent('timestamps_preserved', {
                  file: path.basename(jpegFile),
                  success: true
                });
              } catch (embedError) {
                auditLogger.logError(embedError, {
                  operation: 'timestamp_preservation',
                  file: path.basename(jpegFile)
                });
              }
            }

            // Verify metadata preservation
            const outputMetadata = await this.metadataPreserver.extractMetadata(jpegFile);
            const metadataPreserved = this.verifyMetadataPreservation(metadata, outputMetadata);

            results.push({
              input: rawFile,
              output: jpegFile,
              success: true,
              method: conversionResult.method,
              size: conversionResult.size,
              metadataPreserved,
              timestamp: metadata?.timestamps?.primary?.value
            });

            auditLogger.logEvent('file_converted', {
              input: path.basename(rawFile),
              output: path.basename(jpegFile),
              method: conversionResult.method,
              size: conversionResult.size,
              metadataPreserved
            });

          } catch (error) {
            errors.push({
              file: rawFile,
              error: error.message
            });
            
            auditLogger.logError(error, `Failed to convert ${path.basename(rawFile)}`);
            
            // Log fallback attempts
            auditLogger.logFallback('dcraw_conversion', 'skip_file', error.message, false);
          }
          
          auditLogger.endOperation();
      }

      // Generate conversion report
      const report = {
        stage: 'convert',
        timestamp: new Date().toISOString(),
        summary: {
          totalInputFiles: rawFiles.length,
          filesProcessed: results.length,
          filesSkipped: errors.length,
          errors: errors.length,
          duration: Date.now() - startTime,
          averageTimePerFile: results.length > 0 ? 
            Math.round((Date.now() - startTime) / results.length) : 0
        },
        fileFormats: this.getFormatBreakdown(rawFiles),
        errors,
        outputFiles: results,
        metadataPreservation: {
          filesWithMetadata: results.filter(r => r.metadataPreserved).length,
          timestampVerificationRate: `${Math.round(
            (results.filter(r => r.metadataPreserved).length / results.length) * 100
          )}%`
        }
      };

      // Save report
      await fs.writeJson(
        path.join(outputPath, 'conversion_report.json'),
        report,
        { spaces: 2 }
      );

      auditLogger.logEvent('convert_stage_complete', {
        totalFiles: rawFiles.length,
        filesProcessed: results.length,
        filesSkipped: errors.length,
        errors: errors.length,
        duration: Date.now() - startTime,
        averageTimePerFile: report.summary.averageTimePerFile
      });

      return {
        filesProcessed: results.length,
        success: true,
        duration: Date.now() - startTime
      };

    } catch (error) {
      auditLogger.logError(error, 'Convert stage failed');
      throw error;
    }
  }

  /**
   * Find all RAW files in input directory
   */
  async findRawFiles(inputPath) {
    const patterns = this.supportedFormats.map(ext => 
      path.join(inputPath, `**/*${ext}`)
    );
    
    const files = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, { nocase: true });
      files.push(...matches);
    }
    
    return files;
  }

  /**
   * Get format breakdown of files
   */
  getFormatBreakdown(files) {
    const breakdown = {};
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      breakdown[ext] = (breakdown[ext] || 0) + 1;
    }
    return breakdown;
  }

  /**
   * Verify metadata preservation between original and converted files
   */
  verifyMetadataPreservation(originalMeta, convertedMeta) {
    if (!originalMeta?.timestamps?.primary || !convertedMeta?.timestamps?.primary) {
      return false;
    }
    
    // Check if primary timestamp matches
    const origTime = originalMeta.timestamps.primary.value;
    const convTime = convertedMeta.timestamps.primary.value;
    
    return origTime === convTime;
  }
}

module.exports = ConvertStage;