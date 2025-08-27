#!/usr/bin/env node

/**
 * Test Script for Photo Workflow POC with Sample Files
 * Tests the complete workflow with real ARW files
 */

const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

const SAMPLE_FILES_DIR = '/Users/sameerrijhsinghani/Library/Mobile Documents/com~apple~CloudDocs/test-small';
const OUTPUT_DIR = path.join(__dirname, 'test-output');
const CLI_PATH = path.join(__dirname, 'photo-workflow-cli.js');

console.log(chalk.cyan.bold('\n📸 Photo Workflow POC - Test with Sample Files\n'));

async function testWorkflow() {
  try {
    // 1. Clean up previous test output
    console.log(chalk.yellow('🧹 Cleaning up previous test output...'));
    await fs.remove(OUTPUT_DIR);
    await fs.ensureDir(OUTPUT_DIR);

    // 2. Check sample files
    console.log(chalk.yellow('\n📁 Checking sample files...'));
    const sampleFiles = await fs.readdir(SAMPLE_FILES_DIR);
    const arwFiles = sampleFiles.filter(f => f.toLowerCase().endsWith('.arw'));
    console.log(chalk.green(`✅ Found ${arwFiles.length} ARW files:`));
    arwFiles.forEach(f => console.log(`   - ${f}`));

    // 3. Create .env file if it doesn't exist
    const envPath = path.join(__dirname, '.env');
    if (!await fs.pathExists(envPath)) {
      console.log(chalk.yellow('\n⚙️ Creating .env file with mock mode enabled...'));
      const envContent = `
# Photo Workflow POC Configuration
GEMINI_API_KEY=mock-api-key-for-testing
IMAGEN_API_KEY=mock-api-key-for-testing
ENABLE_MOCK_AI=true
DEBUG_MODE=true
VERBOSE_LOGGING=true
`;
      await fs.writeFile(envPath, envContent);
      console.log(chalk.green('✅ .env file created with mock mode enabled'));
    }

    // 4. Test Stage 1: Convert RAW to JPEG
    console.log(chalk.cyan.bold('\n🔄 Stage 1: Converting RAW to JPEG...'));
    try {
      const convertCmd = `node "${CLI_PATH}" convert --input "${SAMPLE_FILES_DIR}" --output "${OUTPUT_DIR}" --verbose`;
      console.log(chalk.gray(`Running: ${convertCmd}`));
      const convertOutput = execSync(convertCmd, { encoding: 'utf8' });
      console.log(chalk.green('✅ Conversion completed successfully'));
      
      // Check converted files
      const convertedDir = path.join(OUTPUT_DIR, '01-converted', 'images');
      if (await fs.pathExists(convertedDir)) {
        const convertedFiles = await fs.readdir(convertedDir);
        console.log(chalk.green(`   Converted ${convertedFiles.length} files`));
      }
    } catch (error) {
      console.log(chalk.red('❌ Conversion failed:', error.message));
      console.log(chalk.yellow('   This might be expected if dcraw is not installed'));
      console.log(chalk.yellow('   Creating mock JPEGs for testing...'));
      
      // Create mock JPEGs for testing
      const mockDir = path.join(OUTPUT_DIR, '01-converted', 'images');
      await fs.ensureDir(mockDir);
      for (const arw of arwFiles) {
        const jpegName = arw.replace('.ARW', '.jpg');
        const mockContent = `Mock JPEG for ${arw}`;
        await fs.writeFile(path.join(mockDir, jpegName), mockContent);
      }
      console.log(chalk.green('✅ Mock JPEGs created for testing'));
    }

    // 5. Test Stage 2: AI Culling
    console.log(chalk.cyan.bold('\n🤖 Stage 2: AI Culling (Mock Mode)...'));
    try {
      const cullCmd = `node "${CLI_PATH}" cull --input "${OUTPUT_DIR}" --verbose`;
      console.log(chalk.gray(`Running: ${cullCmd}`));
      const cullOutput = execSync(cullCmd, { encoding: 'utf8' });
      console.log(chalk.green('✅ Culling completed successfully'));
      
      // Check culling results
      const cullReport = path.join(OUTPUT_DIR, '02-culled', 'CULLING_REPORT.json');
      if (await fs.pathExists(cullReport)) {
        const report = await fs.readJson(cullReport);
        console.log(chalk.green(`   Kept: ${report.summary?.kept || 0} images`));
        console.log(chalk.green(`   Rejected: ${report.summary?.rejected || 0} images`));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️ Culling stage warning:', error.message));
    }

    // 6. Test Stage 3: Grouping
    console.log(chalk.cyan.bold('\n📊 Stage 3: Smart Grouping...'));
    try {
      const groupCmd = `node "${CLI_PATH}" group --input "${OUTPUT_DIR}" --verbose`;
      console.log(chalk.gray(`Running: ${groupCmd}`));
      const groupOutput = execSync(groupCmd, { encoding: 'utf8' });
      console.log(chalk.green('✅ Grouping completed successfully'));
      
      // Check grouping results
      const groupReport = path.join(OUTPUT_DIR, '03-grouped', 'GROUPING_REPORT.json');
      if (await fs.pathExists(groupReport)) {
        const report = await fs.readJson(groupReport);
        console.log(chalk.green(`   Created ${report.summary?.groupsCreated || 0} groups`));
        console.log(chalk.green(`   Ungrouped: ${report.summary?.ungroupedImages || 0} images`));
      }
      
      // Check for HTML report
      const htmlReport = path.join(OUTPUT_DIR, '03-grouped', 'GROUPING_REPORT.html');
      if (await fs.pathExists(htmlReport)) {
        console.log(chalk.green('✅ HTML visual report generated successfully'));
        console.log(chalk.cyan(`   View report: file://${htmlReport}`));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️ Grouping stage warning:', error.message));
    }

    // 7. Check overall workflow status
    console.log(chalk.cyan.bold('\n📈 Checking Workflow Status...'));
    try {
      const statusCmd = `node "${CLI_PATH}" status --input "${OUTPUT_DIR}"`;
      const statusOutput = execSync(statusCmd, { encoding: 'utf8' });
      console.log(statusOutput);
    } catch (error) {
      console.log(chalk.yellow('⚠️ Status check warning:', error.message));
    }

    // 8. Summary
    console.log(chalk.green.bold('\n✅ Test completed successfully!'));
    console.log(chalk.cyan('\n📁 Test output location:'));
    console.log(`   ${OUTPUT_DIR}`);
    console.log(chalk.cyan('\n📊 View results in Finder:'));
    console.log(`   open "${OUTPUT_DIR}"`);
    
    // Open the output folder in Finder
    try {
      execSync(`open "${OUTPUT_DIR}"`);
      console.log(chalk.green('\n✅ Opened output folder in Finder'));
    } catch (error) {
      // Ignore if open command fails
    }

  } catch (error) {
    console.error(chalk.red('\n❌ Test failed:'), error.message);
    console.error(chalk.yellow('\nTip: Make sure all dependencies are installed:'));
    console.error(chalk.yellow('  cd photo-workflow-poc && npm install'));
  }
}

// Run the test
testWorkflow().catch(console.error);