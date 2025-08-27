#!/usr/bin/env node

/**
 * Test HTML Report Generation
 * 
 * This test script demonstrates the HTML visual report generation
 * functionality without requiring actual image files.
 */

const path = require('path');
const fs = require('fs-extra');
const HtmlReportGenerator = require('./lib/htmlReportGenerator');

// Mock data for testing
const createMockGroups = () => [
  {
    name: 'Group_01_2024-01-15_09-30',
    files: [
      {
        filePath: '/mock/path/IMG_001.jpg',
        fileName: 'IMG_001.jpg',
        timestamp: '2024-01-15T09:30:00.000Z',
        camera: 'Canon EOS R5',
        width: 6000,
        height: 4000,
        fileSize: 8500000
      },
      {
        filePath: '/mock/path/IMG_002.jpg',
        fileName: 'IMG_002.jpg',
        timestamp: '2024-01-15T09:32:00.000Z',
        camera: 'Canon EOS R5',
        width: 6000,
        height: 4000,
        fileSize: 8200000
      },
      {
        filePath: '/mock/path/IMG_003.jpg',
        fileName: 'IMG_003.jpg',
        timestamp: '2024-01-15T09:35:00.000Z',
        camera: 'Canon EOS R5',
        width: 6000,
        height: 4000,
        fileSize: 8800000
      }
    ],
    startTimestamp: '2024-01-15T09:30:00.000Z',
    lastTimestamp: '2024-01-15T09:35:00.000Z',
    averageTimestamp: '2024-01-15T09:32:30.000Z',
    timeSpan: 5,
    cameras: new Set(['Canon EOS R5']),
    locations: []
  },
  {
    name: 'Group_02_2024-01-15_14-15',
    files: [
      {
        filePath: '/mock/path/IMG_010.jpg',
        fileName: 'IMG_010.jpg',
        timestamp: '2024-01-15T14:15:00.000Z',
        camera: 'Sony A7R V',
        width: 9504,
        height: 6336,
        fileSize: 12000000
      },
      {
        filePath: '/mock/path/IMG_011.jpg',
        fileName: 'IMG_011.jpg',
        timestamp: '2024-01-15T14:17:00.000Z',
        camera: 'Sony A7R V',
        width: 9504,
        height: 6336,
        fileSize: 11800000
      },
      {
        filePath: '/mock/path/IMG_012.jpg',
        fileName: 'IMG_012.jpg',
        timestamp: '2024-01-15T14:20:00.000Z',
        camera: 'Sony A7R V',
        width: 9504,
        height: 6336,
        fileSize: 12200000
      },
      {
        filePath: '/mock/path/IMG_013.jpg',
        fileName: 'IMG_013.jpg',
        timestamp: '2024-01-15T14:22:00.000Z',
        camera: 'Sony A7R V',
        width: 9504,
        height: 6336,
        fileSize: 11900000
      },
      {
        filePath: '/mock/path/IMG_014.jpg',
        fileName: 'IMG_014.jpg',
        timestamp: '2024-01-15T14:25:00.000Z',
        camera: 'Sony A7R V',
        width: 9504,
        height: 6336,
        fileSize: 12100000
      }
    ],
    startTimestamp: '2024-01-15T14:15:00.000Z',
    lastTimestamp: '2024-01-15T14:25:00.000Z',
    averageTimestamp: '2024-01-15T14:20:00.000Z',
    timeSpan: 10,
    cameras: new Set(['Sony A7R V']),
    locations: []
  },
  {
    name: 'Group_03_2024-01-15_18-45',
    files: Array.from({ length: 12 }, (_, i) => ({
      filePath: `/mock/path/IMG_${(i + 20).toString().padStart(3, '0')}.jpg`,
      fileName: `IMG_${(i + 20).toString().padStart(3, '0')}.jpg`,
      timestamp: new Date(Date.parse('2024-01-15T18:45:00.000Z') + (i * 2 * 60 * 1000)).toISOString(),
      camera: i % 2 === 0 ? 'Nikon D850' : 'Canon EOS R6',
      width: 8256,
      height: 5504,
      fileSize: 9500000 + (Math.random() * 2000000)
    })),
    startTimestamp: '2024-01-15T18:45:00.000Z',
    lastTimestamp: '2024-01-15T19:07:00.000Z',
    averageTimestamp: '2024-01-15T18:56:00.000Z',
    timeSpan: 22,
    cameras: new Set(['Nikon D850', 'Canon EOS R6']),
    locations: []
  }
];

