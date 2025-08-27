#!/usr/bin/env node

/**
 * Generate HTML Report from Existing JSON Data
 * 
 * This utility script can generate HTML visual reports from existing
 * JSON grouping data, useful for retroactive analysis or when
 * original processing didn't generate HTML reports.
 */

const fs = require('fs-extra');
const path = require('path');
const HtmlReportGenerator = require('./lib/htmlReportGenerator');

class JsonToHtmlConverter {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.outputDir = options.outputDir || './output';
  }

  /**
   * Convert JSON grouping report to HTML visual report
   */
  async convertGroupingJson(jsonPath, options = {}) {
    try {
      if (this.verbose) {
        console.log(`📖 Reading JSON data from: ${jsonPath}`);
      }

      // Read and parse JSON data
      const jsonData = await fs.readJson(jsonPath);
      
      // Validate JSON structure
      this.validateGroupingJson(jsonData);
      
      // Convert to HTML report format
      const groups = this.convertJsonToGroups(jsonData);
      
      // Create HTML report generator
      const reportGenerator = new HtmlReportGenerator({
        outputDir: this.outputDir,
        verbose: this.verbose
      });
      
      // Generate HTML report
      const reportResult = await reportGenerator.generateGroupingReport(
        groups,
        {
          duration: jsonData.summary?.duration || 0,
          totalFiles: jsonData.summary?.totalInputFiles || groups.reduce((sum, g) => sum + g.files.length, 0)
        },
        this.createMockAuditLogger()
      );
      
      if (this.verbose) {
        console.log('✅ HTML report generated successfully!');
        console.log(`   Report path: ${reportResult.reportPath}`);
        console.log(`   Groups: ${reportResult.groupCount}`);
        console.log(`   Thumbnails: ${reportResult.thumbnailCount}`);
      }
      
      return reportResult;
      
    } catch (error) {
      console.error('❌ Failed to convert JSON to HTML:', error.message);
      throw error;
    }
  }

  /**
   * Validate JSON structure for grouping data
   */
  validateGroupingJson(jsonData) {
    if (!jsonData) {
      throw new Error('JSON data is empty or invalid');
    }
    
    if (!jsonData.groupDetails || !Array.isArray(jsonData.groupDetails)) {
      throw new Error('JSON data missing groupDetails array');
    }
    
    if (jsonData.groupDetails.length === 0) {
      throw new Error('No groups found in JSON data');
    }
    
    // Validate each group has required fields
    jsonData.groupDetails.forEach((group, index) => {
      if (!group.name) {
        throw new Error(`Group ${index} missing name field`);
      }
      
      if (!group.fileCount && group.fileCount !== 0) {
        throw new Error(`Group ${index} missing fileCount field`);
      }
    });
  }

  /**
   * Convert JSON data to internal group format
   */
  convertJsonToGroups(jsonData) {
    return jsonData.groupDetails.map((groupDetail, index) => {
      // Create mock files based on file count
      const files = Array.from({ length: groupDetail.fileCount }, (_, i) => ({
        filePath: `/reconstructed/path/${groupDetail.name}/IMG_${(i + 1).toString().padStart(3, '0')}.jpg`,
        fileName: `IMG_${(i + 1).toString().padStart(3, '0')}.jpg`,
        timestamp: this.generateTimestampInRange(
          groupDetail.timeSpan?.start,
          groupDetail.timeSpan?.end,
          i,
          groupDetail.fileCount
        ),
        camera: groupDetail.cameras?.[0] || 'Unknown Camera',
        width: 6000,  // Default dimensions
        height: 4000,
        fileSize: 8000000 + (Math.random() * 2000000) // 8-10MB range
      }));

      return {
        name: groupDetail.name,
        files: files,
        startTimestamp: groupDetail.timeSpan?.start || new Date().toISOString(),
        lastTimestamp: groupDetail.timeSpan?.end || new Date().toISOString(),
        averageTimestamp: this.calculateAverageTimestamp(
          groupDetail.timeSpan?.start,
          groupDetail.timeSpan?.end
        ),
        timeSpan: groupDetail.timeSpan?.durationMinutes || 0,
        cameras: new Set(groupDetail.cameras || ['Unknown Camera']),
        locations: groupDetail.hasLocation ? [{ lat: 0, lon: 0 }] : []
      };
    });
  }

  /**
   * Generate timestamp within range for mock files
   */
  generateTimestampInRange(startStr, endStr, index, total) {
    const start = startStr ? new Date(startStr) : new Date();
    const end = endStr ? new Date(endStr) : new Date(start.getTime() + (60 * 60 * 1000)); // +1 hour default
    
    const range = end.getTime() - start.getTime();
    const step = range / (total - 1 || 1);
    
    return new Date(start.getTime() + (step * index)).toISOString();
  }

  /**
   * Calculate average timestamp between start and end
   */
  calculateAverageTimestamp(startStr, endStr) {
    const start = startStr ? new Date(startStr) : new Date();
    const end = endStr ? new Date(endStr) : new Date(start.getTime() + (60 * 60 * 1000));
    
    const avgTime = start.getTime() + ((end.getTime() - start.getTime()) / 2);
    return new Date(avgTime).toISOString();
  }

  /**
   * Create mock audit logger for report generation
   */
  createMockAuditLogger() {
    return {
      logEvent: (event, data, level = 'info') => {
        if (this.verbose) {
          console.log(`[${level.toUpperCase()}] ${event}:`, data);
        }
      },
      logError: (error, context, severity = 'error') => {
        console.error(`[${severity.toUpperCase()}] Error:`, error.message);
        if (this.verbose && context) {
          console.error('Context:', context);
        }
      }
    };
  }

  /**
   * Find and convert all JSON grouping reports in a directory
   */
  async convertAllInDirectory(dirPath, outputDir = './output/converted-reports') {
    const jsonFiles = await fs.readdir(dirPath);
    const groupingFiles = jsonFiles.filter(file => 
      file.includes('grouping') && file.endsWith('.json')
    );

    if (groupingFiles.length === 0) {
      console.log('📭 No grouping JSON files found in directory');
      return [];
    }

    console.log(`🔍 Found ${groupingFiles.length} grouping JSON files`);

    const results = [];
    
    for (const jsonFile of groupingFiles) {
      const jsonPath = path.join(dirPath, jsonFile);
      const baseName = path.basename(jsonFile, '.json');
      
      console.log(`\n📊 Processing: ${jsonFile}`);
      
      try {
        const converter = new JsonToHtmlConverter({
          verbose: this.verbose,
          outputDir: path.join(outputDir, baseName)
        });
        
        const result = await converter.convertGroupingJson(jsonPath);
        results.push({
          source: jsonPath,
          result: result,
          success: true
        });
        
        console.log(`✅ Converted: ${result.reportPath}`);
        
      } catch (error) {
        console.error(`❌ Failed to convert ${jsonFile}:`, error.message);
        results.push({
          source: jsonPath,
          error: error.message,
          success: false
        });
      }
    }

    return results;
  }
}

