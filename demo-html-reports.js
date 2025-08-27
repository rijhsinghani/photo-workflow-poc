#!/usr/bin/env node

/**
 * HTML Visual Reports Demo
 * 
 * This demo script shows how the HTML visual reports integrate
 * with the photo workflow and demonstrates all features.
 */

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const AuditLogger = require('./lib/auditLogger');
const GroupStage = require('./stages/groupStage');
const HtmlReportGenerator = require('./lib/htmlReportGenerator');

class HtmlReportsDemo {
  constructor() {
    this.demoDir = path.join(__dirname, 'demo-output');
    this.mockPhotosDir = path.join(this.demoDir, 'mock-photos');
    this.outputDir = path.join(this.demoDir, 'grouped');
  }

  /**
   * Run complete HTML reports demonstration
   */
  async runDemo() {
    console.log(chalk.blue.bold('🎬 HTML Visual Reports Demo\n'));
    console.log(chalk.gray('This demo shows the complete HTML reporting workflow\n'));

    try {
      // Setup demo environment
      await this.setupDemoEnvironment();
      
      // Create mock photo data
      await this.createMockPhotoData();
      
      // Run grouping stage with HTML reports
      await this.runGroupingWithReports();
      
      // Show results
      await this.showDemoResults();
      
      console.log(chalk.green.bold('\n🎉 Demo completed successfully!'));
      
    } catch (error) {
      console.error(chalk.red.bold('\n💥 Demo failed:'), error.message);
      throw error;
    }
  }

  /**
   * Setup demo environment
   */
  async setupDemoEnvironment() {
    console.log(chalk.yellow('📁 Setting up demo environment...'));
    
    await fs.ensureDir(this.demoDir);
    await fs.ensureDir(this.mockPhotosDir);
    await fs.ensureDir(this.outputDir);
    
    console.log(chalk.gray(`   Demo directory: ${this.demoDir}`));
  }

