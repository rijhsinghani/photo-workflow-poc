/**
 * dcraw Converter - Simplified RAW to JPEG converter using only dcraw
 * Removes Sharp dependency since it doesn't support Sony ARW files
 * 
 * Conversion methods:
 * 1. Extract embedded JPEG (fastest, preserves all metadata)
 * 2. Full RAW conversion via dcraw -> Python PIL (highest quality)
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs-extra');
const path = require('path');
const exifr = require('exifr');

const execAsync = promisify(exec);

class DcrawConverter {
  constructor(auditLogger = null) {
    this.auditLogger = auditLogger;
    this.dcrawPath = null;
    this.isAvailable = false;
    this.pythonAvailable = false;
  }

  /**
   * Initialize and check dcraw availability
   */
  async initialize() {
    try {
      // Check for dcraw
      const { stdout } = await execAsync('which dcraw');
      this.dcrawPath = stdout.trim();
      this.isAvailable = true;
      
      this.auditLogger?.logEvent('dcraw_found', {
        path: this.dcrawPath,
        version: await this.getDcrawVersion()
      });

      // Check for Python (for PPM to JPEG conversion)
      try {
        await execAsync('python3 -c "from PIL import Image; print(\'PIL available\')"');
        this.pythonAvailable = true;
        this.auditLogger?.logEvent('python_pil_available', { available: true });
      } catch {
        this.pythonAvailable = false;
        this.auditLogger?.logEvent('python_pil_unavailable', { 
          available: false,
          fallback: 'embedded_jpeg_only' 
        });
      }

      return true;
    } catch (error) {
      this.auditLogger?.logError(error, 'dcraw not found - RAW conversion unavailable');
      return false;
    }
  }

  /**
   * Get dcraw version
   */
  async getDcrawVersion() {
    try {
      const { stdout } = await execAsync('dcraw 2>&1 | head -1');
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Convert RAW file to JPEG
   * @param {string} inputPath - Path to RAW file
   * @param {string} outputPath - Path for output JPEG
   * @param {Object} options - Conversion options
   */
  async convert(inputPath, outputPath, options = {}) {
    if (!this.isAvailable) {
      throw new Error('dcraw is not available. Install with: brew install dcraw');
    }

    const quality = options.quality || 90;
    const resize = options.resize || null;
    const method = options.method || 'auto';

    this.auditLogger?.logEvent('conversion_start', {
      input: path.basename(inputPath),
      output: path.basename(outputPath),
      method,
      quality,
      resize
    });

    try {
      // Method 1: Try embedded JPEG first (fastest, preserves metadata)
      if (method === 'auto' || method === 'embedded') {
        const embeddedResult = await this.extractEmbeddedJpeg(inputPath, outputPath);
        if (embeddedResult.success) {
          this.auditLogger?.logEvent('conversion_success', {
            method: 'embedded_jpeg',
            duration: embeddedResult.duration,
            size: embeddedResult.size
          });
          return embeddedResult;
        }
      }

      // Method 2: Full RAW conversion
      if (this.pythonAvailable) {
        const fullResult = await this.fullConversion(inputPath, outputPath, quality, resize);
        this.auditLogger?.logEvent('conversion_success', {
          method: 'full_conversion',
          duration: fullResult.duration,
          size: fullResult.size
        });
        return fullResult;
      }

      throw new Error('No conversion method available');

    } catch (error) {
      this.auditLogger?.logError(error, `Failed to convert ${path.basename(inputPath)}`);
      throw error;
    }
  }

  /**
   * Extract embedded JPEG from RAW file
   */
  async extractEmbeddedJpeg(inputPath, outputPath) {
    const startTime = Date.now();
    
    try {
      // dcraw -e extracts embedded JPEG as filename.thumb.jpg
      await execAsync(`dcraw -e "${inputPath}"`);
      
      // Find the extracted thumbnail
      const dir = path.dirname(inputPath);
      const base = path.basename(inputPath, path.extname(inputPath));
      const thumbPath = path.join(dir, `${base}.thumb.jpg`);
      
      if (await fs.pathExists(thumbPath)) {
        // Move to final destination
        await fs.move(thumbPath, outputPath, { overwrite: true });
        
        const stats = await fs.stat(outputPath);
        
        return {
          success: true,
          method: 'embedded_jpeg',
          duration: Date.now() - startTime,
          size: stats.size,
          path: outputPath
        };
      }
      
      return { success: false, reason: 'No embedded JPEG found' };
      
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * Full RAW conversion using dcraw + Python PIL
   */
  async fullConversion(inputPath, outputPath, quality = 90, resize = null) {
    const startTime = Date.now();
    const tempPpm = outputPath.replace(/\.[^.]+$/, '.ppm');
    
    try {
      // Extract metadata first for re-embedding
      const metadata = await exifr.parse(inputPath, {
        tiff: true,
        xmp: true,
        icc: true
      });

      // Step 1: Convert RAW to PPM using dcraw
      // -c: output to stdout
      // -q 3: highest quality interpolation
      // -w: use camera white balance
      // -H 0: clip highlights
      const dcrawCmd = `dcraw -c -q 3 -w -H 0 "${inputPath}" > "${tempPpm}"`;
      await execAsync(dcrawCmd);

      // Step 2: Convert PPM to JPEG using Python PIL
      const pythonScript = `
from PIL import Image
import json

img = Image.open('${tempPpm}')

# Resize if requested
${resize ? `
max_dim = ${resize}
if img.width > max_dim or img.height > max_dim:
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
` : ''}

# Save as JPEG
img.save('${outputPath}', 'JPEG', quality=${quality}, optimize=True)

# Output dimensions
print(json.dumps({
  'width': img.width,
  'height': img.height
}))
`;

      const { stdout } = await execAsync(`python3 -c "${pythonScript}"`);
      const dimensions = JSON.parse(stdout);

      // Clean up temp file
      await fs.remove(tempPpm);

      // Get final file stats
      const stats = await fs.stat(outputPath);

      // Re-embed critical metadata using exiftool if available
      try {
        if (metadata.DateTimeOriginal) {
          const exifDate = metadata.DateTimeOriginal.toISOString().replace('T', ' ').replace(/\..+/, '');
          await execAsync(`exiftool -overwrite_original -DateTimeOriginal="${exifDate}" "${outputPath}" 2>/dev/null`);
        }
      } catch {
        // exiftool not available, metadata may be lost
        this.auditLogger?.logEvent('metadata_reembed_skipped', { 
          reason: 'exiftool not available' 
        });
      }

      return {
        success: true,
        method: 'full_conversion',
        duration: Date.now() - startTime,
        size: stats.size,
        dimensions,
        path: outputPath
      };

    } catch (error) {
      // Clean up on error
      await fs.remove(tempPpm).catch(() => {});
      throw error;
    }
  }

  /**
   * Batch convert multiple files
   */
  async batchConvert(inputFiles, outputDir, options = {}) {
    const results = [];
    
    for (const inputFile of inputFiles) {
      const outputFile = path.join(
        outputDir, 
        path.basename(inputFile, path.extname(inputFile)) + '.jpg'
      );
      
      try {
        const result = await this.convert(inputFile, outputFile, options);
        results.push({ ...result, input: inputFile, output: outputFile });
      } catch (error) {
        results.push({ 
          success: false, 
          input: inputFile, 
          error: error.message 
        });
      }
    }
    
    return results;
  }
}

module.exports = DcrawConverter;