/**
 * Cull Stage - AI-powered photo culling using Gemini
 * 
 * Analyzes photos for technical quality, composition, and emotional impact
 * to automatically cull the best images from a set.
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { glob } = require('glob');

class CullStage {
  constructor(options = {}) {
    this.auditLogger = options.auditLogger;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
    this.batchSize = 5; // Process images in batches
    this.supportedFormats = ['.jpg', '.jpeg', '.png', '.tiff', '.tif'];
  }

  /**
   * Execute the culling stage
   */
  async execute(options) {
    const startTime = Date.now();
    const { inputPath, outputPath, auditLogger, dryRun = false } = options;
    
    // Configuration
    const threshold = parseFloat(options.threshold) || 0.7; // 0-1 rating threshold
    
    auditLogger.logEvent('cull_stage_start', {
      inputPath,
      outputPath,
      threshold,
      dryRun,
      hasApiKey: !!this.geminiApiKey
    });

    try {
      // Check API key
      if (!this.geminiApiKey) {
        auditLogger.logFallback('ai_culling',
          'gemini_api', 'basic_filtering',
          'Gemini API key not available, using basic file filtering',
          true
        );
        
        return await this.basicFiltering(inputPath, outputPath, options);
      }

      // Find all image files
      const imageFiles = await this.findImageFiles(inputPath);
      
      auditLogger.logEvent('images_found', {
        totalFiles: imageFiles.length,
        formats: this.getFormatStats(imageFiles)
      });

      if (imageFiles.length === 0) {
        auditLogger.logDecision('no_images_found',
          { inputPath },
          'skip_culling',
          'No image files found in input directory'
        );
        
        return {
          success: true,
          filesProcessed: 0,
          filesSelected: 0,
          duration: Date.now() - startTime
        };
      }

      // Process images in batches
      const results = {
        success: true,
        filesProcessed: 0,
        filesSelected: 0,
        errors: [],
        ratings: [],
        selectedFiles: [],
        duration: 0
      };

      const batches = this.createBatches(imageFiles, this.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        auditLogger.logEvent('batch_processing', {
          batch: i + 1,
          totalBatches: batches.length,
          batchSize: batch.length
        });

        try {
          const batchResults = await this.processBatch(batch, threshold, {
            auditLogger,
            dryRun
          });
          
          results.filesProcessed += batchResults.filesProcessed;
          results.filesSelected += batchResults.filesSelected;
          results.ratings.push(...batchResults.ratings);
          results.selectedFiles.push(...batchResults.selectedFiles);
          results.errors.push(...batchResults.errors);
          
        } catch (error) {
          auditLogger.logError(error, {
            batch: i + 1,
            batchFiles: batch,
            operation: 'batch_processing'
          });
          
          results.errors.push({
            batch: i + 1,
            error: error.message,
            files: batch
          });
        }
      }

      // Copy selected files to output directory
      if (!dryRun && results.selectedFiles.length > 0) {
        await this.copySelectedFiles(results.selectedFiles, outputPath, auditLogger);
      }

      results.duration = Date.now() - startTime;
      
      // Log culling summary
      auditLogger.logEvent('cull_stage_complete', {
        totalFiles: imageFiles.length,
        filesProcessed: results.filesProcessed,
        filesSelected: results.filesSelected,
        selectionRate: ((results.filesSelected / results.filesProcessed) * 100).toFixed(2) + '%',
        errors: results.errors.length,
        duration: results.duration,
        threshold
      });

      // Create culling report
      await this.createCullingReport(outputPath, results, imageFiles, threshold);

      return results;

    } catch (error) {
      auditLogger.logError(error, {
        operation: 'cull_stage_execution',
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
   * Create batches for processing
   */
  createBatches(files, batchSize) {
    const batches = [];
    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a batch of images
   */
  async processBatch(batch, threshold, options) {
    const { auditLogger, dryRun } = options;
    
    auditLogger.startOperation(`cull_batch_${batch.length}_images`);
    
    try {
      const results = {
        filesProcessed: 0,
        filesSelected: 0,
        ratings: [],
        selectedFiles: [],
        errors: []
      };

      for (const imageFile of batch) {
        try {
          const rating = await this.rateImage(imageFile, auditLogger);
          
          results.ratings.push({
            file: imageFile,
            rating: rating.score,
            reasoning: rating.reasoning,
            technical: rating.technical,
            composition: rating.composition,
            subject: rating.subject,
            emotional: rating.emotional
          });
          
          results.filesProcessed++;
          
          // Check if image meets threshold
          if (rating.score >= threshold) {
            results.filesSelected++;
            results.selectedFiles.push({
              file: imageFile,
              rating: rating.score,
              reasoning: rating.reasoning
            });
            
            auditLogger.logDecision('image_selected',
              { file: imageFile, rating: rating.score, threshold },
              'selected',
              `Image scored ${rating.score} (>= ${threshold}): ${rating.reasoning}`
            );
          } else {
            auditLogger.logDecision('image_culled',
              { file: imageFile, rating: rating.score, threshold },
              'culled',
              `Image scored ${rating.score} (< ${threshold}): ${rating.reasoning}`
            );
          }
          
        } catch (error) {
          auditLogger.logError(error, {
            file: imageFile,
            operation: 'rate_single_image'
          });
          
          results.errors.push({
            file: imageFile,
            error: error.message
          });
        }
      }

      auditLogger.endOperation({
        filesProcessed: results.filesProcessed,
        filesSelected: results.filesSelected,
        selectionRate: ((results.filesSelected / results.filesProcessed) * 100).toFixed(2) + '%'
      });

      return results;

    } catch (error) {
      auditLogger.endOperation({ error: error.message });
      throw error;
    }
  }

  /**
   * Rate a single image using Gemini AI
   */
  async rateImage(imageFile, auditLogger) {
    try {
      // Convert image to base64
      const imageBuffer = await fs.readFile(imageFile);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = this.getMimeType(path.extname(imageFile));

      // Prepare Gemini API request
      const prompt = await this.createCullingPrompt();
      
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`,
        {
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              }
            ]
          }]
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      // Parse response
      const responseText = response.data.candidates[0].content.parts[0].text;
      const rating = this.parseRatingResponse(responseText);
      
      auditLogger.logEvent('image_rated', {
        file: path.basename(imageFile),
        rating: rating.score,
        technical: rating.technical,
        composition: rating.composition,
        subject: rating.subject,
        emotional: rating.emotional,
        reasoning: rating.reasoning.substring(0, 100) + '...'
      });

      return rating;

    } catch (error) {
      auditLogger.logError(error, {
        file: imageFile,
        operation: 'gemini_rating'
      });

      // Return fallback rating
      auditLogger.logFallback('image_rating',
        'gemini_api', 'basic_score',
        `API rating failed: ${error.message}`,
        true
      );

      return this.getBasicRating(imageFile);
    }
  }

  /**
   * Load and create culling prompt for Gemini
   */
  async createCullingPrompt() {
    try {
      const promptPath = path.join(__dirname, '..', 'prompts', 'gemini-culling.txt');
      
      // Check if custom prompt file exists
      if (await fs.pathExists(promptPath)) {
        const customPrompt = await fs.readFile(promptPath, 'utf8');
        
        this.auditLogger?.logEvent('prompt_loaded', {
          source: 'custom_file',
          promptPath: path.basename(promptPath),
          length: customPrompt.length
        });
        
        return customPrompt.trim();
      }
    } catch (error) {
      this.auditLogger?.logError(error, {
        operation: 'load_custom_prompt',
        promptPath: 'prompts/gemini-culling.txt'
      });
      
      this.auditLogger?.logFallback('prompt_loading',
        'custom_file', 'default_embedded',
        `Failed to load custom prompt: ${error.message}`,
        true
      );
    }

    // Fallback to default embedded prompt
    this.auditLogger?.logEvent('prompt_loaded', {
      source: 'default_embedded'
    });

    return `You are a professional photo editor tasked with rating this photograph for a photo collection. 

Please analyze the image on these criteria:
1. Technical Quality (0-1): Focus sharpness, exposure, color balance, noise levels
2. Composition (0-1): Rule of thirds, leading lines, framing, balance
3. Emotional Impact (0-1): Moment capture, expression, storytelling value

Provide your response in this exact JSON format:
{
  "technical": 0.85,
  "composition": 0.90,
  "emotional": 0.95,
  "overall_score": 0.90,
  "reasoning": "Sharp focus on subjects, excellent composition with natural framing, captures genuine emotion between couple"
}

Be critical but fair. A score of 0.7+ indicates the photo should be kept for the client.`;
  }

  /**
   * Parse Gemini rating response
   */
  parseRatingResponse(responseText) {
    try {
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        score: parsed.overall_score || 0.5,
        technical: parsed.technical || 0.5,
        composition: parsed.composition || 0.5,
        subject: parsed.subject || 0.5,
        emotional: parsed.emotional || 0.5,
        reasoning: parsed.reasoning || 'No reasoning provided'
      };

    } catch (error) {
      // Fallback parsing
      const score = this.extractScoreFromText(responseText);
      return {
        score,
        technical: score,
        composition: score,
        subject: score,
        emotional: score,
        reasoning: 'Parsed from text response'
      };
    }
  }

  /**
   * Extract score from text if JSON parsing fails
   */
  extractScoreFromText(text) {
    // Look for score patterns
    const patterns = [
      /score[:\s]+(\d*\.?\d+)/i,
      /rating[:\s]+(\d*\.?\d+)/i,
      /(\d*\.?\d+)\/1/i,
      /(\d*\.?\d+)\s*out\s*of\s*1/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const score = parseFloat(match[1]);
        if (score >= 0 && score <= 1) {
          return score;
        }
      }
    }

    // Default fallback
    return 0.5;
  }

  /**
   * Get basic rating for fallback
   */
  getBasicRating(imageFile) {
    // Simple heuristic based on file size and name
    const stats = require('fs').statSync(imageFile);
    const size = stats.size;
    const basename = path.basename(imageFile).toLowerCase();
    
    let score = 0.5; // Default middle score
    
    // Larger files often indicate better quality
    if (size > 5 * 1024 * 1024) score += 0.1; // > 5MB
    if (size > 10 * 1024 * 1024) score += 0.1; // > 10MB
    
    // Avoid obvious test or duplicate files
    if (basename.includes('test') || basename.includes('dup')) score -= 0.3;
    
    return {
      score: Math.max(0, Math.min(1, score)),
      technical: score,
      composition: score,
      subject: score,
      emotional: score,
      reasoning: 'Basic heuristic rating (AI unavailable)'
    };
  }

  /**
   * Copy selected files to output directory
   */
  async copySelectedFiles(selectedFiles, outputPath, auditLogger) {
    auditLogger.startOperation('copy_selected_files');
    
    try {
      for (const selected of selectedFiles) {
        const sourcePath = selected.file;
        const fileName = path.basename(sourcePath);
        const targetPath = path.join(outputPath, fileName);
        
        await fs.copy(sourcePath, targetPath);
        
        auditLogger.logEvent('file_copied', {
          source: sourcePath,
          target: targetPath,
          rating: selected.rating
        });
      }
      
      auditLogger.endOperation({
        filesCopied: selectedFiles.length
      });

    } catch (error) {
      auditLogger.endOperation({ error: error.message });
      throw error;
    }
  }

  /**
   * Basic filtering fallback
   */
  async basicFiltering(inputPath, outputPath, options) {
    const { auditLogger, dryRun } = options;
    
    auditLogger.logEvent('basic_filtering_start', {
      method: 'file_size_heuristic'
    });

    const imageFiles = await this.findImageFiles(inputPath);
    const selectedFiles = [];

    // Simple heuristic: keep files > 2MB and with good names
    for (const file of imageFiles) {
      const stats = await fs.stat(file);
      const basename = path.basename(file).toLowerCase();
      
      let keep = false;
      
      if (stats.size > 2 * 1024 * 1024 && // > 2MB
          !basename.includes('test') && 
          !basename.includes('dup')) {
        keep = true;
      }
      
      if (keep) {
        selectedFiles.push({
          file,
          rating: 0.7, // Default "good" rating
          reasoning: 'Basic size/name filtering'
        });
      }
    }

    if (!dryRun) {
      await this.copySelectedFiles(selectedFiles, outputPath, auditLogger);
    }

    return {
      success: true,
      filesProcessed: imageFiles.length,
      filesSelected: selectedFiles.length,
      selectedFiles,
      method: 'basic_filtering',
      duration: 0 // Quick operation
    };
  }

  /**
   * Get MIME type from file extension
   */
  getMimeType(ext) {
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff'
    };
    return mimeTypes[ext.toLowerCase()] || 'image/jpeg';
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
   * Create culling report
   */
  async createCullingReport(outputPath, results, originalFiles, threshold) {
    const report = {
      stage: 'cull',
      timestamp: new Date().toISOString(),
      summary: {
        totalInputFiles: originalFiles.length,
        filesProcessed: results.filesProcessed,
        filesSelected: results.filesSelected,
        selectionRate: ((results.filesSelected / results.filesProcessed) * 100).toFixed(2) + '%',
        threshold,
        errors: results.errors.length,
        duration: results.duration,
        method: results.method || 'gemini_ai'
      },
      ratingDistribution: this.calculateRatingDistribution(results.ratings),
      selectedFiles: results.selectedFiles?.map(f => ({
        file: path.basename(f.file),
        rating: f.rating,
        reasoning: f.reasoning
      })) || [],
      errors: results.errors
    };

    const reportPath = path.join(outputPath, 'culling_report.json');
    await fs.writeJson(reportPath, report, { spaces: 2 });

    return report;
  }

  /**
   * Calculate rating distribution for analysis
   */
  calculateRatingDistribution(ratings) {
    if (!ratings || ratings.length === 0) return {};
    
    const distribution = {
      '0.0-0.2': 0,
      '0.2-0.4': 0,
      '0.4-0.6': 0,
      '0.6-0.8': 0,
      '0.8-1.0': 0
    };

    ratings.forEach(r => {
      const score = r.rating || 0;
      if (score < 0.2) distribution['0.0-0.2']++;
      else if (score < 0.4) distribution['0.2-0.4']++;
      else if (score < 0.6) distribution['0.4-0.6']++;
      else if (score < 0.8) distribution['0.6-0.8']++;
      else distribution['0.8-1.0']++;
    });

    return distribution;
  }
}

module.exports = CullStage;