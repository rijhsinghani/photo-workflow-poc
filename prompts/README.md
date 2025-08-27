# AI Culling Prompt System

The Photo Workflow CLI uses an editable prompt system for AI-powered photo culling. This allows you to customize the evaluation criteria and scoring for different types of photography projects.

## How It Works

1. **Default Prompt**: `gemini-culling.txt` is loaded automatically during culling
2. **Custom Prompts**: Edit the prompt file to change evaluation criteria
3. **Fallback System**: If the prompt file can't be loaded, uses embedded defaults
4. **Real-time Loading**: Changes take effect immediately on next run

## Available Prompt Templates

### `gemini-culling.txt` (Default)
- **General purpose** photo culling
- Balanced criteria: Technical (30%), Composition (25%), Subject (25%), Emotional (20%)
- Good for mixed photography types

### `gemini-portrait-culling.txt`
- **Portrait photography** specialized
- Emphasizes eye sharpness, facial expressions, and subject connection
- Weighted: Technical (35%), Subject (30%), Composition (20%), Emotional (15%)

### `gemini-landscape-culling.txt` 
- **Landscape photography** specialized
- Prioritizes technical perfection and dramatic composition
- Weighted: Technical (40%), Composition (35%), Subject (15%), Emotional (10%)

### `gemini-wedding-culling.txt`
- **Wedding photography** specialized
- Values authentic emotion and story moments
- Weighted: Subject (30%), Emotional (25%), Technical (25%), Composition (20%)

## Using Different Prompts

### Method 1: Replace Default Prompt
```bash
# Copy your preferred template over the default
cp prompts/gemini-portrait-culling.txt prompts/gemini-culling.txt

# Run culling - will use portrait criteria
./photo-workflow-cli.js cull --input ./photos --output ./output
```

### Method 2: Environment Variable (Future Feature)
```bash
# Set custom prompt path
export CUSTOM_CULLING_PROMPT_PATH=prompts/gemini-wedding-culling.txt

# Run with custom prompt
./photo-workflow-cli.js cull --input ./photos --output ./output
```

## Customizing Prompts

### Basic Structure
All prompts should follow this structure:

1. **Role Definition**: "You are a professional photographer..."
2. **Evaluation Criteria**: Weighted categories with descriptions
3. **Scoring Guidelines**: 0.0-1.0 scale with clear thresholds
4. **Context-Specific Notes**: Special considerations for the photo type
5. **JSON Response Format**: Exact format specification

### Key Elements to Customize

#### 1. Weighting Percentages
Adjust the importance of different criteria:
```text
**TECHNICAL QUALITY (40%)** - For technical photography
**EMOTIONAL IMPACT (35%)** - For storytelling focus
**COMPOSITION (25%)** - For artistic emphasis
```

#### 2. Scoring Thresholds
Set appropriate quality bars:
```text
- 0.8+: Keep for final delivery
- 0.7+: Keep as backup options  
- 0.6+: Keep only if unique moment
- <0.6: Cull
```

#### 3. Specific Considerations
Add photography-type specific guidance:
```text
- Portrait: "Prioritize sharp eyes over perfect composition"
- Wedding: "Authentic emotion trumps technical perfection"
- Landscape: "Technical perfection is crucial"
```

### Example Customizations

#### High-Volume Event Photography
- Lower technical standards
- Higher emphasis on moment capture
- More lenient scoring thresholds

#### Fine Art Photography
- Extremely high technical standards
- Strong emphasis on composition and emotional impact
- Strict scoring thresholds

#### Commercial Photography
- Perfect technical execution required
- Strong emphasis on composition and brand alignment
- Consider usage requirements and cropping needs

## Advanced Prompt Engineering

### Multi-Language Support
Prompts can be written in different languages - just ensure the JSON response format remains consistent.

### Conditional Logic
Include instructions for different scenarios:
```text
If the image contains people, prioritize facial expressions.
If the image is a landscape, prioritize technical sharpness.
If the image shows movement, evaluate motion blur appropriateness.
```

### Style-Specific Instructions
Add guidance for specific aesthetic styles:
```text
For dark and moody style: Accept creative underexposure
For bright and airy style: Ensure highlight retention
For documentary style: Prioritize authenticity over perfection
```

## Testing Your Prompts

1. **Dry Run Mode**: Test prompts without making changes
   ```bash
   ./photo-workflow-cli.js cull --dry-run --input ./test-photos
   ```

2. **Single Image Test**: Test with one image first
   ```bash
   # Put one test image in a folder and run culling
   ./photo-workflow-cli.js cull --input ./single-test --threshold 0.5
   ```

3. **Compare Results**: Run same images with different prompts to compare outcomes

## Best Practices

### 1. Start with Templates
- Begin with an existing template closest to your needs
- Make incremental changes and test results
- Document your modifications

### 2. Clear Instructions
- Be specific about what constitutes quality
- Provide examples of good vs. poor criteria
- Use consistent language and terms

### 3. Balanced Criteria
- Ensure percentages add up to 100%
- Don't over-weight any single factor
- Consider your typical shooting conditions

### 4. Appropriate Thresholds
- Set realistic quality bars for your work
- Consider client expectations and delivery standards
- Account for shooting difficulty and conditions

### 5. JSON Format Consistency
- Always include all required fields
- Maintain exact JSON structure
- Test JSON parsing with sample responses

## Troubleshooting

### Common Issues

**Prompt Not Loading**
- Check file path and permissions
- Verify file exists in `prompts/` directory
- Check console output for loading messages

**Low Selection Rates**
- Lower the threshold: `--threshold 0.6`
- Review scoring guidelines in prompt
- Check if criteria are too strict for your images

**Inconsistent Results**
- Add more specific instructions
- Include more examples in prompt
- Consider breaking complex criteria into sub-points

**JSON Parsing Errors**
- Verify JSON format in prompt is exact
- Test prompt with sample AI responses
- Check for special characters or formatting issues

## Contributing Prompts

If you develop prompts for specific photography niches, consider sharing them:

1. Test thoroughly with diverse image sets
2. Document the intended use case and criteria
3. Include example scoring explanations
4. Follow the established template structure

Create a pull request or issue to share your specialized prompts with the community!