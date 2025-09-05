# Photo Workflow Session Context - Alyssah & Jesse Wedding
**Last Updated:** 2025-09-05
**Purpose:** Resume photo workflow testing in new Claude session

## Quick Start Commands for Next Session

```bash
# 1. Navigate to project
cd "/Users/sameerrijhsinghani/Library/Mobile Documents/com~apple~CloudDocs/photo-workflow-poc"

# 2. Check what we have so far
ls -la alyssah-jesse-output/
ls alyssah-jesse-output/convert/*.jpg | wc -l  # Should show 1,056

# 3. Run Stage 2: AI Culling (NEXT STEP)
./photo-workflow-cli.js cull \
  -i "./alyssah-jesse-output/convert" \
  -o "./alyssah-jesse-output" \
  --threshold 0.65

# 4. Review culled photos in Finder
open alyssah-jesse-output/cull/

# 5. Run Stage 3: Smart Grouping
./photo-workflow-cli.js group \
  -i "./alyssah-jesse-output/cull" \
  -o "./alyssah-jesse-output"

# 6. Review groups
open alyssah-jesse-output/group/
```

## Current Status

### ✅ Completed
- **Stage 1: Convert** - 1,056 ARW files → 1,056 JPEGs at 85% quality
- Files location: `./alyssah-jesse-output/convert/`
- Source: `/Volumes/Photography/2025/Alyssah & Jesse/Digital Negatives/raw1/`

### 🔄 Next Steps
1. **Stage 2: Cull** - Use Gemini AI to reduce ~50% (target ~500-600 keepers)
2. **Stage 3: Group** - Smart technical clustering based on exposure/scene
3. **Note:** Skipping Imagen stages (4-5) to avoid costs
4. **Note:** raw2 folder has 466 more files - not processed yet

## Key Context for AI Assistant

### Project Structure
```
/Users/sameerrijhsinghani/Library/Mobile Documents/com~apple~CloudDocs/photo-workflow-poc/
├── photo-workflow-cli.js          # Main CLI tool
├── stages/                        # Stage processors
│   ├── convertStage.js
│   ├── cullStage.js               # Uses Gemini AI
│   ├── groupStage.js              # Smart clustering
│   └── socialSelectStage.js      # Quick 5-photo selection
├── prompts/
│   └── gemini-culling.txt        # Editable AI prompts
└── alyssah-jesse-output/         # Current work
    ├── convert/                  # 1,056 JPEGs ready
    ├── cull/                     # Empty - next step
    └── logs/                     # Processing logs
```

### Important Requirements

#### Stage 2 (Cull):
- **NO FALLBACK** - Stops if Gemini API fails
- Aggressive duplicate removal
- Remove: blur, closed eyes, similar shots
- Target ~50% reduction but quality > quantity
- Threshold: 0.65 (lower = more selective)

#### Stage 3 (Group):
- **NOT** for client delivery (that comes later)
- For Imagen batch editing efficiency
- Group by:
  1. EXIF exposure (ISO, aperture, shutter)
  2. Scene similarity (via Gemini)
  3. Continuous timestamps (no arbitrary gaps)
- Purpose: Apply one Imagen edit to whole group (saves money)

### Technical Notes
- Gemini API key configured in `.env`
- Don't use `--mock` flag (we want real AI processing)
- All reviews done in Mac Finder (no UI)
- HTML reports only for viewing groups
- Commands work from photo-workflow-poc directory

### What Was Learned
1. Stage 1 successfully preserves metadata (timestamps critical)
2. Directory has uppercase .ARW files (not lowercase)
3. System handles 1,000+ files efficiently
4. Logs stored in JSON format at `./alyssah-jesse-output/logs/`

### For New Session
Tell Claude: "Continue the photo workflow testing for Alyssah & Jesse wedding. We completed Stage 1 (Convert) with 1,056 files. Now run Stage 2 (Cull) with Gemini AI, then Stage 3 (Group). Reference workflow-session-context.md for all details."

## Contact Context
- Using cost-effective Gemini API (not Imagen)
- Validation at each stage before proceeding
- Focus on robust culling and smart grouping
- Final delivery formatting happens later (not these stages)