  /**
   * Create mock photo data for demonstration
   */
  async createMockPhotoData() {
    console.log(chalk.yellow('\n📸 Creating mock photo data...'));
    
    const mockPhotos = [
      // Morning portrait session
      { name: 'DSC_001.jpg', timestamp: '2024-01-15T09:30:00.000Z', camera: 'Nikon D850' },
      { name: 'DSC_002.jpg', timestamp: '2024-01-15T09:32:00.000Z', camera: 'Nikon D850' },
      { name: 'DSC_003.jpg', timestamp: '2024-01-15T09:35:00.000Z', camera: 'Nikon D850' },
      
      // Afternoon landscape session
      { name: 'IMG_201.jpg', timestamp: '2024-01-15T14:15:00.000Z', camera: 'Canon EOS R5' },
      { name: 'IMG_202.jpg', timestamp: '2024-01-15T14:17:00.000Z', camera: 'Canon EOS R5' },
      { name: 'IMG_203.jpg', timestamp: '2024-01-15T14:20:00.000Z', camera: 'Canon EOS R5' },
      { name: 'IMG_204.jpg', timestamp: '2024-01-15T14:22:00.000Z', camera: 'Canon EOS R5' },
      { name: 'IMG_205.jpg', timestamp: '2024-01-15T14:25:00.000Z', camera: 'Canon EOS R5' },
      
      // Evening event session
      { name: 'A7R_1001.jpg', timestamp: '2024-01-15T18:45:00.000Z', camera: 'Sony A7R V' },
      { name: 'A7R_1002.jpg', timestamp: '2024-01-15T18:47:00.000Z', camera: 'Sony A7R V' },
      { name: 'A7R_1003.jpg', timestamp: '2024-01-15T18:49:00.000Z', camera: 'Sony A7R V' },
      { name: 'A7R_1004.jpg', timestamp: '2024-01-15T18:51:00.000Z', camera: 'Sony A7R V' },
      { name: 'A7R_1005.jpg', timestamp: '2024-01-15T18:53:00.000Z', camera: 'Sony A7R V' },
      { name: 'A7R_1006.jpg', timestamp: '2024-01-15T18:55:00.000Z', camera: 'Sony A7R V' },
      { name: 'A7R_1007.jpg', timestamp: '2024-01-15T18:57:00.000Z', camera: 'Sony A7R V' },
    ];

    for (const photo of mockPhotos) {
      const filePath = path.join(this.mockPhotosDir, photo.name);
      
      // Create a simple test image using Sharp
      const sharp = require('sharp');
      
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 100 + Math.random() * 155, g: 100 + Math.random() * 155, b: 100 + Math.random() * 155 }
        }
      })
      .jpeg({ quality: 90 })
      .toFile(filePath);
      
      // Set file timestamp to match photo timestamp
      const timestamp = new Date(photo.timestamp);
      await fs.utimes(filePath, timestamp, timestamp);
    }
    
    console.log(chalk.gray(`   Created ${mockPhotos.length} mock photos`));
  }

  /**
   * Run grouping stage with HTML reports enabled
   */
  async runGroupingWithReports() {
    console.log(chalk.yellow('\n🔄 Running grouping stage with HTML reports...'));
    
    // Create audit logger
    const auditLogger = new AuditLogger({
      outputDir: this.demoDir,
      stageName: 'group',
      verbose: true
    });
    
    // Create group stage with HTML reporting
    const groupStage = new GroupStage({
      auditLogger: auditLogger,
      outputDir: this.demoDir,
      verbose: true
    });
    
    // Execute grouping
    const results = await groupStage.execute({
      inputPath: this.mockPhotosDir,
      outputPath: this.outputDir,
      timeThreshold: 10, // 10 minutes
      auditLogger: auditLogger,
      dryRun: false
    });
    
    // End audit logging
    await auditLogger.endStage({
      filesProcessed: results.filesProcessed,
      groupsCreated: results.groupsCreated,
      success: results.success
    });
    
    console.log(chalk.green(`   ✅ Processed ${results.filesProcessed} files into ${results.groupsCreated} groups`));
  }

  /**
   * Show demo results and available reports
   */
  async showDemoResults() {
    console.log(chalk.yellow('\n📊 Demo Results Summary:'));
    
    const reportsDir = path.join(this.demoDir, 'reports');
    const htmlReport = path.join(reportsDir, 'GROUPING_REPORT.html');
    
    if (await fs.pathExists(htmlReport)) {
      const stats = await fs.stat(htmlReport);
      
      console.log(chalk.green('   ✅ HTML Visual Report Generated'));
      console.log(chalk.gray(`      Path: ${htmlReport}`));
      console.log(chalk.gray(`      Size: ${Math.round(stats.size / 1024)} KB`));
      
      // Check for thumbnails
      const thumbnailsDir = path.join(reportsDir, 'thumbnails');
      if (await fs.pathExists(thumbnailsDir)) {
        const thumbnails = await fs.readdir(thumbnailsDir);
        console.log(chalk.gray(`      Thumbnails: ${thumbnails.length} generated`));
      }
      
      console.log(chalk.blue.bold('\n🌐 Open in Browser:'));
      console.log(chalk.cyan(`   file://${htmlReport}`));
      
    } else {
      console.log(chalk.red('   ❌ HTML Report not found'));
    }
    
    // Show other generated files
    console.log(chalk.yellow('\n📁 Other Generated Files:'));
    
    const logsDir = path.join(this.demoDir, 'logs');
    if (await fs.pathExists(logsDir)) {
      const logFiles = await fs.readdir(logsDir);
      logFiles.forEach(file => {
        console.log(chalk.gray(`   📄 ${file}`));
      });
    }
    
    const jsonReport = path.join(this.outputDir, 'grouping_report.json');
    if (await fs.pathExists(jsonReport)) {
      console.log(chalk.gray(`   📊 grouping_report.json (JSON data)`));
    }
  }

  /**
   * Demonstrate features of generated report
   */
  async demonstrateReportFeatures() {
    console.log(chalk.blue.bold('\n🔍 HTML Report Features:'));
    
    console.log(chalk.white('   📋 Report Sections:'));
    console.log(chalk.gray('      • Header with summary statistics'));
    console.log(chalk.gray('      • Interactive group containers'));
    console.log(chalk.gray('      • Representative image highlighting'));
    console.log(chalk.gray('      • Thumbnail grid with hover tooltips'));
    console.log(chalk.gray('      • Collapsible sections for large groups'));
    
    console.log(chalk.white('\n   🎨 Visual Features:'));
    console.log(chalk.gray('      • Responsive design (mobile-friendly)'));
    console.log(chalk.gray('      • Print-optimized layout'));
    console.log(chalk.gray('      • Professional color scheme'));
    console.log(chalk.gray('      • Interactive hover effects'));
    console.log(chalk.gray('      • Gold highlighting for representatives'));
    
    console.log(chalk.white('\n   ⚙️ Interactive Features:'));
    console.log(chalk.gray('      • Click to expand/collapse groups'));
    console.log(chalk.gray('      • Hover for detailed image metadata'));
    console.log(chalk.gray('      • Print button for hard copies'));
    console.log(chalk.gray('      • Responsive tooltips'));
  }

  /**
   * Clean up demo files
   */
  async cleanup() {
    console.log(chalk.yellow('\n🧹 Cleaning up demo files...'));
    
    try {
      await fs.remove(this.demoDir);
      console.log(chalk.green('   ✅ Demo files cleaned up'));
    } catch (error) {
      console.warn(chalk.yellow('   ⚠️ Could not clean up demo files:', error.message));
    }
  }
}

// CLI functionality
async function main() {
  const args = process.argv.slice(2);
  const shouldCleanup = !args.includes('--keep-files');
  const showFeatures = args.includes('--show-features');
  
  const demo = new HtmlReportsDemo();
  
  try {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║              HTML Visual Reports Demo                    ║');
    console.log('║          Photo Workflow POC - Visual Reports            ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
    
    await demo.runDemo();
    
    if (showFeatures) {
      await demo.demonstrateReportFeatures();
    }
    
    console.log(chalk.blue.bold('\n💡 Try These Commands:'));
    console.log(chalk.gray('   npm run test:html-reports    # Test report generation'));
    console.log(chalk.gray('   npm run generate-report      # Convert JSON to HTML'));
    console.log(chalk.gray('   node demo-html-reports.js --show-features  # Show all features'));
    console.log(chalk.gray('   node demo-html-reports.js --keep-files     # Keep demo files'));
    
    if (shouldCleanup) {
      await demo.cleanup();
    } else {
      console.log(chalk.yellow('\n📁 Demo files preserved (use --cleanup to remove)'));
    }
    
  } catch (error) {
    console.error(chalk.red.bold('\n💥 Demo failed:'), error.message);
    
    if (shouldCleanup) {
      await demo.cleanup();
    }
    
    process.exit(1);
  }
}

// Export for use as module
module.exports = HtmlReportsDemo;

// Run demo if executed directly
if (require.main === module) {
  main();
}