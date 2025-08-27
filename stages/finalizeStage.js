/**
 * Finalize Stage - Apply XMP metadata and prepare final export
 * 
 * Applies XMP metadata to enhanced images, organizes final output,
 * and creates delivery-ready photo collections.
 */

const fs = require('fs-extra');
const path = require('path');
const xml2js = require('xml2js');
const exifr = require('exifr');
const sharp = require('sharp');
const { glob } = require('glob');

class FinalizeStage {
  constructor(options = {}) {
    this.auditLogger = options.auditLogger;
    this.supportedFormats = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
  }

  /**
   * Execute the finalization stage
   */
  async execute(options) {
    const startTime = Date.now();
    const { inputPath, outputPath, auditLogger, dryRun = false } = options;
    
    auditLogger.logEvent('finalize_stage_start', {
      inputPath,
      outputPath,
      dryRun
    });

    try {
      // Load download results and enhanced mappings
      const downloadResults = await this.loadDownloadResults(inputPath);
      
      if (!downloadResults) {
        auditLogger.logDecision('no_download_results',
          { inputPath },
          'skip_finalize',
          'No download results found - run imagen-download stage first'
        );
        
        return {
          success: false,
          error: 'No download results found',
          filesProcessed: 0,
          filesFinalized: 0,
          duration: Date.now() - startTime
        };
      }

      const enhancedMappings = await this.loadEnhancedMappings(inputPath);
      
      auditLogger.logEvent('data_loaded', {
        totalCompletedTasks: downloadResults.downloadResults.completedTasks.length,
        enhancedMappings: enhancedMappings ? enhancedMappings.length : 0,
        mockMode: downloadResults.mockMode
      });

      // Find all enhanced images
      const enhancedImages = await this.findEnhancedImages(inputPath);
      
      if (enhancedImages.length === 0) {
        auditLogger.logDecision('no_enhanced_images',
          { inputPath },
          'create_fallback_export',
          'No enhanced images found, creating export from original images'
        );
        
        return await this.createFallbackExport(downloadResults, outputPath, options);
      }

      // Create final output structure
      await this.createOutputStructure(outputPath);
      
      // Process enhanced images
      const results = {
        success: true,
        filesProcessed: 0,
        filesFinalized: 0,
        errors: [],
        finalizedFiles: [],
        duration: 0,
        exportPaths: {
          highRes: path.join(outputPath, 'high-resolution'),
          webOptimized: path.join(outputPath, 'web-optimized'),
          thumbnails: path.join(outputPath, 'thumbnails')
        }
      };

      for (const enhancedImage of enhancedImages) {
        try {
          const result = await this.processEnhancedImage(
            enhancedImage,
            enhancedMappings,
            outputPath,
            { auditLogger, dryRun }
          );
          
          if (result.success) {
            results.filesFinalized++;
            results.finalizedFiles.push(result);
          } else {
            results.errors.push({
              file: enhancedImage,
              error: result.error
            });
          }
          
          results.filesProcessed++;
          
        } catch (error) {
          auditLogger.logError(error, {
            file: enhancedImage,
            operation: 'process_enhanced_image'
          });
          
          results.errors.push({
            file: enhancedImage,
            error: error.message
          });
          results.filesProcessed++;
        }
      }

      results.duration = Date.now() - startTime;
      
      // Create delivery packages
      if (!dryRun && results.filesFinalized > 0) {
        await this.createDeliveryPackages(results, outputPath, auditLogger);
      }
      
      // Log finalization summary
      auditLogger.logEvent('finalize_stage_complete', {
        totalEnhancedImages: enhancedImages.length,
        filesProcessed: results.filesProcessed,
        filesFinalized: results.filesFinalized,
        errors: results.errors.length,
        duration: results.duration,
        successRate: ((results.filesFinalized / results.filesProcessed) * 100).toFixed(2) + '%'
      });

      // Create finalization report
      await this.createFinalizationReport(outputPath, results, downloadResults);

      return results;

    } catch (error) {
      auditLogger.logError(error, {
        operation: 'finalize_stage_execution',
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
   * Load download results
   */
  async loadDownloadResults(inputPath) {
    try {
      const resultsPath = path.join(inputPath, 'download_results.json');
      
      if (!await fs.pathExists(resultsPath)) {
        return null;
      }
      
      return await fs.readJson(resultsPath);
      
    } catch (error) {
      this.auditLogger?.logError(error, {
        operation: 'load_download_results',
        inputPath
      });
      return null;
    }
  }

  /**
   * Load enhanced image mappings
   */
  async loadEnhancedMappings(inputPath) {
    try {
      const mappingsPath = path.join(inputPath, 'enhanced_mappings.json');
      
      if (!await fs.pathExists(mappingsPath)) {
        return null;
      }
      
      return await fs.readJson(mappingsPath);
      
    } catch (error) {
      this.auditLogger?.logError(error, {
        operation: 'load_enhanced_mappings',
        inputPath
      });
      return null;
    }
  }

  /**
   * Find all enhanced images
   */
  async findEnhancedImages(inputPath) {
    try {
      const patterns = this.supportedFormats.map(ext => `enhanced_*${ext}`);
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
        operation: 'find_enhanced_images',
        inputPath
      });
      throw error;
    }
  }

  /**
   * Create output directory structure
   */
  async createOutputStructure(outputPath) {
    const directories = [
      'high-resolution',
      'web-optimized',
      'thumbnails',
      'metadata',
      'delivery-packages'
    ];
    
    for (const dir of directories) {
      await fs.ensureDir(path.join(outputPath, dir));
    }
  }

  /**
   * Process a single enhanced image
   */
  async processEnhancedImage(enhancedImagePath, mappings, outputPath, options) {
    const { auditLogger, dryRun } = options;
    const fileName = path.basename(enhancedImagePath);
    
    auditLogger.startOperation(`finalize_${fileName}`);
    
    try {
      // Find original image mapping
      const mapping = mappings?.find(m => 
        path.basename(m.enhancedFile) === fileName ||
        m.enhancedFile === enhancedImagePath
      );
      
      // Extract original metadata if mapping exists
      let originalMetadata = null;
      if (mapping && mapping.originalFile && await fs.pathExists(mapping.originalFile)) {
        try {
          originalMetadata = await exifr.parse(mapping.originalFile);
        } catch (error) {
          auditLogger.logFallback('metadata_extraction',
            'original_exif', 'enhanced_only',
            `Failed to read original metadata: ${error.message}`,
            true
          );
        }
      }
      
      // Get enhanced image info
      const enhancedStats = await fs.stat(enhancedImagePath);
      const enhancedMeta = await sharp(enhancedImagePath).metadata();
      
      auditLogger.logEvent('image_analysis', {
        fileName,
        enhancedSize: enhancedStats.size,
        dimensions: `${enhancedMeta.width}x${enhancedMeta.height}`,
        hasOriginalMetadata: !!originalMetadata,
        format: enhancedMeta.format
      });

      if (dryRun) {
        auditLogger.logEvent('dry_run_finalize', {
          fileName,
          originalMapping: !!mapping,
          outputFormats: ['high-res', 'web', 'thumbnail']
        });
        
        auditLogger.endOperation({ dryRun: true });
        
        return {
          success: true,
          fileName,
          dryRun: true
        };
      }

      // Create different output versions
      const outputFiles = await this.createOutputVersions(
        enhancedImagePath,
        outputPath,
        originalMetadata,
        auditLogger
      );
      
      // Create XMP sidecar file
      const xmpFile = await this.createXMPSidecar(
        enhancedImagePath,
        outputPath,
        originalMetadata,
        mapping,
        auditLogger
      );

      auditLogger.endOperation({
        success: true,
        outputFiles: outputFiles.length,
        xmpCreated: !!xmpFile
      });

      return {
        success: true,
        fileName,
        originalFile: mapping?.originalFile,
        enhancedFile: enhancedImagePath,
        outputFiles,
        xmpFile,
        fileSize: enhancedStats.size,
        dimensions: `${enhancedMeta.width}x${enhancedMeta.height}`
      };

    } catch (error) {
      auditLogger.endOperation({ error: error.message });
      
      return {
        success: false,
        fileName,
        error: error.message
      };
    }
  }

  /**
   * Create different output versions of the image
   */
  async createOutputVersions(enhancedImagePath, outputPath, originalMetadata, auditLogger) {
    const fileName = path.parse(enhancedImagePath).name;
    const outputFiles = [];
    
    try {
      const sharpImage = sharp(enhancedImagePath);
      
      // High-resolution version (original size)
      const highResPath = path.join(outputPath, 'high-resolution', `${fileName}.jpg`);
      await sharpImage
        .clone()
        .jpeg({ quality: 95, progressive: true })
        .toFile(highResPath);
      
      outputFiles.push({
        type: 'high-resolution',
        path: highResPath,
        quality: 95
      });
      
      // Web-optimized version (max 2048px wide)
      const webPath = path.join(outputPath, 'web-optimized', `${fileName}_web.jpg`);
      await sharpImage
        .clone()
        .resize(2048, 2048, { 
          fit: 'inside', 
          withoutEnlargement: true 
        })
        .jpeg({ quality: 85, progressive: true })
        .toFile(webPath);
      
      outputFiles.push({
        type: 'web-optimized',
        path: webPath,
        quality: 85,
        maxDimension: 2048
      });
      
      // Thumbnail version (300px wide)
      const thumbPath = path.join(outputPath, 'thumbnails', `${fileName}_thumb.jpg`);
      await sharpImage
        .clone()
        .resize(300, 300, { 
          fit: 'inside', 
          withoutEnlargement: true 
        })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);
      
      outputFiles.push({
        type: 'thumbnail',
        path: thumbPath,
        quality: 80,
        maxDimension: 300
      });
      
      auditLogger.logEvent('output_versions_created', {
        fileName,
        versions: outputFiles.length,
        types: outputFiles.map(f => f.type)
      });
      
      return outputFiles;
      
    } catch (error) {
      auditLogger.logError(error, {
        fileName,
        operation: 'create_output_versions'
      });
      throw error;
    }
  }

  /**
   * Create XMP sidecar file with metadata
   */
  async createXMPSidecar(enhancedImagePath, outputPath, originalMetadata, mapping, auditLogger) {
    const fileName = path.parse(enhancedImagePath).name;
    const xmpPath = path.join(outputPath, 'metadata', `${fileName}.xmp`);
    
    try {
      // Build XMP metadata
      const xmpData = this.buildXMPMetadata(enhancedImagePath, originalMetadata, mapping);
      
      // Convert to XML
      const builder = new xml2js.Builder({
        rootName: 'x:xmpmeta',
        xmldec: { version: '1.0', encoding: 'UTF-8' },
        renderOpts: { pretty: true, indent: '  ' }
      });
      
      const xmpXml = builder.buildObject(xmpData);
      
      // Write XMP file
      await fs.writeFile(xmpPath, xmpXml, 'utf8');
      
      auditLogger.logEvent('xmp_sidecar_created', {
        fileName,
        xmpPath,
        hasOriginalMetadata: !!originalMetadata,
        metadataFields: Object.keys(xmpData['rdf:RDF']['rdf:Description']['$'] || {}).length
      });
      
      return xmpPath;
      
    } catch (error) {
      auditLogger.logError(error, {
        fileName,
        operation: 'create_xmp_sidecar'
      });
      return null;
    }
  }

  /**
   * Build XMP metadata structure
   */
  buildXMPMetadata(enhancedImagePath, originalMetadata, mapping) {
    const now = new Date().toISOString();
    const fileName = path.basename(enhancedImagePath);
    
    const xmpData = {
      '$': {
        'xmlns:x': 'adobe:ns:meta/',
        'x:xmptk': 'Photo Workflow CLI v1.0'
      },
      'rdf:RDF': {
        '$': {
          'xmlns:rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
          'xmlns:xmp': 'http://ns.adobe.com/xap/1.0/',
          'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
          'xmlns:photoshop': 'http://ns.adobe.com/photoshop/1.0/',
          'xmlns:xmpMM': 'http://ns.adobe.com/xap/1.0/mm/'
        },
        'rdf:Description': {
          '$': {
            'rdf:about': `file:///${fileName}`,
            'xmp:CreateDate': originalMetadata?.DateTime || now,
            'xmp:ModifyDate': now,
            'xmp:CreatorTool': 'Photo Workflow CLI + Imagen AI',
            'dc:format': 'image/jpeg',
            'photoshop:DateCreated': originalMetadata?.DateTimeOriginal || now,
            'xmpMM:DocumentID': `uuid:${this.generateUUID()}`,
            'xmpMM:InstanceID': `uuid:${this.generateUUID()}`
          }
        }
      }
    };

    // Add original camera info if available
    if (originalMetadata) {
      if (originalMetadata.Make) {
        xmpData['rdf:RDF']['rdf:Description']['$']['tiff:Make'] = originalMetadata.Make;
      }
      if (originalMetadata.Model) {
        xmpData['rdf:RDF']['rdf:Description']['$']['tiff:Model'] = originalMetadata.Model;
      }
      if (originalMetadata.ISO) {
        xmpData['rdf:RDF']['rdf:Description']['$']['exif:ISOSpeedRatings'] = originalMetadata.ISO;
      }
      if (originalMetadata.FNumber) {
        xmpData['rdf:RDF']['rdf:Description']['$']['exif:FNumber'] = originalMetadata.FNumber;
      }
      if (originalMetadata.ExposureTime) {
        xmpData['rdf:RDF']['rdf:Description']['$']['exif:ExposureTime'] = originalMetadata.ExposureTime;
      }
      if (originalMetadata.FocalLength) {
        xmpData['rdf:RDF']['rdf:Description']['$']['exif:FocalLength'] = originalMetadata.FocalLength;
      }
    }

    // Add processing info
    xmpData['rdf:RDF']['rdf:Description']['$']['xmp:Label'] = 'Enhanced with Imagen AI';
    xmpData['rdf:RDF']['rdf:Description']['$']['photoshop:Instructions'] = 
      'AI-enhanced image processed through Photo Workflow CLI';

    // Add original file reference if available
    if (mapping?.originalFile) {
      xmpData['rdf:RDF']['rdf:Description']['$']['photoshop:Source'] = mapping.originalFile;
    }

    return xmpData;
  }

  /**
   * Generate simple UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Create delivery packages
   */
  async createDeliveryPackages(results, outputPath, auditLogger) {
    auditLogger.startOperation('create_delivery_packages');
    
    try {
      const packagesDir = path.join(outputPath, 'delivery-packages');
      
      // Create delivery manifest
      const manifest = {
        created: new Date().toISOString(),
        totalFiles: results.filesFinalized,
        packages: {
          'high-resolution': {
            description: 'Full resolution enhanced images for print',
            path: '../high-resolution',
            fileCount: results.finalizedFiles.length,
            quality: 95
          },
          'web-optimized': {
            description: 'Web-optimized images for online use',
            path: '../web-optimized',
            fileCount: results.finalizedFiles.length,
            quality: 85,
            maxDimension: '2048px'
          },
          'thumbnails': {
            description: 'Thumbnail images for previews',
            path: '../thumbnails',
            fileCount: results.finalizedFiles.length,
            quality: 80,
            maxDimension: '300px'
          }
        },
        metadata: {
          xmpFiles: '../metadata',
          description: 'XMP sidecar files with complete metadata'
        },
        files: results.finalizedFiles.map(f => ({
          fileName: f.fileName,
          originalFile: f.originalFile,
          enhancedFile: f.enhancedFile,
          fileSize: f.fileSize,
          dimensions: f.dimensions,
          outputVersions: f.outputFiles.length
        }))
      };
      
      const manifestPath = path.join(packagesDir, 'delivery-manifest.json');
      await fs.writeJson(manifestPath, manifest, { spaces: 2 });
      
      // Create README for client
      const readme = this.createClientReadme(manifest);
      const readmePath = path.join(packagesDir, 'README.txt');
      await fs.writeFile(readmePath, readme, 'utf8');
      
      auditLogger.logEvent('delivery_packages_created', {
        manifestPath,
        readmePath,
        totalFiles: results.filesFinalized
      });
      
      auditLogger.endOperation({
        packagesCreated: Object.keys(manifest.packages).length,
        manifestCreated: true
      });
      
    } catch (error) {
      auditLogger.endOperation({ error: error.message });
      throw error;
    }
  }

  /**
   * Create client README file
   */
  createClientReadme(manifest) {
    return `PHOTO DELIVERY - ENHANCED COLLECTION
====================================

Delivery Date: ${new Date(manifest.created).toLocaleDateString()}
Total Photos: ${manifest.totalFiles}

PACKAGE CONTENTS:
================

HIGH-RESOLUTION FOLDER:
- ${manifest.packages['high-resolution'].fileCount} full-resolution images
- Quality: 95% JPEG
- Suitable for printing up to large formats
- Use these for professional printing

WEB-OPTIMIZED FOLDER:
- ${manifest.packages['web-optimized'].fileCount} web-ready images
- Quality: 85% JPEG
- Maximum dimension: ${manifest.packages['web-optimized'].maxDimension}
- Perfect for social media, websites, and email sharing

THUMBNAILS FOLDER:
- ${manifest.packages['thumbnails'].fileCount} thumbnail images
- Quality: 80% JPEG
- Maximum dimension: ${manifest.packages['thumbnails'].maxDimension}
- For quick previews and galleries

METADATA FOLDER:
- XMP sidecar files with complete image metadata
- Contains original camera settings and processing information
- For professional archival and organization

ENHANCEMENT NOTES:
==================
All images have been enhanced using advanced AI technology to:
- Improve exposure and color balance
- Enhance details and sharpness
- Optimize overall visual quality
- Preserve natural look and feel

USAGE RECOMMENDATIONS:
=====================
- Use HIGH-RESOLUTION images for printing
- Use WEB-OPTIMIZED images for online sharing
- Keep METADATA files with images for future reference
- Contact us if you need different formats or sizes

Thank you for choosing our photo workflow service!
`;
  }

  /**
   * Create fallback export when no enhanced images available
   */
  async createFallbackExport(downloadResults, outputPath, options) {
    const { auditLogger, dryRun } = options;
    
    auditLogger.logEvent('fallback_export_start', {
      reason: 'no_enhanced_images',
      originalTasks: downloadResults.originalUploadData?.uploadTasks?.length || 0
    });

    // Try to find original images from upload tasks
    const originalFiles = [];
    
    if (downloadResults.originalUploadData?.uploadTasks) {
      for (const task of downloadResults.originalUploadData.uploadTasks) {
        if (task.originalPath && await fs.pathExists(task.originalPath)) {
          originalFiles.push(task.originalPath);
        }
      }
    }

    if (originalFiles.length === 0) {
      return {
        success: false,
        error: 'No enhanced images or original files available for export',
        filesProcessed: 0,
        filesFinalized: 0,
        duration: 0
      };
    }

    auditLogger.logDecision('fallback_to_originals',
      { originalFiles: originalFiles.length },
      'export_originals',
      'Exporting original images as fallback since no enhanced images available'
    );

    if (!dryRun) {
      await this.createOutputStructure(outputPath);
      
      // Copy and process original files
      const results = {
        success: true,
        filesProcessed: originalFiles.length,
        filesFinalized: 0,
        errors: [],
        finalizedFiles: [],
        fallbackMode: true
      };

      for (const originalFile of originalFiles) {
        try {
          const fileName = path.basename(originalFile);
          const highResPath = path.join(outputPath, 'high-resolution', fileName);
          
          await fs.copy(originalFile, highResPath);
          results.filesFinalized++;
          
          auditLogger.logEvent('fallback_file_copied', {
            original: originalFile,
            target: highResPath
          });
          
        } catch (error) {
          results.errors.push({
            file: originalFile,
            error: error.message
          });
        }
      }

      return results;
    }

    return {
      success: true,
      filesProcessed: originalFiles.length,
      filesFinalized: originalFiles.length,
      fallbackMode: true,
      dryRun: true,
      duration: 0
    };
  }

  /**
   * Create finalization report
   */
  async createFinalizationReport(outputPath, results, downloadResults) {
    const report = {
      stage: 'finalize',
      timestamp: new Date().toISOString(),
      summary: {
        filesProcessed: results.filesProcessed,
        filesFinalized: results.filesFinalized,
        errors: results.errors.length,
        duration: results.duration,
        successRate: ((results.filesFinalized / results.filesProcessed) * 100).toFixed(2) + '%',
        fallbackMode: results.fallbackMode || false
      },
      outputStructure: {
        highResolution: path.join(outputPath, 'high-resolution'),
        webOptimized: path.join(outputPath, 'web-optimized'),
        thumbnails: path.join(outputPath, 'thumbnails'),
        metadata: path.join(outputPath, 'metadata'),
        deliveryPackages: path.join(outputPath, 'delivery-packages')
      },
      finalizedFiles: results.finalizedFiles?.map(f => ({
        fileName: f.fileName,
        originalFile: f.originalFile,
        enhancedFile: f.enhancedFile,
        outputVersions: f.outputFiles?.length || 0,
        xmpCreated: !!f.xmpFile,
        fileSize: f.fileSize,
        dimensions: f.dimensions
      })) || [],
      processingChain: {
        originalUpload: downloadResults.originalUploadData?.uploadTimestamp,
        downloadCompleted: downloadResults.downloadTimestamp,
        finalizationCompleted: new Date().toISOString(),
        totalStages: 6,
        enhancementProvider: downloadResults.mockMode ? 'Mock (Testing)' : 'Imagen AI'
      },
      deliveryInfo: {
        manifestFile: path.join(outputPath, 'delivery-packages', 'delivery-manifest.json'),
        readmeFile: path.join(outputPath, 'delivery-packages', 'README.txt'),
        clientDeliveryReady: results.filesFinalized > 0
      },
      errors: results.errors
    };

    const reportPath = path.join(outputPath, 'finalization_report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    return report;
  }
}

module.exports = FinalizeStage;