# Photo Workflow CLI

A comprehensive command-line tool for professional photo workflow processing. Automates the complete pipeline from RAW conversion through AI-powered culling, smart grouping, Imagen AI enhancement, and final delivery preparation.

## Features

- **Stage 1 - Convert**: RAW to JPEG conversion with **enhanced metadata preservation**
- **Stage 2 - Cull**: AI-powered photo culling using **editable Gemini prompts**
- **Stage 3 - Group**: Smart grouping by time and visual similarity
- **Stage 4 - Imagen Upload**: Upload photos to Imagen AI for enhancement
- **Stage 5 - Imagen Download**: Download enhanced photos from Imagen AI
- **Stage 6 - Finalize**: Apply XMP metadata and create delivery packages

### ✨ Enhanced Features

#### 🛡️ Bulletproof Metadata Preservation
- **Comprehensive EXIF extraction**: Preserves ALL metadata fields, not just basic ones
- **Critical timestamp preservation**: DateTimeOriginal, CreateDate, ModifyDate maintained for accurate grouping
- **Verification system**: Validates metadata integrity after conversion
- **Intelligent fallbacks**: Uses file modification times when EXIF timestamps unavailable
- **Audit logging**: Tracks metadata preservation success/failure for each file

#### 🎯 Editable AI Culling System
- **Custom prompt files**: Edit `prompts/gemini-culling.txt` for different culling strategies  
- **Enhanced evaluation criteria**: Technical (30%), Composition (25%), Subject (25%), Emotional (20%)
- **Flexible scoring system**: Adjust thresholds for different project needs
- **Detailed reasoning**: AI provides specific feedback on why photos were selected/culled
- **Strategy templates**: Easy to create specialized prompts for different photo types

#### ⚙️ Comprehensive Configuration
- **Environment-based setup**: Complete `.env.example` with 40+ configuration options
- **Development mode**: Mock AI responses for testing without API costs
- **Performance tuning**: Adjustable batch sizes, timeouts, and retry logic
- **Safety features**: Backup creation, dry-run mode, strict validation options

## Installation

```bash
# Clone or download this repository
cd photo-workflow-poc

# Install dependencies
npm install

# Copy environment template and configure API keys
cp .env.example .env
# Edit .env with your API keys

# Make CLI executable (Unix/Mac)
chmod +x photo-workflow-cli.js
```

## Configuration

Create a `.env` file with your API keys:

```bash
# Required for AI culling
GEMINI_API_KEY=your_gemini_api_key_here

# Required for image enhancement
IMAGEN_API_KEY=your_imagen_api_key_here
IMAGEN_API_URL=https://api.imagen-ai.com/v1
```

## Usage

### Run Individual Stages

```bash
# Stage 1: Convert RAW files to JPEG
./photo-workflow-cli.js convert --input /path/to/raw/files --output ./output

# Stage 2: AI-powered culling
./photo-workflow-cli.js cull --input ./output/convert --output ./output --threshold 0.7

# Stage 3: Smart grouping
./photo-workflow-cli.js group --input ./output/cull --output ./output --time-threshold 15

# Stage 4: Upload to Imagen AI
./photo-workflow-cli.js imagen-upload --input ./output/group --output ./output

# Stage 5: Download enhanced images
./photo-workflow-cli.js imagen-download --input ./output/imagen-upload --output ./output

# Stage 6: Finalize and create delivery packages
./photo-workflow-cli.js finalize --input ./output/imagen-download --output ./output
```

### Run Complete Workflow

```bash
# Run all stages automatically
./photo-workflow-cli.js run-all --input /path/to/raw/files --output ./final-output

# With custom options
./photo-workflow-cli.js run-all \
  --input /path/to/raw/files \
  --output ./final-output \
  --verbose \
  --force
```

### Check Status

```bash
# View processing status and logs
./photo-workflow-cli.js status --input ./output
```

## Stage Details

### Stage 1: Convert
- Converts RAW files (ARW, CR2, NEF, etc.) to high-quality JPEG
- **Enhanced metadata preservation** with comprehensive EXIF extraction
- **Timestamp verification** ensures accurate photo grouping
- Configurable quality and resize options
- Handles multiple camera formats
- **Bulletproof fallback** mechanisms for metadata preservation

**Options:**
- `--quality <number>`: JPEG quality 1-100 (default: 90)
- `--resize <size>`: Resize images (e.g., "2048x1536")

**Metadata Features:**
- Preserves ALL EXIF fields including camera settings, GPS data, lens information
- Priority system for timestamp fields (DateTimeOriginal > CreateDate > DateTime)
- Verification after conversion ensures timestamp integrity
- Fallback to file modification times when EXIF unavailable
- Detailed audit logging of metadata preservation success/failure

