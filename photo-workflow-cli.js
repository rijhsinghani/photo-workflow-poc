#!/usr/bin/env node

/**
 * Photo Workflow CLI - Stage-based photo processing pipeline
 * 
 * Stages:
 * 1. convert    - RAW to JPEG with metadata preservation
 * 2. cull       - AI culling with Gemini
 * 3. group      - Smart grouping by time and similarity
 * 4. imagen-upload   - Upload to Imagen AI for enhancement
 * 5. imagen-download - Download enhanced images from Imagen AI
 * 6. finalize   - Apply XMP metadata and export
 */

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

// Import stage processors and utilities
const AuditLogger = require('./lib/auditLogger');
const StageOrchestrator = require('./lib/stageOrchestrator');

// Import individual stage processors
const ConvertStage = require('./stages/convertStage');
const CullStage = require('./stages/cullStage');
const GroupStage = require('./stages/groupStage');
const ImagenUploadStage = require('./stages/imagenUploadStage');
const ImagenDownloadStage = require('./stages/imagenDownloadStage');
const FinalizeStage = require('./stages/finalizeStage');

const program = new Command();

// CLI Configuration
program
  .name('photo-workflow')
  .description('CLI tool for professional photo workflow processing')
  .version('1.0.0');

// Global options
program
  .option('-i, --input <path>', 'Input directory path (required)')
  .option('-o, --output <path>', 'Output directory path (defaults to ./output)')
  .option('--stage <stage>', 'Run specific stage (convert|cull|group|imagen-upload|imagen-download|finalize)')
  .option('--run-all', 'Run all stages in sequence')
  .option('--verbose', 'Enable verbose logging')
  .option('--dry-run', 'Simulate operations without making changes')
  .option('--force', 'Force processing even if stage already completed')
  .option('--config <path>', 'Custom configuration file path');

// Stage-specific commands
program
  .command('convert')
  .description('Stage 1: Convert RAW files to JPEG with metadata preservation')
  .option('-i, --input <path>', 'Input directory containing RAW files')
  .option('-o, --output <path>', 'Output directory for converted JPEGs')
  .option('--quality <number>', 'JPEG quality (1-100)', '90')
  .option('--resize <size>', 'Resize images (e.g., 2048x1536)', null)
  .option('--mock', 'Use mock mode for testing (skip actual file processing)')
  .action(async (options, command) => {
    await runStage('convert', options, command);
  });

program
  .command('cull')
  .description('Stage 2: AI-powered photo culling using Gemini')
  .option('-i, --input <path>', 'Input directory containing converted JPEGs')
  .option('-o, --output <path>', 'Output directory for culled photos')
  .option('--threshold <number>', 'Culling threshold (0-1)', '0.7')
  .option('--mock', 'Use mock mode for testing')
  .action(async (options, command) => {
    await runStage('cull', options, command);
  });

program
  .command('group')
  .description('Stage 3: Smart grouping by time and visual similarity')
  .option('-i, --input <path>', 'Input directory containing culled photos')
  .option('-o, --output <path>', 'Output directory for grouped photos')
  .option('--time-threshold <minutes>', 'Time threshold for grouping (minutes)', '15')
  .option('--mock', 'Use mock mode for testing')
  .action(async (options, command) => {
    await runStage('group', options, command);
  });

program
  .command('imagen-upload')
  .description('Stage 4: Upload photos to Imagen AI for enhancement')
  .option('-i, --input <path>', 'Input directory containing grouped photos')
  .option('-o, --output <path>', 'Output directory for tracking data')
  .option('--mock', 'Use mock mode for testing')
  .action(async (options, command) => {
    await runStage('imagen-upload', options, command);
  });

program
  .command('imagen-download')
  .description('Stage 5: Download enhanced photos from Imagen AI')
  .option('-i, --input <path>', 'Input directory containing tracking data')
  .option('-o, --output <path>', 'Output directory for enhanced photos')
  .option('--mock', 'Use mock mode for testing')
  .action(async (options, command) => {
    await runStage('imagen-download', options, command);
  });

program
  .command('finalize')
  .description('Stage 6: Apply XMP metadata and finalize export')
  .option('-i, --input <path>', 'Input directory containing enhanced photos')
  .option('-o, --output <path>', 'Output directory for final photos')
  .option('--mock', 'Use mock mode for testing')
  .action(async (options, command) => {
    await runStage('finalize', options, command);
  });

program
  .command('run-all')
  .description('Run all stages in sequence')
  .option('-i, --input <path>', 'Input directory containing RAW files')
  .option('-o, --output <path>', 'Output directory for final photos')
  .option('--mock', 'Use mock mode for testing')
  .action(async (options, command) => {
    await runAllStages(options, command);
  });

program
  .command('status')
  .description('Show processing status and logs')
  .option('-i, --input <path>', 'Input directory to check status')
  .action(async (options, command) => {
    await showStatus(options, command);
  });

/**
 * Run a specific stage
 */