// Mock audit logger
const createMockAuditLogger = () => ({
  logEvent: (event, data, level = 'info') => {
    console.log(`[${level.toUpperCase()}] ${event}:`, data);
  },
  logError: (error, context, severity = 'error') => {
    console.error(`[${severity.toUpperCase()}] Error:`, error.message, context);
  }
});

async function testHtmlReportGeneration() {
  console.log('🧪 Testing HTML Report Generation...\n');
  
  const outputDir = path.join(__dirname, 'test-output');
  await fs.ensureDir(outputDir);
  
  const reportGenerator = new HtmlReportGenerator({
    outputDir,
    verbose: true
  });
  
  // Override thumbnail generation for testing
  reportGenerator.generateThumbnails = async (groups) => {
    const thumbnailMap = {};
    groups.forEach(group => {
      group.files.forEach(file => {
        // Use placeholder for all images in test
        thumbnailMap[file.filePath] = reportGenerator.getPlaceholderThumbnail();
      });
    });
    return thumbnailMap;
  };
  
  const mockGroups = createMockGroups();
  const mockAuditLogger = createMockAuditLogger();
  
  try {
    console.log('📊 Generating HTML grouping report...');
    
    const result = await reportGenerator.generateGroupingReport(
      mockGroups,
      { 
        duration: 15420,
        totalFiles: mockGroups.reduce((sum, g) => sum + g.files.length, 0)
      },
      mockAuditLogger
    );
    
    console.log('\n✅ HTML Report Generation Test Results:');
    console.log(`   • Report generated: ${result.success ? 'YES' : 'NO'}`);
    console.log(`   • Report path: ${result.reportPath}`);
    console.log(`   • Groups processed: ${result.groupCount}`);
    console.log(`   • Thumbnails generated: ${result.thumbnailCount}`);
    
    // Check if file exists
    const reportExists = await fs.pathExists(result.reportPath);
    console.log(`   • File exists: ${reportExists ? 'YES' : 'NO'}`);
    
    if (reportExists) {
      const fileStats = await fs.stat(result.reportPath);
      console.log(`   • File size: ${Math.round(fileStats.size / 1024)} KB`);
      console.log(`\n📂 Open the report in your browser:`);
      console.log(`   file://${result.reportPath}`);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

async function testReportFeatures() {
  console.log('\n🔍 Testing Report Features...\n');
  
  const outputDir = path.join(__dirname, 'test-output');
  const reportGenerator = new HtmlReportGenerator({
    outputDir,
    verbose: true
  });
  
  // Test helper functions
  console.log('📏 Testing utility functions:');
  
  const fileSize = reportGenerator.formatFileSize(8500000);
  console.log(`   • Format file size (8.5MB): ${fileSize}`);
  
  const truncated = reportGenerator.truncateFilename('Very_Long_Filename_That_Should_Be_Truncated.jpg', 20);
  console.log(`   • Truncate filename: ${truncated}`);
  
  // Test statistics calculation
  const mockGroups = createMockGroups();
  const stats = reportGenerator.calculateGroupingStats(mockGroups, { duration: 15420 });
  
  console.log('\n📈 Generated statistics:');
  console.log(`   • Total groups: ${stats.totalGroups}`);
  console.log(`   • Total images: ${stats.totalImages}`);
  console.log(`   • Average group size: ${stats.averageGroupSize}`);
  console.log(`   • Small groups (<5): ${stats.smallGroups}`);
  console.log(`   • Medium groups (5-20): ${stats.mediumGroups}`);
  console.log(`   • Large groups (20+): ${stats.largeGroups}`);
  console.log(`   • Time span - shortest: ${stats.timeSpanStats.shortest}min`);
  console.log(`   • Time span - longest: ${stats.timeSpanStats.longest}min`);
  console.log(`   • Time span - average: ${stats.timeSpanStats.average}min`);
  
  console.log('\n✅ Feature tests completed successfully!');
}

async function main() {
  try {
    console.log('🚀 HTML Visual Report Generator Test Suite\n');
    console.log('==========================================\n');
    
    await testReportFeatures();
    await testHtmlReportGeneration();
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. Run the actual grouping stage to see real reports');
    console.log('   2. Open the generated HTML file in your browser');
    console.log('   3. Test the interactive features (tooltips, collapsible sections)');
    console.log('   4. Try printing the report to test print styles');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  testHtmlReportGeneration,
  testReportFeatures,
  createMockGroups,
  createMockAuditLogger
};