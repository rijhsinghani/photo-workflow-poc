/**
 * Stage Orchestrator - Manages workflow stages and coordination
 * 
 * Handles stage execution, dependency checking, data flow between stages,
 * and provides unified error handling and logging.
 */

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const { v4: uuidv4 } = require('uuid');

class StageOrchestrator {
  constructor(options = {}) {
    this.inputDir = options.inputDir;
    this.outputDir = options.outputDir;
    this.auditLogger = options.auditLogger;
    this.dryRun = options.dryRun || false;
    this.force = options.force || false;
    
    // Stage processors (loaded lazily)
    this.stageProcessors = {};
    this.stageResults = {};
    this.workflowId = uuidv4();
  }

  /**
   * Initialize orchestrator and validate environment
   */
  async initialize() {
    this.auditLogger.logEvent('orchestrator_init', {
      workflowId: this.workflowId,
      inputDir: this.inputDir,
      outputDir: this.outputDir,
      dryRun: this.dryRun,
      force: this.force
    });

    // Validate input directory
    if (!await fs.pathExists(this.inputDir)) {
      throw new Error(`Input directory does not exist: ${this.inputDir}`);
    }

    // Ensure output directory exists
    await fs.ensureDir(this.outputDir);
    
    // Create stage directories
    const stages = ['convert', 'cull', 'group', 'imagen-upload', 'imagen-download', 'finalize'];
    for (const stage of stages) {
      await fs.ensureDir(path.join(this.outputDir, stage));
    }

    this.auditLogger.logEvent('orchestrator_initialized', {
      stagesCreated: stages
    });
  }