async function runStage(stageName, options, command) {
  const spinner = ora(`Initializing ${stageName} stage...`).start();
  
  try {
    // Merge command options with parent options
    const globalOpts = program.opts();
    const mergedOptions = {
      ...globalOpts,
      ...options,
      // Command-specific input/output override global ones
      input: options.input || globalOpts.input,
      output: options.output || globalOpts.output
    };

    // Validate required options
    if (!mergedOptions.input) {
      throw new Error('Input directory is required (use -i or --input)');
    }

    // Set default output directory
    const outputDir = mergedOptions.output || path.join(process.cwd(), 'output');
    
    // Initialize audit logger
    const auditLogger = new AuditLogger({
      outputDir,
      stageName,
      verbose: mergedOptions.verbose || false
    });

    // Initialize stage orchestrator
    const orchestrator = new StageOrchestrator({
      inputDir: mergedOptions.input,
      outputDir,
      auditLogger,
      dryRun: mergedOptions.dryRun || false,
      force: mergedOptions.force || false
    });

    spinner.text = `Running ${stageName} stage...`;

    // Execute the specific stage with merged options
    await orchestrator.runStage(stageName, mergedOptions);

    spinner.succeed(chalk.green(`✓ ${stageName} stage completed successfully`));
    
    console.log(chalk.blue(`\n📊 Stage Summary:`));
    console.log(chalk.gray(`Input: ${mergedOptions.input}`));
    console.log(chalk.gray(`Output: ${outputDir}`));
    console.log(chalk.gray(`Logs: ${path.join(outputDir, 'logs')}`));

  } catch (error) {
    spinner.fail(chalk.red(`✗ ${stageName} stage failed`));
    console.error(chalk.red(`Error: ${error.message}`));
    
    if (program.opts().verbose || options.verbose) {
      console.error(chalk.gray(error.stack));
    }
    
    process.exit(1);
  }
}

/**
 * Run all stages in sequence
 */
async function runAllStages(options, command) {
  const spinner = ora('Initializing full workflow...').start();
  
  try {
    // Merge command options with parent options
    const globalOpts = program.opts();
    const mergedOptions = {
      ...globalOpts,
      ...options,
      input: options.input || globalOpts.input,
      output: options.output || globalOpts.output
    };

    // Validate required options
    if (!mergedOptions.input) {
      throw new Error('Input directory is required (use -i or --input)');
    }

    // Set default output directory
    const outputDir = mergedOptions.output || path.join(process.cwd(), 'output');
    
    // Initialize audit logger for full workflow
    const auditLogger = new AuditLogger({
      outputDir,
      stageName: 'full-workflow',
      verbose: mergedOptions.verbose || false
    });

    // Initialize stage orchestrator
    const orchestrator = new StageOrchestrator({
      inputDir: mergedOptions.input,
      outputDir,
      auditLogger,
      dryRun: mergedOptions.dryRun || false,
      force: mergedOptions.force || false
    });

    spinner.text = 'Running full photo workflow...';

    // Define stage sequence with merged options
    const stages = [
      { name: 'convert', options: { quality: mergedOptions.quality || 90, mock: mergedOptions.mock } },
      { name: 'cull', options: { threshold: mergedOptions.threshold || 0.7, mock: mergedOptions.mock } },
      { name: 'group', options: { timeThreshold: mergedOptions.timeThreshold || 15, mock: mergedOptions.mock } },
      { name: 'imagen-upload', options: { mock: mergedOptions.mock } },
      { name: 'imagen-download', options: { mock: mergedOptions.mock } },
      { name: 'finalize', options: { mock: mergedOptions.mock } }
    ];

    // Execute all stages
    await orchestrator.runAllStages(stages);

    spinner.succeed(chalk.green('✓ Full workflow completed successfully'));
    
    console.log(chalk.blue('\n🎉 Workflow Complete!'));
    console.log(chalk.gray(`Input: ${mergedOptions.input}`));
    console.log(chalk.gray(`Output: ${outputDir}`));
    console.log(chalk.gray(`Logs: ${path.join(outputDir, 'logs')}`));

  } catch (error) {
    spinner.fail(chalk.red('✗ Workflow failed'));
    console.error(chalk.red(`Error: ${error.message}`));
    
    if (mergedOptions.verbose || program.opts().verbose) {
      console.error(chalk.gray(error.stack));
    }
    
    process.exit(1);
  }
}

/**
 * Show processing status
 */
async function showStatus(options, command) {
  try {
    const inputDir = options.input || process.cwd();
    const outputDir = path.join(inputDir, 'output');
    
    console.log(chalk.blue('📊 Photo Workflow Status\n'));
    
    // Check if output directory exists
    if (!await fs.pathExists(outputDir)) {
      console.log(chalk.yellow('No workflow runs found.'));
      console.log(chalk.gray(`Expected output directory: ${outputDir}`));
      return;
    }
    
    // Check for stage completion markers
    const stages = ['convert', 'cull', 'group', 'imagen-upload', 'imagen-download', 'finalize'];
    
    for (const stage of stages) {
      const stageDir = path.join(outputDir, stage);
      const logFile = path.join(outputDir, 'logs', `${stage}.json`);
      
      const stageExists = await fs.pathExists(stageDir);
      const logExists = await fs.pathExists(logFile);
      
      if (stageExists && logExists) {
        console.log(chalk.green(`✓ ${stage.padEnd(15)} - Completed`));
        
        // Show basic stats from log
        try {
          const logData = await fs.readJson(logFile);
          const lastEntry = logData[logData.length - 1];
          if (lastEntry && lastEntry.summary) {
            console.log(chalk.gray(`    ${JSON.stringify(lastEntry.summary, null, 0)}`));
          }
        } catch (error) {
          // Ignore log parsing errors
        }
      } else if (stageExists) {
        console.log(chalk.yellow(`⚠ ${stage.padEnd(15)} - Incomplete (no logs)`));
      } else {
        console.log(chalk.gray(`○ ${stage.padEnd(15)} - Not started`));
      }
    }
    
    console.log(chalk.blue(`\n📂 Output Directory: ${outputDir}`));
    console.log(chalk.blue(`📄 Logs Directory: ${path.join(outputDir, 'logs')}`));
    
  } catch (error) {
    console.error(chalk.red(`Error checking status: ${error.message}`));
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
  process.exit(1);
});

// Parse command line arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}