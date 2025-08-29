# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a professional photo workflow CLI tool that automates the complete pipeline from RAW conversion to final delivery. It processes photos through 6 distinct stages using a stage-based orchestration pattern.

## Commands

### Development Commands
```bash
# Install dependencies
npm install

# Run linting
npm run lint
npm run lint:fix

# Run tests
npm test
npm run test:html-reports

# Generate reports from JSON logs
npm run generate-report

# Run the CLI directly
node photo-workflow-cli.js [command] [options]
# or with executable
./photo-workflow-cli.js [command] [options]
```

### Stage Commands
```bash
# Stage 1: Convert RAW to JPEG (requires dcraw installed)
./photo-workflow-cli.js convert --input /path/to/raw --output ./output --force

# Stage 2: AI culling with Gemini (requires GEMINI_API_KEY)
./photo-workflow-cli.js cull --input ./output/convert --output ./output --threshold 0.7 --force

# Stage 3: Group photos by time/similarity
./photo-workflow-cli.js group --input ./output/cull --output ./output --time-threshold 15 --force

# Stage 4-6: Imagen upload/download and finalize
./photo-workflow-cli.js imagen-upload --input ./output/group --output ./output
./photo-workflow-cli.js imagen-download --input ./output/imagen-upload --output ./output
./photo-workflow-cli.js finalize --input ./output/imagen-download --output ./output

# Run complete pipeline
./photo-workflow-cli.js run-all --input /path/to/raw --output ./output --verbose
```

## Architecture

### Core Flow Pattern
```
Input RAW Files → Stage Orchestrator → Stage Processors → Output/Next Stage
                        ↓
                  Audit Logger → JSON Logs
```

### Stage Dependencies
1. **Convert Stage** (convertStage.js): Requires `dcraw` binary, outputs to `output/convert/`
2. **Cull Stage** (cullStage.js): Requires Gemini API key, reads from `output/convert/`, outputs to `output/cull/`
3. **Group Stage** (groupStage.js): Reads from `output/cull/`, outputs to `output/group/`
4. **Imagen Upload/Download**: Stages 4-5 for enhancement (not fully implemented in POC)
5. **Finalize Stage**: Stage 6 for delivery preparation

### Key Components

#### StageOrchestrator (`lib/stageOrchestrator.js`)
- Manages stage execution flow and dependencies
- Handles input/output path resolution
- Creates stage directories: `output/{stage-name}/`
- Tracks completion with `.stage_completed` markers
- Important: Line 87 sets `stageOutput = path.join(this.outputDir, stageName)`

#### AuditLogger (`lib/auditLogger.js`)
- Comprehensive JSON logging system
- Creates logs in `output/logs/{stage}.json`
- Tracks decisions, errors, fallbacks, and performance
- Each stage gets: `{stage}.json`, `{stage}-summary.json`, `{stage}-errors.json`

#### Stage Processors
Each stage follows this pattern:
1. Implements `execute(options)` method
2. Receives `inputPath`, `outputPath`, `auditLogger` from orchestrator
3. Returns `{ filesProcessed, success, duration }`
4. Writes stage-specific reports (e.g., `conversion_report.json`, `culling_report.json`)

### Critical Implementation Details

#### Metadata Preservation (Stage 1)
- Uses `MetadataPreserver` class with priority timestamp fields
- Extracts via `exifr` before conversion
- Primary timestamp priority: DateTimeOriginal > CreateDate > DateTime
- Fallback to file stats if no EXIF

#### RAW Conversion (Stage 1)
- Uses `dcraw` for RAW → PPM → JPEG conversion
- Two methods: embedded JPEG extraction (fast) or full conversion (quality)
- Only supports JPEG output (not PNG/TIFF)
- Supported formats: `.arw`, `.cr2`, `.nef`, `.orf`, `.dng`, `.raw`, `.raf`

#### Gemini Integration (Stage 2)
- API endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`
- Sends base64-encoded images with custom prompts from `prompts/gemini-culling.txt`
- Batch size: 5 images per API call
- Rating threshold: 0.7 (configurable)
- No fallback modes - requires API key to function

## Environment Configuration

Required `.env` file:
```bash
# Required for Stage 2 (Cull)
GEMINI_API_KEY=your_key_here

# Optional for Stages 4-5
IMAGEN_API_KEY=your_key_here

# Development flags
NODE_ENV=development
VERBOSE_LOGGING=true
```

## Test Data Location
- Sample RAW files: `/Users/sameerrijhsinghani/Library/Mobile Documents/com~apple~CloudDocs/test-small/`
- Contains 6 Sony ARW files (RPV00154.ARW through RPV00251.ARW)

## Common Issues and Solutions

### Path Nesting Issue
The orchestrator expects `outputDir` to be the root output directory (e.g., `./output`), not stage-specific paths. Always pass `--output ./output` to CLI commands.

### Stage Already Completed
Use `--force` flag to rerun a completed stage, or delete the `.stage_completed` file in the stage directory.

### No dcraw Installed
Install with: `brew install dcraw` (macOS) or appropriate package manager.

### Gemini API Errors
- Ensure `GEMINI_API_KEY` is set in `.env`
- Check API quota at Google AI Studio
- Default timeout is 30 seconds

## Output Structure
```
output/
├── convert/          # Stage 1: JPEG files
├── cull/            # Stage 2: Selected photos
├── group/           # Stage 3: Grouped directories
├── imagen-upload/   # Stage 4: Upload tracking
├── imagen-download/ # Stage 5: Enhanced photos
├── finalize/        # Stage 6: Final deliverables
└── logs/           # JSON logs for all stages
```

## Recent Changes (Stage 2)
- Removed mock and basic fallback modes - Gemini API is now required
- Updated to JPEG-only support (removed PNG/TIFF)
- Added threshold validation (0-1 range)
- Fixed output path nesting issue