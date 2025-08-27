#!/usr/bin/env node

/**
 * Simple test script to validate CLI structure and functionality
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 Testing Photo Workflow CLI Structure...\n');

// Test 1: Check if all required files exist
console.log('📁 Checking required files...');
const requiredFiles = [
  'photo-workflow-cli.js',
  'package.json',
  'lib/auditLogger.js',
  'lib/stageOrchestrator.js',
  'stages/convertStage.js',
  'stages/cullStage.js',
  'stages/groupStage.js',
  'stages/imagenUploadStage.js',
  'stages/imagenDownloadStage.js',
  'stages/finalizeStage.js',
  '.env.example',
  'README.md'
];

let allFilesExist = true;
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allFilesExist = false;
  }
}

// Test 2: Check if CLI is executable
console.log('\n🔧 Checking CLI executable...');
const cliPath = path.join(__dirname, 'photo-workflow-cli.js');
try {
  const stats = fs.statSync(cliPath);
  const isExecutable = !!(stats.mode & parseInt('111', 8));
  if (isExecutable) {
    console.log('✅ CLI is executable');
  } else {
    console.log('⚠️ CLI is not executable (run: chmod +x photo-workflow-cli.js)');
  }
} catch (error) {
  console.log('❌ Cannot check CLI executable status');
}

// Test 3: Test basic CLI help
console.log('\n📖 Testing CLI help command...');
try {
  const helpOutput = execSync('node photo-workflow-cli.js --help', { 
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 5000
  });
  
  if (helpOutput.includes('photo-workflow') && helpOutput.includes('Usage:')) {
    console.log('✅ CLI help command works');
  } else {
    console.log('⚠️ CLI help output may be incomplete');
  }
} catch (error) {
  console.log('❌ CLI help command failed:', error.message.split('\n')[0]);
}

// Test 4: Test individual stage help
console.log('\n⚙️ Testing individual stage commands...');
const stages = ['convert', 'cull', 'group', 'imagen-upload', 'imagen-download', 'finalize'];

for (const stage of stages) {
  try {
    const stageOutput = execSync(`node photo-workflow-cli.js ${stage} --help`, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 3000
    });
    
    if (stageOutput.includes(stage)) {
      console.log(`✅ ${stage} command`);
    } else {
      console.log(`⚠️ ${stage} command may have issues`);
    }
  } catch (error) {
    console.log(`❌ ${stage} command failed`);
  }
}

// Test 5: Check package.json structure
console.log('\n📦 Checking package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  
  const requiredDeps = [
    'sharp', 'exifr', 'axios', 'dotenv', 'commander', 
    'chalk', 'ora', 'fs-extra', 'uuid', 'xml2js', 
    'date-fns', 'glob', 'form-data'
  ];
  
  let depsOk = true;
  for (const dep of requiredDeps) {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      console.log(`✅ ${dep}`);
    } else {
      console.log(`❌ ${dep} - MISSING`);
      depsOk = false;
    }
  }
  
  if (depsOk) {
    console.log('✅ All required dependencies present');
  } else {
    console.log('❌ Some dependencies are missing');
  }
} catch (error) {
  console.log('❌ Cannot read package.json:', error.message);
}

// Summary
console.log('\n📊 Test Summary:');
if (allFilesExist) {
  console.log('✅ All required files are present');
  console.log('🎉 Photo Workflow CLI structure looks good!');
  console.log('\nNext steps:');
  console.log('1. Run: npm install');
  console.log('2. Copy .env.example to .env and add your API keys');
  console.log('3. Test with: ./photo-workflow-cli.js --help');
  console.log('4. Try a dry run: ./photo-workflow-cli.js convert --input /path/to/test/images --dry-run');
} else {
  console.log('❌ Some required files are missing');
  console.log('Please ensure all files are created properly');
}

console.log('\n🔗 For detailed usage instructions, see README.md');