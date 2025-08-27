#!/usr/bin/env node

/**
 * Photo Workflow Demo - Demonstrates the complete workflow with mock data
 * 
 * This script shows how the photo workflow system works without requiring
 * real RAW files or external API keys. It creates mock input data and runs
 * all stages in demonstration mode.
 */

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const sharp = require('sharp');

// Import the CLI components
const AuditLogger = require('./lib/auditLogger');
const StageOrchestrator = require('./lib/stageOrchestrator');

class WorkflowDemo {
  constructor() {
    this.demoDir = path.join(process.cwd(), 'demo-workflow');
    this.inputDir = path.join(this.demoDir, 'input');
    this.outputDir = path.join(this.demoDir, 'output');
  }

  /**
   * Run the complete demo workflow
   */
  async run() {
    console.log(chalk.blue.bold('\n🎬 Photo Workflow Demo'));
    console.log(chalk.blue('======================\n'));
    
    console.log(chalk.gray('This demo shows how the photo workflow system processes images'));
    console.log(chalk.gray('through all 6 stages using mock data and simulated processing.\n'));

    try {
      // Step 1: Setup demo environment
      await this.setupDemoEnvironment();
      
      // Step 2: Create mock RAW files
      await this.createMockRawFiles();
      
      // Step 3: Run the complete workflow
      await this.runCompleteWorkflow();
      
      // Step 4: Show results
      await this.showResults();
      
      console.log(chalk.green.bold('\n🎉 Demo completed successfully!'));
      console.log(chalk.gray(`Demo files created in: ${this.demoDir}`));
      
    } catch (error) {
      console.error(chalk.red(`\n❌ Demo failed: ${error.message}`));
      if (process.env.VERBOSE) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  }

  /**
   * Setup demo environment
   */
  async setupDemoEnvironment() {
    const spinner = ora('Setting up demo environment...').start();
    
    try {
      // Clean up previous demo
      if (await fs.pathExists(this.demoDir)) {
        await fs.remove(this.demoDir);
      }
      
      // Create demo directories
      await fs.ensureDir(this.inputDir);
      await fs.ensureDir(this.outputDir);
      
      spinner.succeed(chalk.green('Demo environment ready'));
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to setup demo environment'));
      throw error;
    }
  }

  /**
   * Create mock RAW files for demonstration
   */
  async createMockRawFiles() {
    const spinner = ora('Creating mock RAW files...').start();
    
    try {
      // Mock camera data for realistic filenames
      const mockCameras = [
        { prefix: 'DSC', count: 3, camera: 'Nikon D850' },
        { prefix: 'IMG', count: 5, camera: 'Canon EOS R5' },
        { prefix: 'A7R', count: 7, camera: 'Sony A7R V' }
      ];
      
      let totalFiles = 0;
      
      for (const camera of mockCameras) {
        for (let i = 1; i <= camera.count; i++) {
          const fileNumber = String(i).padStart(4, '0');
          const filename = `${camera.prefix}_${fileNumber}.ARW`;
          const filepath = path.join(this.inputDir, filename);
          
          // Create a realistic-sized mock RAW file (25-35MB range)
          const mockSize = 25000000 + Math.random() * 10000000; // 25-35MB
          const mockBuffer = Buffer.alloc(Math.floor(mockSize), 0);
          
          // Add some mock RAW header data
          const header = Buffer.from('MOCK_RAW_FILE_FOR_DEMO_PURPOSES_ONLY');
          header.copy(mockBuffer, 0);
          
          await fs.writeFile(filepath, mockBuffer);
          totalFiles++;
        }
      }
      
      spinner.succeed(chalk.green(`Created ${totalFiles} mock RAW files`));
      
      // Show created files
      console.log(chalk.blue('  📁 Mock RAW files created:'));
      const files = await fs.readdir(this.inputDir);
      files.forEach(file => {
        console.log(chalk.gray(`    • ${file}`));
      });
      
    } catch (error) {
      spinner.fail(chalk.red('Failed to create mock RAW files'));
      throw error;
    }
  }

  /**
   * Run the complete workflow with all stages
   */
  async runCompleteWorkflow() {
    console.log(chalk.blue('\n🔄 Running Complete Workflow'));
    console.log(chalk.blue('==============================\n'));
    
    // Initialize audit logger
    const auditLogger = new AuditLogger({
      outputDir: this.outputDir,
      stageName: 'demo-workflow',
      verbose: true
    });

    // Initialize orchestrator
    const orchestrator = new StageOrchestrator({
      inputDir: this.inputDir,
      outputDir: this.outputDir,
      auditLogger,
      dryRun: false,
      force: true
    });

    // Define all stages with mock mode
    const stages = [
      { 
        name: 'convert', 
        options: { 
          quality: 90, 
          mock: true,
          description: 'Convert RAW files to JPEG with metadata preservation'
        } 
      },
      { 
        name: 'cull', 
        options: { 
          threshold: 0.7, 
          mock: true,
          description: 'AI-powered photo culling using Gemini'
        } 
      },
      { 
        name: 'group', 
        options: { 
          timeThreshold: 15, 
          mock: true,
          description: 'Smart grouping by time and visual similarity'
        } 
      },
      { 
        name: 'imagen-upload', 
        options: { 
          mock: true,
          description: 'Upload photos to Imagen AI for enhancement'
        } 
      },
      { 
        name: 'imagen-download', 
        options: { 
          mock: true,
          description: 'Download enhanced photos from Imagen AI'
        } 
      },
      { 
        name: 'finalize', 
        options: { 
          mock: true,
          description: 'Apply XMP metadata and finalize export'
        } 
      }
    ];

    // Run all stages
    const results = {};
    
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const spinner = ora(`Stage ${i + 1}/6: ${stage.name} - ${stage.options.description}`).start();
      
      try {
        const startTime = Date.now();
        const result = await orchestrator.runStage(stage.name, stage.options);
        const duration = Date.now() - startTime;
        
        results[stage.name] = { ...result, duration };
        
        spinner.succeed(chalk.green(
          `✓ Stage ${i + 1}/6: ${stage.name} completed ` +
          `(${Math.round(duration / 1000)}s, ${result.filesProcessed || 0} files)`
        ));
        
        // Show stage-specific info
        if (result.filesProcessed > 0) {
          console.log(chalk.gray(`    📊 Processed: ${result.filesProcessed} files`));
        }
        if (result.mockMode) {
          console.log(chalk.yellow(`    🧪 Mock mode: Simulated processing`));
        }
        
      } catch (error) {
        spinner.fail(chalk.red(`✗ Stage ${i + 1}/6: ${stage.name} failed`));
        console.error(chalk.red(`    Error: ${error.message}`));
        throw error;
      }
      
      // Add a small delay for demo effect
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return results;
  }

  /**
   * Show workflow results
   */
  async showResults() {
    console.log(chalk.blue('\n📊 Workflow Results'));
    console.log(chalk.blue('===================\n'));
    
    // Check output structure
    const stages = ['convert', 'cull', 'group', 'imagen-upload', 'imagen-download', 'finalize'];
    
    for (const stage of stages) {
      const stageDir = path.join(this.outputDir, stage);
      if (await fs.pathExists(stageDir)) {
        console.log(chalk.green(`✅ ${stage.padEnd(20)} - Completed`));
        
        // Count files in stage directory
        try {
          const files = await fs.readdir(stageDir);
          const imageFiles = files.filter(f => f.match(/\.(jpg|jpeg|png)$/i));
          if (imageFiles.length > 0) {
            console.log(chalk.gray(`    📁 ${imageFiles.length} image files created`));
          }
          
          // Check for reports
          const reportFile = path.join(stageDir, `${stage}_report.json`);
          if (await fs.pathExists(reportFile)) {
            console.log(chalk.gray(`    📋 Report generated`));
          }
          
        } catch (error) {
          // Ignore directory read errors
        }
      } else {
        console.log(chalk.red(`❌ ${stage.padEnd(20)} - Not found`));
      }
    }
    
    // Show directory structure
    console.log(chalk.blue('\n📂 Output Structure:'));
    console.log(chalk.blue('==================='));
    
    try {
      await this.showDirectoryTree(this.outputDir, '', 0, 2);
    } catch (error) {
      console.log(chalk.gray('Unable to show directory structure'));
    }
    
    // Show logs info
    const logsDir = path.join(this.outputDir, 'logs');
    if (await fs.pathExists(logsDir)) {
      const logFiles = await fs.readdir(logsDir);
      console.log(chalk.blue(`\n📄 Generated ${logFiles.length} log files:`));
      logFiles.slice(0, 5).forEach(file => {
        console.log(chalk.gray(`  • ${file}`));
      });
      if (logFiles.length > 5) {
        console.log(chalk.gray(`  ... and ${logFiles.length - 5} more`));
      }
    }
  }

  /**
   * Show directory tree structure
   */
  async showDirectoryTree(dir, prefix, currentDepth, maxDepth) {
    if (currentDepth >= maxDepth) return;
    
    try {
      const items = await fs.readdir(dir);
      const filteredItems = items.filter(item => !item.startsWith('.')).slice(0, 10);
      
      for (let i = 0; i < filteredItems.length; i++) {
        const item = filteredItems[i];
        const itemPath = path.join(dir, item);
        const stats = await fs.stat(itemPath);
        const isLast = i === filteredItems.length - 1;
        const currentPrefix = isLast ? '└── ' : '├── ';
        const nextPrefix = isLast ? '    ' : '│   ';
        
        if (stats.isDirectory()) {
          console.log(chalk.blue(`${prefix}${currentPrefix}📁 ${item}/`));
          await this.showDirectoryTree(itemPath, prefix + nextPrefix, currentDepth + 1, maxDepth);
        } else {
          const sizeKB = Math.round(stats.size / 1024);
          const icon = item.match(/\.(jpg|jpeg|png)$/i) ? '🖼️ ' : '📄 ';
          console.log(chalk.gray(`${prefix}${currentPrefix}${icon}${item} (${sizeKB}KB)`));
        }
      }
      
      if (items.length > filteredItems.length) {
        console.log(chalk.gray(`${prefix}... and ${items.length - filteredItems.length} more items`));
      }
      
    } catch (error) {
      console.log(chalk.red(`${prefix}[Error reading directory]`));
    }
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Photo Workflow Demo

Usage: node run-demo.js [options]

Options:
  --help, -h     Show this help message
  --verbose      Enable verbose logging
  --keep         Keep demo files after completion (default: cleanup)

This demo creates mock RAW files and runs the complete photo workflow
in mock mode to demonstrate all 6 stages of processing.

Stages demonstrated:
1. Convert - RAW to JPEG conversion
2. Cull - AI-powered photo selection
3. Group - Smart photo grouping
4. Imagen Upload - Cloud enhancement upload
5. Imagen Download - Enhanced photo download
6. Finalize - Metadata application and export
`);
    process.exit(0);
  }
  
  if (args.includes('--verbose')) {
    process.env.VERBOSE = 'true';
  }
  
  const demo = new WorkflowDemo();
  
  // Run demo and cleanup
  demo.run()
    .then(() => {
      if (!args.includes('--keep')) {
        console.log(chalk.gray('\n🧹 Cleaning up demo files...'));
        return fs.remove(demo.demoDir);
      }
    })
    .then(() => {
      if (!args.includes('--keep')) {
        console.log(chalk.gray('Demo cleanup completed'));
      }
    })
    .catch(error => {
      console.error(chalk.red('\nDemo failed:', error.message));
      process.exit(1);
    });
}

module.exports = WorkflowDemo;