  /**
   * Run a specific stage
   */
  async runStage(stageName, options = {}) {
    await this.initialize();
    
    this.auditLogger.startStage();
    this.auditLogger.logEvent('stage_execution_start', {
      stage: stageName,
      options,
      workflowId: this.workflowId
    });

    try {
      // Check if stage already completed (unless force flag is set)
      if (!this.force && await this.isStageCompleted(stageName)) {
        this.auditLogger.logDecision('stage_skip', 
          { stage: stageName, reason: 'already_completed' },
          'skipped',
          `Stage ${stageName} already completed and --force not specified`
        );
        return this.getStageResult(stageName);
      }

      // Load stage processor
      const processor = await this.loadStageProcessor(stageName);
      
      // Prepare stage input/output paths
      const stageInput = await this.getStageInputPath(stageName);
      const stageOutput = path.join(this.outputDir, stageName);
      
      this.auditLogger.logEvent('stage_paths', {
        stage: stageName,
        input: stageInput,
        output: stageOutput
      });

      // Execute stage
      this.auditLogger.startOperation(`${stageName}_execution`);
      
      const result = await processor.execute({
        inputPath: stageInput,
        outputPath: stageOutput,
        auditLogger: this.auditLogger,
        dryRun: this.dryRun,
        ...options
      });

      this.auditLogger.endOperation({
        filesProcessed: result.filesProcessed || 0,
        errors: result.errors || 0
      });

      // Store result
      this.stageResults[stageName] = result;
      await this.saveStageResult(stageName, result);
      
      // Mark stage as completed
      await this.markStageCompleted(stageName, result);

      this.auditLogger.logEvent('stage_execution_success', {
        stage: stageName,
        result: {
          filesProcessed: result.filesProcessed,
          success: result.success,
          duration: result.duration
        }
      });

      await this.auditLogger.endStage({
        stage: stageName,
        success: true,
        filesProcessed: result.filesProcessed || 0,
        outputPath: stageOutput
      });

      return result;

    } catch (error) {
      this.auditLogger.logError(error, {
        stage: stageName,
        operation: 'stage_execution',
        workflowId: this.workflowId
      }, 'critical');

      await this.auditLogger.endStage({
        stage: stageName,
        success: false,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Run all stages in sequence
   */
  async runAllStages(stages) {
    await this.initialize();
    
    this.auditLogger.logEvent('full_workflow_start', {
      workflowId: this.workflowId,
      stages: stages.map(s => s.name)
    });

    const results = {};
    let currentInput = this.inputDir;

    try {
      for (const stage of stages) {
        console.log(chalk.blue(`\n🔄 Running stage: ${stage.name}`));
        
        const stageOptions = {
          ...stage.options,
          input: currentInput
        };

        const result = await this.runStage(stage.name, stageOptions);
        results[stage.name] = result;
        
        // Set next stage input to current stage output
        currentInput = path.join(this.outputDir, stage.name);
        
        console.log(chalk.green(`✓ Stage ${stage.name} completed`));
        
        // Log progress
        this.auditLogger.logEvent('workflow_progress', {
          completedStage: stage.name,
          remainingStages: stages.slice(stages.indexOf(stage) + 1).map(s => s.name),
          filesProcessed: result.filesProcessed || 0
        });
      }

      this.auditLogger.logEvent('full_workflow_success', {
        workflowId: this.workflowId,
        totalStages: stages.length,
        results: Object.keys(results).reduce((acc, stage) => {
          acc[stage] = {
            success: results[stage].success,
            filesProcessed: results[stage].filesProcessed || 0
          };
          return acc;
        }, {})
      });

      return results;

    } catch (error) {
      this.auditLogger.logError(error, {
        operation: 'full_workflow',
        workflowId: this.workflowId,
        completedStages: Object.keys(results)
      }, 'critical');

      throw error;
    }
  }

  /**
   * Load stage processor dynamically
   */
  async loadStageProcessor(stageName) {
    if (this.stageProcessors[stageName]) {
      return this.stageProcessors[stageName];
    }

    try {
      // Map stage names to their actual file names
      const stageFileMap = {
        'convert': 'convertStage',
        'cull': 'cullStage',
        'group': 'groupStage',
        'imagen-upload': 'imagenUploadStage',
        'imagen-download': 'imagenDownloadStage',
        'finalize': 'finalizeStage'
      };
      
      const stageFileName = stageFileMap[stageName] || `${stageName}Stage`;
      const stageModulePath = path.join(__dirname, '..', 'stages', stageFileName);
      const StageProcessor = require(stageModulePath);
      
      this.stageProcessors[stageName] = new StageProcessor({
        auditLogger: this.auditLogger
      });
      
      this.auditLogger.logEvent('stage_processor_loaded', {
        stage: stageName,
        modulePath: stageModulePath
      });
      
      return this.stageProcessors[stageName];
      
    } catch (error) {
      this.auditLogger.logError(error, {
        stage: stageName,
        operation: 'load_processor'
      });
      
      throw new Error(`Failed to load stage processor for ${stageName}: ${error.message}`);
    }
  }

  /**
   * Get input path for a specific stage
   */
  async getStageInputPath(stageName) {
    const stageDependencies = {
      'convert': this.inputDir,
      'cull': path.join(this.outputDir, 'convert'),
      'group': path.join(this.outputDir, 'cull'),
      'imagen-upload': path.join(this.outputDir, 'group'),
      'imagen-download': path.join(this.outputDir, 'imagen-upload'),
      'finalize': path.join(this.outputDir, 'imagen-download')
    };

    const inputPath = stageDependencies[stageName];
    
    if (!inputPath) {
      throw new Error(`Unknown stage: ${stageName}`);
    }

    // Validate that input path exists (except for first stage)
    if (stageName !== 'convert' && !await fs.pathExists(inputPath)) {
      this.auditLogger.logError(new Error(`Stage input path does not exist: ${inputPath}`), {
        stage: stageName,
        expectedPath: inputPath,
        operation: 'validate_input'
      });
      
      throw new Error(`Stage ${stageName} depends on output from previous stage, but ${inputPath} does not exist`);
    }

    return inputPath;
  }

  /**
   * Check if stage is already completed
   */
  async isStageCompleted(stageName) {
    const completionMarker = path.join(this.outputDir, stageName, '.stage_completed');
    return await fs.pathExists(completionMarker);
  }

  /**
   * Mark stage as completed
   */
  async markStageCompleted(stageName, result) {
    const completionMarker = path.join(this.outputDir, stageName, '.stage_completed');
    const completionData = {
      stage: stageName,
      completedAt: new Date().toISOString(),
      workflowId: this.workflowId,
      result: {
        success: result.success,
        filesProcessed: result.filesProcessed || 0,
        duration: result.duration || 0
      }
    };
    
    await fs.writeJson(completionMarker, completionData, { spaces: 2 });
  }

  /**
   * Save stage result to file
   */
  async saveStageResult(stageName, result) {
    const resultFile = path.join(this.outputDir, stageName, 'stage_result.json');
    const resultData = {
      stage: stageName,
      workflowId: this.workflowId,
      timestamp: new Date().toISOString(),
      ...result
    };
    
    await fs.writeJson(resultFile, resultData, { spaces: 2 });
  }

  /**
   * Get stage result from file
   */
  async getStageResult(stageName) {
    try {
      const resultFile = path.join(this.outputDir, stageName, 'stage_result.json');
      return await fs.readJson(resultFile);
    } catch (error) {
      this.auditLogger.logError(error, {
        stage: stageName,
        operation: 'get_stage_result'
      });
      return null;
    }
  }

  /**
   * Get workflow status
   */
  async getWorkflowStatus() {
    const stages = ['convert', 'cull', 'group', 'imagen-upload', 'imagen-download', 'finalize'];
    const status = {};
    
    for (const stage of stages) {
      status[stage] = {
        completed: await this.isStageCompleted(stage),
        result: await this.getStageResult(stage)
      };
    }
    
    return {
      workflowId: this.workflowId,
      stages: status,
      inputDir: this.inputDir,
      outputDir: this.outputDir
    };
  }

  /**
   * Clean up temporary files and incomplete stages
   */
  async cleanup(keepLogs = true) {
    this.auditLogger.logEvent('cleanup_start', {
      keepLogs
    });

    try {
      // Clean up temporary files in each stage directory
      const stages = ['convert', 'cull', 'group', 'imagen-upload', 'imagen-download', 'finalize'];
      
      for (const stage of stages) {
        const stageDir = path.join(this.outputDir, stage);
        if (await fs.pathExists(stageDir)) {
          // Remove temporary files but keep completed results
          const tempPattern = path.join(stageDir, 'temp_*');
          // Implementation would use glob to find and remove temp files
        }
      }

      if (!keepLogs) {
        // Remove log files
        const logsDir = path.join(this.outputDir, 'logs');
        await fs.remove(logsDir);
      }

      this.auditLogger.logEvent('cleanup_complete', {
        keepLogs
      });

    } catch (error) {
      this.auditLogger.logError(error, {
        operation: 'cleanup'
      });
      throw error;
    }
  }
}

module.exports = StageOrchestrator;