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
    this.supportedFormats = ['.jpg', '.jpeg']; // Only JPEG from Stage 1
    this.enableQACheck = options.enableQACheck !== false; // Default true
    this.targetKeeperRate = options.targetKeeperRate || 0.4; // 40% default
  }

  /**
   * Execute the culling stage
   */
  async execute(options) {
    const startTime = Date.now();
    const { inputPath, outputPath, auditLogger, dryRun = false } = options;
    
    // Configuration
    const threshold = parseFloat(options.threshold) || 0.7; // 0-1 rating threshold
    
    // Validate threshold
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new Error(`Invalid threshold value: ${options.threshold}. Threshold must be between 0 and 1.`);
    }
    
    auditLogger.logEvent('cull_stage_start', {
      inputPath,
      outputPath,
      threshold,
      dryRun,
      hasApiKey: !!this.geminiApiKey
    });

    try {
      // Check API key - required for operation
      if (!this.geminiApiKey) {
        const error = new Error('Gemini API key is required. Set GEMINI_API_KEY environment variable.');
        auditLogger.logError(error, {
          operation: 'api_key_check',
          suggestion: 'Set GEMINI_API_KEY in .env file'
        }, 'critical');
        throw error;
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

      // PASS 1: Contextual Gallery Curation
      auditLogger.logEvent('contextual_culling_start', {
        totalImages: imageFiles.length,
        targetKeeperRate: this.targetKeeperRate
      });

      const curationResults = await this.performContextualCulling(imageFiles, {
        auditLogger,
        threshold,
        dryRun
      });

      // PASS 2: Quality Assurance Check (if enabled)
      let finalResults = curationResults;
      if (this.enableQACheck && curationResults.selectedImages?.length > 0) {
        auditLogger.logEvent('qa_check_start', {
          imagesToCheck: curationResults.selectedImages.length
        });

        const qaResults = await this.performQACheck(curationResults.selectedImages, {
          auditLogger,
          dryRun
        });

        // Merge QA results with curation results
        finalResults = this.mergeQAResults(curationResults, qaResults, auditLogger);
      }

      // Prepare final results structure
      // Map selectedImages to the format expected by copySelectedFiles
      const selectedFiles = (finalResults.selectedImages || []).map(img => ({
        file: img.path || path.join(inputPath, img.filename),
        filename: img.filename,
        rating: img.technical_score || img.score || 0.8,
        reasoning: img.reason
      }));
      
      const results = {
        success: true,
        filesProcessed: imageFiles.length,
        filesSelected: finalResults.selectedImages?.length || 0,
        duplicateGroups: finalResults.duplicateGroups || [],
        qualityIssues: finalResults.qualityIssues || [],
        selectedFiles: selectedFiles,
        culledFiles: finalResults.culledImages || [],
        suggestedGroupings: finalResults.suggestedGroupings || [],
        groupingWarnings: finalResults.groupingWarnings || [],
        ratings: selectedFiles,  // For compatibility with report generation
        errors: [],
        duration: 0
      };

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
        duplicateGroups: results.duplicateGroups?.length || 0,
        qualityIssues: results.qualityIssues?.length || 0,
        suggestedGroupings: results.suggestedGroupings?.length || 0,
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
   * Perform contextual culling on all images together
   */
  async performContextualCulling(imageFiles, options) {
    const { auditLogger, threshold, dryRun } = options;
    
    try {
      auditLogger.startOperation('contextual_culling');
      
      // For large sets, process in batches to avoid timeouts
      const MAX_BATCH_SIZE = 50;
      let allImages = imageFiles;
      
      if (imageFiles.length > MAX_BATCH_SIZE) {
        auditLogger.logEvent('large_batch_detected', {
          totalImages: imageFiles.length,
          processing: 'sampling',
          sampleSize: MAX_BATCH_SIZE
        });
        
        // Take a representative sample for very large sets
        // Include first, last, and evenly distributed samples
        const sampleIndices = new Set();
        sampleIndices.add(0); // First
        sampleIndices.add(imageFiles.length - 1); // Last
        
        // Add evenly distributed samples
        const step = Math.floor(imageFiles.length / (MAX_BATCH_SIZE - 2));
        for (let i = step; i < imageFiles.length - 1; i += step) {
          if (sampleIndices.size >= MAX_BATCH_SIZE) break;
          sampleIndices.add(i);
        }
        
        allImages = Array.from(sampleIndices).sort((a, b) => a - b).map(i => imageFiles[i]);
        
        auditLogger.logEvent('batch_sampled', {
          originalCount: imageFiles.length,
          sampleCount: allImages.length
        });
      }
      
      // Prepare images for Gemini
      const imagesData = [];
      for (const imagePath of allImages) {
        const imageBase64 = await fs.readFile(imagePath, 'base64');
        imagesData.push({
          path: imagePath,
          filename: path.basename(imagePath),
          base64: imageBase64,
          mimeType: 'image/jpeg'
        });
      }
      
      // Load contextual culling prompt
      const prompt = await this.loadContextualPrompt();
      
      // Call Gemini with all images for comparative analysis
      const response = await this.callGeminiContextual(imagesData, prompt, auditLogger);
      
      // Process the contextual response
      // Note: If we sampled, we need to pass the sampled images for processing
      const results = this.processContextualResponse(response, allImages, threshold, auditLogger);
      
      auditLogger.endOperation({
        selected: results.selectedImages?.length || 0,
        culled: results.culledImages?.length || 0,
        duplicateGroups: results.duplicateGroups?.length || 0
      });
      
      return results;
    } catch (error) {
      auditLogger.logError(error, { operation: 'contextual_culling' });
      throw error;
    }
  }

  /**
   * Perform QA check on selected images
   */
  async performQACheck(selectedImages, options) {
    const { auditLogger, dryRun } = options;
    
    try {
      if (!selectedImages || selectedImages.length === 0) {
        return { passed: [], failed: [], issues: [] };
      }
      
      auditLogger.startOperation('qa_check');
      
      // Prepare selected images for QA
      const imagesData = [];
      for (const image of selectedImages) {
        const imagePath = image.path || image.filename;
        const imageBase64 = await fs.readFile(imagePath, 'base64');
        imagesData.push({
          path: imagePath,
          filename: path.basename(imagePath),
          base64: imageBase64,
          mimeType: 'image/jpeg'
        });
      }
      
      // Load QA prompt
      const qaPrompt = await this.loadQAPrompt();
      
      // Call Gemini for QA check
      const response = await this.callGeminiQA(imagesData, qaPrompt, auditLogger);
      
      // Process QA results
      const qaResults = this.processQAResponse(response, selectedImages, auditLogger);
      
      auditLogger.endOperation({
        passed: qaResults.passed?.length || 0,
        failed: qaResults.failed?.length || 0,
        issues: qaResults.issues?.length || 0
      });
      
      return qaResults;
    } catch (error) {
      auditLogger.logError(error, { operation: 'qa_check' });
      // QA failure shouldn't block process
      return { passed: selectedImages, failed: [], issues: [] };
    }
  }

  /**
   * Merge QA results with curation results
   */
  mergeQAResults(curationResults, qaResults, auditLogger) {
    const finalResults = { ...curationResults };
    
    // Remove images that failed QA
    if (qaResults.failed && qaResults.failed.length > 0) {
      const failedPaths = qaResults.failed.map(f => f.path || f.filename);
      finalResults.selectedImages = curationResults.selectedImages.filter(
        img => !failedPaths.includes(img.path || img.filename)
      );
      
      // Move failed images to culled with QA reason
      qaResults.failed.forEach(failedImage => {
        finalResults.culledImages.push({
          ...failedImage,
          reason: `QA Failed: ${failedImage.reason || 'Technical issues detected'}`
        });
      });
      
      auditLogger.logEvent('qa_results_merged', {
        originalSelected: curationResults.selectedImages.length,
        afterQA: finalResults.selectedImages.length,
        removedByQA: qaResults.failed.length
      });
    }
    
    // Add quality issues to results
    finalResults.qualityIssues = qaResults.issues || [];
    
    // Add grouping warnings to results
    finalResults.groupingWarnings = qaResults.groupingWarnings || [];
    
    return finalResults;
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
      '.jpeg': 'image/jpeg'
    };
    const mimeType = mimeTypes[ext.toLowerCase()];
    if (!mimeType) {
      throw new Error(`Unsupported file extension: ${ext}. Only JPEG files are supported.`);
    }
    return mimeType;
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
   * Load contextual culling prompt
   */
  async loadContextualPrompt() {
    try {
      const promptPath = path.join(__dirname, '..', 'prompts', 'gemini-contextual-culling.txt');
      const prompt = await fs.readFile(promptPath, 'utf-8');
      this.auditLogger?.logEvent('prompt_loaded', {
        source: 'contextual_culling',
        promptPath: 'gemini-contextual-culling.txt'
      });
      return prompt;
    } catch (error) {
      return this.getDefaultContextualPrompt();
    }
  }

  /**
   * Load QA check prompt
   */
  async loadQAPrompt() {
    try {
      const promptPath = path.join(__dirname, '..', 'prompts', 'gemini-qa-check.txt');
      const prompt = await fs.readFile(promptPath, 'utf-8');
      return prompt;
    } catch (error) {
      return this.getDefaultQAPrompt();
    }
  }

  /**
   * Call Gemini for contextual analysis
   */
  async callGeminiContextual(imagesData, prompt, auditLogger) {
    try {
      const parts = [{ text: prompt }];
      
      imagesData.forEach((img, index) => {
        parts.push({
          text: `\nImage ${index + 1}: ${img.filename}`
        });
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.base64
          }
        });
      });

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`,
        {
          contents: [{
            parts
          }]
        },
        { timeout: 120000 }
      );

      return response.data;
    } catch (error) {
      auditLogger.logError(error, {
        operation: 'gemini_contextual_call'
      });
      throw error;
    }
  }

  /**
   * Call Gemini for QA check
   */
  async callGeminiQA(imagesData, prompt, auditLogger) {
    try {
      const parts = [{ text: prompt }];
      
      imagesData.forEach((img, index) => {
        parts.push({
          text: `\nImage ${index + 1}: ${img.filename}`
        });
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.base64
          }
        });
      });

      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`,
        {
          contents: [{
            parts
          }]
        },
        { timeout: 30000 }
      );

      return response.data;
    } catch (error) {
      auditLogger.logError(error, {
        operation: 'gemini_qa_call'
      });
      throw error;
    }
  }

  /**
   * Process contextual culling response
   */
  processContextualResponse(response, imageFiles, threshold, auditLogger) {
    try {
      const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      const results = {
        selectedImages: [],
        culledImages: [],
        duplicateGroups: parsed.duplicate_groups || [],
        suggestedGroupings: parsed.suggested_groupings || [],
        qualityIssues: parsed.quality_issues || []
      };

      // Process selected images
      if (parsed.selected_images) {
        parsed.selected_images.forEach(img => {
          const fullPath = imageFiles.find(f => path.basename(f) === img.filename);
          if (fullPath) {
            results.selectedImages.push({
              path: fullPath,
              filename: img.filename,
              reason: img.reason,
              score: img.technical_score || 0.8,
              isHeroShot: img.is_hero_shot || false,
              groupId: img.group_id
            });
          } else {
            auditLogger.logError(
              new Error(`Could not find file path for ${img.filename}`),
              { operation: 'process_contextual_response', filename: img.filename }
            );
          }
        });
      }

      // Process culled images
      if (parsed.culled_images) {
        parsed.culled_images.forEach(img => {
          const fullPath = imageFiles.find(f => path.basename(f) === img.filename);
          if (fullPath) {
            results.culledImages.push({
              path: fullPath,
              filename: img.filename,
              reason: img.reason,
              groupId: img.group_id
            });
          } else {
            auditLogger.logError(
              new Error(`Could not find file path for culled image ${img.filename}`),
              { operation: 'process_contextual_response', filename: img.filename }
            );
          }
        });
      }

      return results;
    } catch (error) {
      auditLogger.logError(error, {
        operation: 'process_contextual_response'
      });
      throw error;
    }
  }

  /**
   * Process QA response
   */
  processQAResponse(response, selectedImages, auditLogger) {
    try {
      const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in QA response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const results = { 
        passed: [], 
        failed: [], 
        issues: [],
        groupingWarnings: parsed.grouping_warnings || []
      };

      if (parsed.qa_results) {
        parsed.qa_results.forEach(qaResult => {
          const image = selectedImages.find(img => 
            path.basename(img.path || img.filename) === qaResult.filename
          );
          
          if (image) {
            if (qaResult.passed_qa) {
              results.passed.push(image);
            } else {
              results.failed.push({
                ...image,
                reason: qaResult.notes || 'Failed QA check',
                issues: qaResult.issues
              });
            }
            
            if (qaResult.issues && qaResult.issues.length > 0) {
              results.issues.push({
                filename: qaResult.filename,
                issues: qaResult.issues
              });
            }
          }
        });
      }

      // Log grouping warnings if present
      if (results.groupingWarnings.length > 0) {
        auditLogger.logEvent('grouping_warnings_detected', {
          count: results.groupingWarnings.length,
          warnings: results.groupingWarnings
        });
      }

      return results;
    } catch (error) {
      auditLogger.logError(error, {
        operation: 'process_qa_response'
      });
      return { passed: selectedImages, failed: [], issues: [], groupingWarnings: [] };
    }
  }

  /**
   * Get default contextual prompt
   */
  getDefaultContextualPrompt() {
    return `Review all images together and select the best, avoiding duplicates.`;
  }

  /**
   * Get default QA prompt
   */
  getDefaultQAPrompt() {
    return `Check images for technical quality issues.`;
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
        duplicateGroups: results.duplicateGroups?.length || 0,
        qualityIssues: results.qualityIssues?.length || 0,
        suggestedGroupings: results.suggestedGroupings?.length || 0,
        groupingWarnings: results.groupingWarnings?.length || 0,
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
      duplicateGroups: results.duplicateGroups || [],
      qualityIssues: results.qualityIssues || [],
      suggestedGroupings: results.suggestedGroupings || [],
      groupingWarnings: results.groupingWarnings || [],
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