### Stage 2: Cull
- **AI-powered photo rating** using Gemini Vision API with **editable prompts**
- **Enhanced evaluation criteria**: Technical (30%), Composition (25%), Subject (25%), Emotional (20%)
- Automatically selects best images based on threshold
- **Customizable culling strategies** via prompt editing
- Falls back to basic filtering if API unavailable

**Options:**
- `--threshold <number>`: Rating threshold 0-1 (default: 0.7)

**Editable Prompt System:**
- **Custom prompts**: Edit `prompts/gemini-culling.txt` to customize AI evaluation
- **Weighted criteria**: Adjust importance of technical vs. artistic factors
- **Context-specific**: Create prompts for weddings, portraits, landscapes, etc.
- **Detailed feedback**: AI provides specific reasoning for each decision
- **Fallback system**: Uses embedded default prompt if custom file unavailable

### Stage 3: Group
- Groups photos by time proximity and visual similarity
- Creates logical collections for client delivery
- Handles large shoots by splitting oversized groups
- Generates comprehensive metadata for each group

**Options:**
- `--time-threshold <minutes>`: Time gap threshold (default: 15)

### Stage 4: Imagen Upload
- Uploads photos to Imagen AI for enhancement
- Processes in configurable batches
- Tracks upload status for reliable download
- Mock mode for testing without API

### Stage 5: Imagen Download
- Monitors enhancement progress
- Downloads completed enhanced images
- Handles retry logic and error recovery
- Creates enhanced/original file mappings

### Stage 6: Finalize
- Creates multiple output formats (high-res, web, thumbnails)
- Generates XMP sidecar files with metadata
- Organizes final delivery structure
- Creates client-ready packages with documentation

## Output Structure

```
output/
├── convert/                    # Stage 1 output
├── cull/                      # Stage 2 output
├── group/                     # Stage 3 output
│   ├── Group_01_2024-01-15_10-30/
│   ├── Group_02_2024-01-15_14-45/
│   └── ...
├── imagen-upload/             # Stage 4 output
├── imagen-download/           # Stage 5 output
├── high-resolution/           # Stage 6 output
├── web-optimized/
├── thumbnails/
├── metadata/
├── delivery-packages/
└── logs/                      # Detailed JSON logs
    ├── convert.json
    ├── cull.json
    ├── group.json
    ├── imagen-upload.json
    ├── imagen-download.json
    └── finalize.json
```

## Logging and Auditing

The CLI includes comprehensive audit logging:

- **JSON-structured logs** for each stage
- **Decision tracking** with reasoning
- **Error handling** with fallback strategies
- **Performance metrics** and timing
- **Processing summaries** and reports

All logs are saved in the `output/logs/` directory with detailed information for debugging and analysis.

## Command Reference

### Global Options

- `-i, --input <path>`: Input directory path (required)
- `-o, --output <path>`: Output directory path (defaults to ./output)
- `--verbose`: Enable verbose logging
- `--dry-run`: Simulate operations without making changes
- `--force`: Force processing even if stage already completed

### Stage-Specific Commands

All stage commands support the global options plus stage-specific options listed above.

### Examples

```bash
# Process wedding photos with custom settings
./photo-workflow-cli.js run-all \
  --input ./wedding-raw-photos \
  --output ./wedding-final \
  --verbose

# Convert only with custom quality
./photo-workflow-cli.js convert \
  --input ./raw-photos \
  --output ./converted \
  --quality 95 \
  --resize 3000x2000

# Cull with strict threshold
./photo-workflow-cli.js cull \
  --input ./converted \
  --output ./culled \
  --threshold 0.8

# Check processing status
./photo-workflow-cli.js status --input ./wedding-final
```

## API Requirements

### Gemini AI (for culling)
- Get API key from: https://makersuite.google.com/app/apikey
- Used for intelligent photo rating and selection
- Falls back to basic filtering if unavailable

### Imagen AI (for enhancement)
- Get API key from: https://imagen-ai.com/api
- Used for professional photo enhancement
- Mock mode available for testing

## Troubleshooting

### Common Issues

1. **"No RAW files found"**
   - Check input directory path
   - Ensure supported formats (.arw, .cr2, .nef, etc.)

2. **"API key required"**
   - Check .env file configuration
   - Verify API keys are valid

3. **"Stage already completed"**
   - Use `--force` flag to reprocess
   - Or delete output directory to start fresh

4. **Memory issues with large files**
   - Process smaller batches
   - Ensure sufficient disk space

### Debug Mode

```bash
# Enable verbose logging for detailed output
./photo-workflow-cli.js run-all --input ./photos --verbose

# Check logs directory for detailed JSON logs
cat ./output/logs/convert.json | jq .
```

## Support

For issues or feature requests, check the detailed JSON logs in the `output/logs/` directory which contain comprehensive information about processing decisions, errors, and performance metrics.

## License

MIT License - see LICENSE file for details.