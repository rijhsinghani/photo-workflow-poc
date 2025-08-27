/**
 * Convert Stage - RAW to JPEG conversion with metadata preservation
 * 
 * Converts RAW files (ARW, CR2, NEF, etc.) to high-quality JPEG
 * while preserving EXIF metadata and applying basic corrections.
 */

const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const exifr = require('exifr');
const { glob } = require('glob');
const MetadataPreserver = require('../lib/metadataPreserver');

class ConvertStage {
  constructor(options = {}) {
    this.auditLogger = options.auditLogger;
    this.supportedFormats = ['.arw', '.cr2', '.nef', '.orf', '.dng', '.raw', '.raf'];
    this.metadataPreserver = new MetadataPreserver(this.auditLogger);
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
      // Handle mock mode
      if (mock) {
        return await this.mockConversionProcess(inputPath, outputPath, options, startTime);
      }

      // Find all RAW files
      const rawFiles = await this.findRawFiles(inputPath);
      
      auditLogger.logEvent('raw_files_found', {
        totalFiles: rawFiles.length,
        formats: this.getFormatStats(rawFiles)
      });

      if (rawFiles.length === 0) {
        auditLogger.logDecision('no_raw_files', 
          { inputPath },
          'skip_conversion',
          'No RAW files found in input directory'
        );
        
        return {
          success: true,
          filesProcessed: 0,
          filesSkipped: 0,
          duration: Date.now() - startTime
        };
      }

      // Process files
      const results = {
        success: true,
        filesProcessed: 0,
        filesSkipped: 0,
        errors: [],
        duration: 0,
        outputFiles: []
      };

      for (const rawFile of rawFiles) {
        try {
          const result = await this.processRawFile(rawFile, outputPath, {
            quality,
            resize,
            dryRun,
            auditLogger
          });
          
          if (result.success) {
            results.filesProcessed++;
            results.outputFiles.push(result.outputFile);
          } else {
            results.filesSkipped++;
            results.errors.push({
              file: rawFile,
              error: result.error
            });
          }
          
        } catch (error) {
          auditLogger.logError(error, {
            file: rawFile,
            operation: 'convert_single_file'
          });
          
          results.errors.push({
            file: rawFile,
            error: error.message
          });
          results.filesSkipped++;
        }
      }

      results.duration = Date.now() - startTime;
      
      // Log conversion summary
      auditLogger.logEvent('convert_stage_complete', {
        totalFiles: rawFiles.length,
        filesProcessed: results.filesProcessed,
        filesSkipped: results.filesSkipped,
        errors: results.errors.length,
        duration: results.duration,
        averageTimePerFile: results.filesProcessed > 0 ? results.duration / results.filesProcessed : 0
      });

      // Create conversion report
      await this.createConversionReport(outputPath, results, rawFiles);

      return results;

    } catch (error) {
      auditLogger.logError(error, {
        operation: 'convert_stage_execution',
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
   * Find all RAW files in directory
   */
  async findRawFiles(inputPath) {
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
      
      // Remove duplicates and sort
      return [...new Set(allFiles)].sort();
      
    } catch (error) {
      this.auditLogger?.logError(error, {
        operation: 'find_raw_files',
        inputPath
      });
      throw error;
    }
  }

  /**
   * Process a single RAW file
   */
  async processRawFile(inputFile, outputDir, options) {
    const { quality, resize, dryRun, auditLogger } = options;
    
    auditLogger.startOperation(`convert_${path.basename(inputFile)}`);
    
    try {
      // Generate output filename
      const inputName = path.parse(inputFile).name;
      const outputFile = path.join(outputDir, `${inputName}.jpg`);
      
      // Check if output already exists
      if (await fs.pathExists(outputFile) && !options.force) {
        auditLogger.logDecision('file_exists', 
          { inputFile, outputFile },
          'skip',
          'Output file already exists and --force not specified'
        );
        
        auditLogger.endOperation({ skipped: true });
        return { success: false, error: 'File already exists', outputFile };
      }

      // Extract comprehensive metadata using enhanced preserver
      let originalMetadata = null;
      try {
        originalMetadata = await this.metadataPreserver.extractMetadata(inputFile);
        
        auditLogger.logEvent('metadata_extracted_enhanced', {
          file: path.basename(inputFile),
          camera: originalMetadata.full.Make && originalMetadata.full.Model ? 
                  `${originalMetadata.full.Make} ${originalMetadata.full.Model}` : 'Unknown',
          iso: originalMetadata.full.ISO,
          aperture: originalMetadata.full.FNumber,
          shutterSpeed: originalMetadata.full.ExposureTime,
          primaryTimestamp: originalMetadata.timestamps.primary?.iso || 'none',
          timestampFields: originalMetadata.timestamps.count,
          totalMetadataFields: Object.keys(originalMetadata.full).length
        });
        
      } catch (metaError) {
        auditLogger.logError(metaError, {
          file: inputFile,
          operation: 'enhanced_metadata_extraction'
        });
        
        auditLogger.logFallback('metadata_extraction', 
          'enhanced_preserver', 'basic_processing', 
          `Enhanced metadata extraction failed: ${metaError.message}`,
          true
        );
      }

      if (dryRun) {
        auditLogger.logEvent('dry_run_convert', {
          inputFile,
          outputFile,
          quality,
          resize
        });
        
        auditLogger.endOperation({ dryRun: true });
        return { success: true, outputFile, dryRun: true };
      }

      // Process with enhanced metadata preservation
      let preservationResult = null;
      
      if (originalMetadata) {
        // Use enhanced metadata preservation workflow
        preservationResult = await this.metadataPreserver.processWithPreservation(
          inputFile, 
          outputFile, 
          async () => {
            await this.performSharpConversion(inputFile, outputFile, { quality, resize, auditLogger });
          }
        );
        
        auditLogger.logEvent('enhanced_conversion_complete', {
          inputFile: path.basename(inputFile),
          outputFile: path.basename(outputFile),
          metadataPreserved: preservationResult.success,
          timestampIntegrity: preservationResult.embedResult.timestampVerified,
          preservationDuration: preservationResult.duration
        });
        
      } else {
        // Fallback to standard processing without metadata preservation
        auditLogger.logEvent('fallback_conversion_start', {
          inputFile: path.basename(inputFile),
          reason: 'no_metadata_extracted'
        });
        
        await this.performSharpConversion(inputFile, outputFile, { quality, resize, auditLogger });
      }
      
      // Verify output file
      const stats = await fs.stat(outputFile);
      const inputStats = await fs.stat(inputFile);
      
      auditLogger.logEvent('file_converted', {
        inputFile: path.basename(inputFile),
        outputFile: path.basename(outputFile),
        inputSize: inputStats.size,
        outputSize: stats.size,
        compressionRatio: (inputStats.size / stats.size).toFixed(2),
        metadataPreservationUsed: !!originalMetadata,
        timestampVerified: preservationResult?.embedResult?.timestampVerified || false
      });

      auditLogger.endOperation({ 
        success: true,
        outputSize: stats.size
      });

      return {
        success: true,
        outputFile,
        inputSize: inputStats.size,
        outputSize: stats.size,
        originalMetadata,
        preservationResult,
        timestampVerified: preservationResult?.embedResult?.timestampVerified || false
      };

    } catch (error) {
      auditLogger.logError(error, {
        inputFile,
        operation: 'process_raw_file'
      });
      
      auditLogger.endOperation({ error: error.message });
      
      // Try fallback processing
      try {
        return await this.fallbackConversion(inputFile, outputDir, options);
      } catch (fallbackError) {
        auditLogger.logFallback('conversion_method',
          'sharp_standard', 'fallback_failed',
          fallbackError.message,
          false
        );
        
        return { success: false, error: error.message };
      }
    }
  }

  /**
   * Perform Sharp conversion without metadata handling
   */
  async performSharpConversion(inputFile, outputFile, options) {
    const { quality, resize, auditLogger } = options;
    
    // Build Sharp instance
    let sharpInstance = sharp(inputFile);
    
    // Apply resize if specified
    if (resize) {
      const [width, height] = resize.split('x').map(Number);
      sharpInstance = sharpInstance.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      });
      
      auditLogger?.logDecision('resize_applied',
        { resize, width, height },
        'resized',
        `Image will be resized to fit ${width}x${height}`
      );
    }

    // Apply basic corrections and JPEG settings
    sharpInstance = sharpInstance
      .jpeg({ 
        quality,
        mozjpeg: true,
        progressive: true
      });

    // Write file
    await sharpInstance.toFile(outputFile);
  }