// CLI functionality
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
🔧 Generate HTML Report from JSON Data

Usage:
  node generate-report-from-json.js <json-file> [output-dir]
  node generate-report-from-json.js --dir <directory> [output-dir]

Examples:
  node generate-report-from-json.js ./output/logs/grouping_report.json
  node generate-report-from-json.js --dir ./output/logs
  node generate-report-from-json.js data.json ./custom-output

Options:
  --verbose    Enable verbose logging
  --dir        Process all JSON files in directory
    `);
    process.exit(1);
  }

  const verbose = args.includes('--verbose');
  const dirMode = args.includes('--dir');
  
  // Remove flags from args
  const cleanArgs = args.filter(arg => !arg.startsWith('--'));
  
  const inputPath = cleanArgs[0];
  const outputDir = cleanArgs[1] || './output';

  if (!inputPath) {
    console.error('❌ Please provide input JSON file or directory');
    process.exit(1);
  }

  try {
    const converter = new JsonToHtmlConverter({ verbose, outputDir });

    if (dirMode) {
      console.log(`🚀 Converting all JSON files in directory: ${inputPath}\n`);
      const results = await converter.convertAllInDirectory(inputPath, outputDir);
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`\n📊 Conversion Summary:`);
      console.log(`   ✅ Successful: ${successful}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   📁 Output directory: ${outputDir}`);
      
    } else {
      console.log(`🚀 Converting JSON file: ${inputPath}\n`);
      const result = await converter.convertGroupingJson(inputPath);
      
      console.log(`\n🎉 Conversion completed successfully!`);
      console.log(`📂 Open the report in your browser:`);
      console.log(`   file://${result.reportPath}`);
    }

  } catch (error) {
    console.error('\n💥 Conversion failed:', error.message);
    if (verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Export for use as module
module.exports = JsonToHtmlConverter;

// Run CLI if executed directly
if (require.main === module) {
  main();
}