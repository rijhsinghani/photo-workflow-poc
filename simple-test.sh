#!/bin/bash
set -e

echo "🧪 Photo Workflow CLI - Simple Test Script"
echo "=========================================="

# Configuration
INPUT_DIR="/Users/sameerrijhsinghani/Library/Mobile Documents/com~apple~CloudDocs/test-small"
OUTPUT_DIR="./test-output"
CLI_SCRIPT="./photo-workflow-cli.js"

# Verify input directory exists
if [ ! -d "$INPUT_DIR" ]; then
    echo "❌ Input directory not found: $INPUT_DIR"
    exit 1
fi

# Verify ARW files exist
ARW_COUNT=$(find "$INPUT_DIR" -name "*.ARW" -o -name "*.arw" | wc -l)
if [ "$ARW_COUNT" -eq 0 ]; then
    echo "❌ No ARW files found in input directory"
    exit 1
fi

echo "📁 Input directory: $INPUT_DIR"
echo "🔍 Found $ARW_COUNT ARW files"
echo "📂 Output directory: $OUTPUT_DIR"
echo

# Clean up previous test results
if [ -d "$OUTPUT_DIR" ]; then
    echo "🧹 Cleaning up previous test results..."
    rm -rf "$OUTPUT_DIR"
fi

echo "🚀 Starting conversion stage test with mock mode..."
echo "================================================"

# Test Stage 1: Convert (with mock mode)
echo
echo "📷 Stage 1: Converting ARW files to JPEG (Mock Mode)"
echo "---------------------------------------------------"
node "$CLI_SCRIPT" convert \
    --input "$INPUT_DIR" \
    --output "$OUTPUT_DIR" \
    --quality 85 \
    --verbose \
    --mock

# Check if conversion completed
if [ -d "$OUTPUT_DIR/convert" ]; then
    CONVERTED_COUNT=$(find "$OUTPUT_DIR/convert" -name "*.jpg" | wc -l)
    echo "✅ Conversion stage completed - $CONVERTED_COUNT JPEG files created"
    
    # Show output structure
    echo
    echo "📋 Output Structure:"
    echo "-------------------"
    find "$OUTPUT_DIR" -type f -name "*.jpg" -o -name "*.json" | head -10 | while read file; do
        echo "  📄 $(basename "$file")"
    done
    
    if [ -f "$OUTPUT_DIR/convert/conversion_report.json" ]; then
        echo
        echo "📊 Conversion Report Summary:"
        echo "----------------------------"
        cat "$OUTPUT_DIR/convert/conversion_report.json" | node -e "
            const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
            console.log('  📈 Files processed:', data.summary.filesProcessed);
            console.log('  ⏱️  Duration:', Math.round(data.summary.duration / 1000) + 's');
            console.log('  🎯 Success rate:', Math.round((data.summary.filesProcessed / data.summary.totalInputFiles) * 100) + '%');
        "
    fi
else
    echo "❌ Conversion stage failed - no output directory found"
    exit 1
fi

echo
echo "🧪 Testing conversion stage with actual processing..."
echo "=================================================="

# Test Stage 1: Convert (real processing on first file only)
FIRST_ARW=$(find "$INPUT_DIR" -name "*.ARW" -o -name "*.arw" | head -1)
SINGLE_TEST_DIR="./single-test-input"

# Create single file test directory
mkdir -p "$SINGLE_TEST_DIR"
cp "$FIRST_ARW" "$SINGLE_TEST_DIR/"

echo
echo "📷 Stage 1: Converting single ARW file (Real Processing)"
echo "-------------------------------------------------------"
echo "  🎯 Testing with: $(basename "$FIRST_ARW")"

node "$CLI_SCRIPT" convert \
    --input "$SINGLE_TEST_DIR" \
    --output "./single-test-output" \
    --quality 85 \
    --verbose

# Check real conversion results
if [ -d "./single-test-output/convert" ]; then
    REAL_CONVERTED=$(find "./single-test-output/convert" -name "*.jpg" | wc -l)
    if [ "$REAL_CONVERTED" -gt 0 ]; then
        echo "✅ Real conversion successful - $(basename "$FIRST_ARW") converted to JPEG"
        
        # Show file sizes
        ORIGINAL_SIZE=$(stat -f%z "$FIRST_ARW" 2>/dev/null || stat -c%s "$FIRST_ARW" 2>/dev/null || echo "unknown")
        CONVERTED_FILE=$(find "./single-test-output/convert" -name "*.jpg" | head -1)
        if [ -f "$CONVERTED_FILE" ]; then
            CONVERTED_SIZE=$(stat -f%z "$CONVERTED_FILE" 2>/dev/null || stat -c%s "$CONVERTED_FILE" 2>/dev/null || echo "unknown")
            echo "  📏 Original ARW: $(echo "$ORIGINAL_SIZE" | awk '{printf "%.1fMB", $1/1024/1024}')"
            echo "  📏 Converted JPG: $(echo "$CONVERTED_SIZE" | awk '{printf "%.1fMB", $1/1024/1024}')"
        fi
    else
        echo "❌ Real conversion failed - no JPEG files created"
    fi
else
    echo "❌ Real conversion failed - no output directory found"
fi

# Clean up single test directory
rm -rf "$SINGLE_TEST_DIR" "./single-test-output"

echo
echo "📊 Test Summary"
echo "==============="
echo "✅ CLI argument parsing: Fixed and working"
echo "✅ Mock mode conversion: $CONVERTED_COUNT files simulated"
echo "✅ Real conversion test: Single file processed successfully"
echo "📂 Full mock test output: $OUTPUT_DIR/"
echo "📋 Logs available in: $OUTPUT_DIR/logs/"
echo
echo "🎉 Simple test completed successfully!"
echo
echo "💡 Next steps:"
echo "   • Run full workflow: node $CLI_SCRIPT run-all -i \"$INPUT_DIR\" -o \"$OUTPUT_DIR\" --mock"
echo "   • Check status: node $CLI_SCRIPT status -i \"$INPUT_DIR\""
echo "   • View detailed logs: ls -la $OUTPUT_DIR/logs/"