  /**
   * Fallback conversion method
   */
  async fallbackConversion(inputFile, outputDir, options) {
    const { quality, auditLogger } = options;
    
    auditLogger.logFallback('conversion_method',
      'sharp_standard', 'sharp_basic',
      'Standard processing failed, trying basic conversion',
      true
    );

    const inputName = path.parse(inputFile).name;
    const outputFile = path.join(outputDir, `${inputName}.jpg`);

    // Basic conversion without advanced options
    await sharp(inputFile)
      .jpeg({ quality: Math.max(quality - 10, 50) }) // Reduce quality slightly
      .toFile(outputFile);

    const stats = await fs.stat(outputFile);
    
    auditLogger.logEvent('fallback_conversion_success', {
      inputFile,
      outputFile,
      method: 'sharp_basic',
      outputSize: stats.size
    });

    return {
      success: true,
      outputFile,
      fallback: true,
      outputSize: stats.size
    };
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
   * Create conversion report
   */
  async createConversionReport(outputPath, results, originalFiles) {
    const report = {
      stage: 'convert',
      timestamp: new Date().toISOString(),
      summary: {
        totalInputFiles: originalFiles.length,
        filesProcessed: results.filesProcessed,
        filesSkipped: results.filesSkipped,
        errors: results.errors.length,
        duration: results.duration,
        averageTimePerFile: results.filesProcessed > 0 ? results.duration / results.filesProcessed : 0
      },
      fileFormats: this.getFormatStats(originalFiles),
      errors: results.errors,
      outputFiles: results.outputFiles || [],
      metadataPreservation: {
        filesWithMetadata: results.outputFiles ? results.outputFiles.filter(f => f.timestampVerified).length : 0,
        timestampVerificationRate: results.outputFiles && results.outputFiles.length > 0 ? 
          ((results.outputFiles.filter(f => f.timestampVerified).length / results.outputFiles.length) * 100).toFixed(2) + '%' : '0%'
      }
    };

    const reportPath = path.join(outputPath, 'conversion_report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    return report;
  }

  /**
   * Mock conversion process for testing
   */
  async mockConversionProcess(inputPath, outputPath, options, startTime) {
    const { auditLogger, dryRun = false } = options;
    
    auditLogger.logEvent('mock_conversion_start', {
      inputPath,
      outputPath,
      mockMode: true
    });

    // Find all RAW files to simulate processing them
    const rawFiles = await this.findRawFiles(inputPath);
    
    auditLogger.logEvent('mock_raw_files_found', {
      totalFiles: rawFiles.length,
      formats: this.getFormatStats(rawFiles)
    });

    if (rawFiles.length === 0) {
      auditLogger.logDecision('mock_no_raw_files', 
        { inputPath },
        'skip_conversion',
        'No RAW files found for mock conversion'
      );
      
      return {
        success: true,
        filesProcessed: 0,
        filesSkipped: 0,
        duration: Date.now() - startTime,
        mockMode: true
      };
    }

    const results = {
      success: true,
      filesProcessed: 0,
      filesSkipped: 0,
      errors: [],
      duration: 0,
      outputFiles: [],
      mockMode: true
    };

    // Simulate processing each RAW file
    for (const rawFile of rawFiles) {
      try {
        const inputName = path.parse(rawFile).name;
        const outputFile = path.join(outputPath, `${inputName}.jpg`);
        
        auditLogger.logEvent('mock_file_processing', {
          inputFile: path.basename(rawFile),
          outputFile: path.basename(outputFile),
          simulatedConversion: true
        });

        if (!dryRun) {
          // Create a simple mock JPEG file by copying a placeholder or creating a small image
          await this.createMockJpeg(outputFile, auditLogger);
        }

        results.filesProcessed++;
        results.outputFiles.push({
          inputFile: rawFile,
          outputFile: outputFile,
          mockConversion: true,
          timestampVerified: true // Mock successful metadata preservation
        });

        // Add a small delay to simulate processing time
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        auditLogger.logError(error, {
          file: rawFile,
          operation: 'mock_convert_file'
        });
        
        results.errors.push({
          file: rawFile,
          error: error.message
        });
        results.filesSkipped++;
      }
    }

    results.duration = Date.now() - startTime;
    
    auditLogger.logEvent('mock_conversion_complete', {
      totalFiles: rawFiles.length,
      filesProcessed: results.filesProcessed,
      filesSkipped: results.filesSkipped,
      errors: results.errors.length,
      duration: results.duration,
      mockMode: true
    });

    // Create mock conversion report
    await this.createConversionReport(outputPath, results, rawFiles);

    return results;
  }

  /**
   * Create a mock JPEG file for testing
   */
  async createMockJpeg(outputFile, auditLogger) {
    try {
      // Ensure output directory exists
      await fs.ensureDir(path.dirname(outputFile));
      
      // Create a simple 640x480 solid color JPEG as a placeholder
      const mockImageBuffer = await sharp({
        create: {
          width: 640,
          height: 480,
          channels: 3,
          background: { r: 100, g: 100, b: 100 }
        }
      })
      .jpeg({ quality: 80 })
      .toBuffer();
      
      await fs.writeFile(outputFile, mockImageBuffer);
      
      auditLogger.logEvent('mock_jpeg_created', {
        outputFile: path.basename(outputFile),
        size: mockImageBuffer.length,
        dimensions: '640x480'
      });
      
    } catch (error) {
      auditLogger.logError(error, {
        outputFile,
        operation: 'create_mock_jpeg'
      });
      throw error;
    }
  }
}

module.exports = ConvertStage;