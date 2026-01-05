# Vision Model Hallucination Prevention: Comprehensive Research & Implementation Guide

**Date**: 2026-01-03 **Context**: Desktop file organization app using local Ollama models **Target
Models**: llava, llama3.2-vision, minicpm-v, moondream, qwen2.5-vl

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Understanding Hallucinations in Vision Models](#understanding-hallucinations-in-vision-models)
3. [Prompt Engineering Techniques](#prompt-engineering-techniques)
4. [Structured Output Validation](#structured-output-validation)
5. [Grounding Techniques](#grounding-techniques)
6. [Confidence Scoring & Thresholds](#confidence-scoring--thresholds)
7. [Multi-Pass Verification](#multi-pass-verification)
8. [Chain-of-Thought Reasoning](#chain-of-thought-reasoning)
9. [Teaching Models to Say "I Don't Know"](#teaching-models-to-say-i-dont-know)
10. [Model-Specific Optimizations](#model-specific-optimizations)
11. [Implementation Recommendations](#implementation-recommendations)
12. [Benchmarking & Evaluation](#benchmarking--evaluation)

---

## Executive Summary

### Key Findings

After extensive research, the most effective strategies for reducing hallucinations in local vision
models combine multiple complementary approaches:

1. **Grounding with Known Facts**: Use filename, file metadata, and EXIF data as anchors
2. **Structured JSON Output**: Force schema compliance using Ollama's JSON mode
3. **Conservative Temperature**: Set to 0-0.1 for factual tasks (NOT higher)
4. **Explicit Uncertainty Instructions**: Train models to admit ignorance
5. **Validation & Fact-Checking**: Post-process with bespoke-minicheck
6. **Multi-Pass Verification**: Self-consistency checks across multiple samples

### Critical Misconceptions Debunked

- **MYTH**: "Temperature=0 increases hallucination by removing flexibility"
  - **REALITY**: For factual extraction tasks, low temperature (0-0.1) reduces hallucination by
    favoring high-confidence tokens
- **MYTH**: "Higher temperature helps exploration and reduces hallucination"
  - **REALITY**: Higher temperature increases randomness and hallucination rates for factual tasks

---

## Understanding Hallucinations in Vision Models

### Definition

Hallucination in vision-language models refers to outputs that appear fluent and coherent but are:

- **Factually incorrect** (claiming text exists that doesn't)
- **Logically inconsistent** (contradictory descriptions)
- **Entirely fabricated** (inventing objects, dates, or content)

### Root Causes

#### 1. Prompting-Induced Hallucinations

- **Ill-structured prompts**: Vague or ambiguous instructions
- **Overly complex prompts**: Too many instructions confuse the model
- **Lack of constraints**: No explicit boundaries on what the model can say

#### 2. Model-Internal Hallucinations

- **Training data biases**: Models memorize patterns that don't apply
- **Overconfidence**: Models assign high probability to incorrect answers
- **Visual grounding failures**: Disconnection between image features and text

#### 3. Context-Specific Issues

- **Snowballing errors**: Mistakes in early tokens propagate through the response
- **Position bias**: Hallucinations more frequent in middle/latter parts of responses
- **Length-coverage tradeoff**: Longer responses tend to increase both coverage AND hallucinations

### Benchmarks for Evaluation

- **AMBER**: LLM-free multi-dimensional benchmark for existence, attribute, and relation
  hallucination
  - Metrics: CHAIR (object hallucination), Cover (object coverage), Hal (hallucination rate), Cog
    (cognitive metrics)
- **Object-Hal**: Focused on object hallucination detection
- **HallusionBench**: Broader hallucination types with granular assessment

---

## Prompt Engineering Techniques

### 1. Grounding with Known Facts

**Strategy**: Anchor the model's response using factual information you already know.

```javascript
// CURRENT IMPLEMENTATION (ollamaImageAnalysis.js:82-104)
const prompt = `You are an expert image analyzer for an automated file organization system.
Analyze this image named "${originalFileName}" and extract structured information.

Your response should be a JSON object with the following fields:
- date (if there's a visible date in the image, in YYYY-MM-DD format)
- project (a short, 2-5 word project name or main subject based on image content)
- purpose (a concise, 5-10 word description of what this image shows or represents)
- category (most appropriate category for organizing this file; must be one of the folder names above)
- keywords (an array of 3-7 relevant keywords describing the image content)
- confidence (a number from 60-100 indicating analysis confidence)
- content_type (e.g., 'people', 'landscape', 'text_document', 'interface', 'object', 'animal', 'food', 'vehicle', 'architecture')
- has_text (boolean indicating if there's readable text in the image)
- colors (array of 2-4 dominant colors in the image)
- suggestedName (SHORT descriptive name, MAX 40 chars, 2-5 key words only)

If you cannot determine a field, omit it from the JSON. Do not make up information.`;
```

**IMPROVEMENTS NEEDED**:

```javascript
// ENHANCED VERSION WITH STRONGER GROUNDING
const prompt = `TASK: Analyze image file for automated organization system
FILENAME: "${originalFileName}"
FILE SIZE: ${fileSizeKB} KB
FILE DATE: ${fileDate}
EXIF DATE: ${exifDate || 'none'}

CRITICAL INSTRUCTIONS:
1. Only describe what you ACTUALLY SEE in the image
2. If you cannot determine a field with high confidence, OMIT it - do not guess
3. Use the filename as a hint, but verify against image content
4. If the image is unclear, blurry, or ambiguous, set confidence < 70
5. For dates: ONLY extract if clearly visible text in image (NOT metadata dates)

OUTPUT SCHEMA (strict JSON):
{
  "project": "2-5 words describing main subject (REQUIRED)",
  "purpose": "5-10 word description of content (REQUIRED)",
  "category": "MUST be one of: ${validCategories.join(', ')}",
  "keywords": ["3-7 relevant terms"],
  "confidence": 60-100,
  "content_type": "one of: people|landscape|text_document|interface|object|animal|food|vehicle|architecture",
  "has_text": true|false,
  "colors": ["2-4 dominant colors"],
  "date": "YYYY-MM-DD ONLY if clearly visible in image",
  "suggestedName": "max 40 chars, 2-5 keywords only"
}

GROUNDING CONSTRAINTS:
- Category MUST match one of the provided folders
- If image quality prevents confident analysis, say so in confidence score
- Do NOT invent dates, people, or text that isn't visible
- Use filename context only as a hint, not ground truth`;
```

### 2. Negative Prompting

**Strategy**: Explicitly tell the model what NOT to do.

```javascript
const negativeInstructions = `
STRICTLY FORBIDDEN:
- Do NOT include information not present in the image
- Do NOT invent dates, times, or locations
- Do NOT make up text that isn't clearly readable
- Do NOT guess at technical specifications you cannot see
- Do NOT add creative embellishments or assumptions
- Do NOT use the filename as definitive truth about content

If uncertain about ANY field, either omit it or reduce confidence score.`;
```

### 3. Few-Shot Examples

**Strategy**: Show the model examples of correct behavior.

```javascript
const fewShotExamples = `
EXAMPLE 1 - Clear Image:
Input: screenshot_settings_panel.png
Output: {"project": "Settings UI", "purpose": "Application settings interface screenshot", "confidence": 95, "has_text": true, "content_type": "interface"}

EXAMPLE 2 - Unclear Image:
Input: IMG_20240301_blur.jpg
Output: {"project": "Blurry Photo", "purpose": "Image too blurry for detailed analysis", "confidence": 65, "content_type": "unknown"}

EXAMPLE 3 - Filename Mismatch:
Input: contract.jpg (but image shows a sunset)
Output: {"project": "Sunset Landscape", "purpose": "Natural sunset scenery photograph", "confidence": 90, "content_type": "landscape", "keywords": ["sunset", "nature", "sky"]}
NOTE: Filename suggested "contract" but image clearly shows sunset - trust visual content over filename.`;
```

### 4. Prompt Length Optimization

**Research Finding**: Larger models benefit from longer prompts, but excessive instructions can
increase hallucination rates.

**Guidelines**:

- **For 7B models** (llava, minicpm-v): Keep prompts under 500 tokens
- **For 11B+ models** (llama3.2-vision-11B): Can handle up to 1000 tokens
- **For specialized tasks**: Be concise and direct

**Current Status**: Our prompts are ~300-400 tokens (good range)

### 5. Active Voice & Direct Commands

```javascript
// WEAK: Passive, vague
'An analysis should be provided with details...';

// STRONG: Active, direct
'Analyze this image. Extract the main subject. List visible colors.';
```

---

## Structured Output Validation

### Ollama JSON Mode (Built-in Grammar Enforcement)

**Current Implementation**: Using `format: 'json'` parameter

```javascript
// ollamaImageAnalysis.js:165
const response = await generateWithRetry(client, {
  model: modelToUse,
  prompt,
  images: [imageBase64],
  options: {
    temperature: AppConfig.ai.imageAnalysis.temperature,
    num_predict: AppConfig.ai.imageAnalysis.maxTokens,
    ...perfOptions
  },
  format: 'json', // Forces valid JSON output
  signal: abortController.signal
});
```

**How It Works**:

- Ollama uses **GBNF grammars** (llama.cpp feature) to constrain token generation
- Model can ONLY produce tokens that form valid JSON
- Eliminates malformed JSON errors

**ENHANCEMENT: JSON Schema Mode** (Available since Ollama v0.5)

```javascript
// Define schema with Pydantic-like structure
const analysisSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', minLength: 5, maxLength: 50 },
    purpose: { type: 'string', minLength: 10, maxLength: 100 },
    category: { type: 'string', enum: validCategories },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 7
    },
    confidence: { type: 'integer', minimum: 60, maximum: 100 },
    content_type: {
      type: 'string',
      enum: [
        'people',
        'landscape',
        'text_document',
        'interface',
        'object',
        'animal',
        'food',
        'vehicle',
        'architecture'
      ]
    },
    has_text: { type: 'boolean' },
    colors: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 4
    },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    suggestedName: { type: 'string', maxLength: 40 }
  },
  required: ['project', 'purpose', 'confidence']
};

const response = await generateWithRetry(client, {
  model: modelToUse,
  prompt,
  images: [imageBase64],
  options: { temperature: 0.1 },
  format: analysisSchema, // Pass schema directly (Ollama v0.5+)
  signal: abortController.signal
});
```

**Benefits**:

- Guarantees schema compliance (enum, min/max, required fields)
- Reduces hallucination by constraining valid outputs
- Eliminates validation errors

### Post-Processing Validation

**Current Implementation**: `extractAndParseJSON()` with json_repair

```javascript
// ollamaImageAnalysis.js:194
const parsedJson = extractAndParseJSON(response.response, null);

if (!parsedJson || typeof parsedJson !== 'object') {
  throw new Error('Failed to parse image analysis JSON from Ollama');
}
```

**ENHANCEMENT: Pydantic-Style Validation**

```javascript
class ImageAnalysisResult {
  constructor(data) {
    this.validate(data);
    Object.assign(this, data);
  }

  validate(data) {
    const errors = [];

    // Required fields
    if (!data.project || data.project.length < 2) {
      errors.push('project must be at least 2 characters');
    }

    // Confidence bounds
    if (data.confidence < 60 || data.confidence > 100) {
      errors.push('confidence must be between 60-100');
    }

    // Category must match smart folders
    if (data.category && !validCategories.includes(data.category)) {
      errors.push(`category "${data.category}" not in valid set: ${validCategories.join(', ')}`);
    }

    // Keywords array validation
    if (data.keywords && (!Array.isArray(data.keywords) || data.keywords.length < 3)) {
      errors.push('keywords must be array with at least 3 items');
    }

    // Date format validation
    if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      errors.push('date must be in YYYY-MM-DD format');
    }

    if (errors.length > 0) {
      throw new ValidationError('Analysis validation failed', errors);
    }
  }
}

// Usage with retry on validation failure
const parsedJson = extractAndParseJSON(response.response);
try {
  const validated = new ImageAnalysisResult(parsedJson);
  return validated;
} catch (validationError) {
  logger.warn('Validation failed, requesting regeneration', validationError);
  // Optionally: retry with error feedback to model
  return retryWithFeedback(validationError.errors);
}
```

### Iterative Feedback Loop

```javascript
async function analyzeWithValidation(imageBase64, fileName, maxRetries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const prompt = buildPrompt(fileName, lastError);
      const response = await generateWithRetry(client, { prompt, images: [imageBase64] });
      const parsed = extractAndParseJSON(response.response);

      // Validate
      const validated = new ImageAnalysisResult(parsed);
      return validated; // Success!
    } catch (error) {
      if (error instanceof ValidationError) {
        lastError = error;
        logger.warn(`Validation failed (attempt ${attempt + 1}/${maxRetries}):`, error.errors);
        // Loop will retry with error context
      } else {
        throw error; // Non-validation errors propagate immediately
      }
    }
  }

  throw new Error(`Validation failed after ${maxRetries} attempts: ${lastError.errors.join(', ')}`);
}

function buildPrompt(fileName, validationError = null) {
  let prompt = basePrompt;

  if (validationError) {
    prompt += `\n\nPREVIOUS ATTEMPT HAD ERRORS - FIX THESE:\n${validationError.errors.map((e) => `- ${e}`).join('\n')}`;
  }

  return prompt;
}
```

---

## Grounding Techniques

### 1. Filename Context Injection

**Current Implementation**: Filename is included in prompt

```javascript
const prompt = `Analyze this image named "${originalFileName}"...`;
```

**ENHANCEMENT: Structured Metadata Injection**

```javascript
const metadataContext = {
  filename: originalFileName,
  extension: path.extname(originalFileName),
  size_kb: Math.round(fileStats.size / 1024),
  created: fileStats.birthtime.toISOString(),
  modified: fileStats.mtime.toISOString(),
  exif_date: exifDate || null,
  parent_folder: path.basename(path.dirname(filePath))
};

const prompt = `METADATA CONTEXT (use as hints, NOT ground truth):
Filename: ${metadataContext.filename}
File Type: ${metadataContext.extension}
Size: ${metadataContext.size_kb} KB
Created: ${metadataContext.created}
Modified: ${metadataContext.modified}
EXIF Date: ${metadataContext.exif_date || 'none'}
Folder: ${metadataContext.parent_folder}

IMPORTANT: This metadata provides CONTEXT but verify against actual image content.
If filename says "contract.pdf" but image shows a sunset, describe the sunset.

Now analyze the image...`;
```

### 2. EXIF Data as Ground Truth

**Current Implementation**: EXIF date extracted but only as fallback

```javascript
// ollamaImageAnalysis.js:663-665
if (exifDate) {
  analysis.date = exifDate; // Override LLM date with EXIF
}
```

**ENHANCEMENT: Full EXIF Grounding**

```javascript
const exifData = await extractFullExifData(imageBuffer);

const groundingFacts = {
  camera: exifData.Make && exifData.Model ? `${exifData.Make} ${exifData.Model}` : null,
  datetime: exifDate,
  gps: exifData.GPSLatitude ? extractGPS(exifData) : null,
  orientation: exifData.Orientation,
  dimensions: `${meta.width}x${meta.height}`,
  software: exifData.Software
};

const prompt = `KNOWN FACTS FROM IMAGE METADATA (100% accurate):
${groundingFacts.datetime ? `- Photo taken: ${groundingFacts.datetime}` : ''}
${groundingFacts.camera ? `- Camera: ${groundingFacts.camera}` : ''}
${groundingFacts.dimensions ? `- Size: ${groundingFacts.dimensions}` : ''}
${groundingFacts.gps ? `- Location: ${groundingFacts.gps}` : ''}

These facts are DEFINITIVE. Use them to anchor your analysis.
Do NOT contradict these facts. If you see conflicting information in the image,
note the discrepancy in your confidence score.

Now describe what you see...`;
```

### 3. RAG (Retrieval-Augmented Generation) for File Organization

**Strategy**: Use ChromaDB embeddings to retrieve similar files and use them as context.

```javascript
async function analyzeImageWithRAG(imageBase64, fileName, filePath) {
  // 1. Generate embedding from image summary (quick first-pass)
  const quickSummary = await generateQuickSummary(imageBase64, fileName);
  const { vector } = await folderMatcher.embedText(quickSummary);

  // 2. Retrieve similar files from ChromaDB
  const similarFiles = await chromaDb.querySimilar(vector, { limit: 5, threshold: 0.7 });

  // 3. Build context from similar files
  const exampleContext = similarFiles.map((f) => ({
    filename: f.metadata.name,
    category: f.metadata.category,
    keywords: f.metadata.keywords
  }));

  // 4. Use examples to ground the analysis
  const prompt = `SIMILAR FILES IN YOUR SYSTEM (for reference):
${exampleContext.map((ex, i) => `${i + 1}. "${ex.filename}" → Category: ${ex.category}, Keywords: ${ex.keywords.join(', ')}`).join('\n')}

These show how similar files have been categorized. Use this as guidance,
but analyze the NEW image independently based on its actual content.

Now analyze: "${fileName}"...`;

  const response = await analyzeImageWithOllama(imageBase64, prompt, smartFolders);
  return response;
}
```

### 4. Contrastive Region Guidance (Advanced)

**Research Source**: [Contrastive Region Guidance](https://contrastive-region-guidance.github.io/)

**Concept**: Guide VLMs to focus on specific regions by blacking out unimportant areas.

```javascript
// Advanced technique: requires image manipulation
async function analyzeWithRegionFocus(imagePath, focusRegion = null) {
  const imageBuffer = await fs.readFile(imagePath);

  if (focusRegion) {
    // Black out everything EXCEPT the focus region
    const maskedImage = await sharp(imageBuffer)
      .composite([
        {
          input: Buffer.from([0, 0, 0, 255]), // Black
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: 'dest-over'
        }
      ])
      .extract(focusRegion) // Only keep focus region
      .toBuffer();

    const base64 = maskedImage.toString('base64');
    return analyzeImageWithOllama(base64, fileName, smartFolders);
  }

  return analyzeImageWithOllama(imageBuffer.toString('base64'), fileName, smartFolders);
}
```

---

## Confidence Scoring & Thresholds

### Understanding Confidence Scores

**Current Implementation**: Model outputs confidence, default to 75 if invalid

```javascript
// ollamaImageAnalysis.js:220-223
if (!parsedJson.confidence || parsedJson.confidence < 60 || parsedJson.confidence > 100) {
  parsedJson.confidence = 75; // Fixed default
}
```

### How Models Calculate Confidence

Vision models typically calculate confidence from:

- **Softmax probabilities** of output tokens
- **Attention weights** on image regions
- **Semantic alignment** between image and text

**Problem**: Models are often overconfident (GPT-4 assigns 10/10 to 87% of responses, including
wrong ones)

### Calibrated Confidence Scoring

**Strategy**: Post-process model confidence with calibration.

```javascript
function calibrateConfidence(rawConfidence, analysis, imageMetadata) {
  let adjusted = rawConfidence;

  // Penalize for lack of grounding
  if (!analysis.has_text && analysis.content_type === 'text_document') {
    adjusted -= 20; // Contradiction: labeled as text doc but no text detected
  }

  // Penalize for generic responses
  const genericTerms = ['image', 'photo', 'picture', 'file', 'document'];
  const genericCount = analysis.keywords.filter((k) =>
    genericTerms.includes(k.toLowerCase())
  ).length;
  if (genericCount > 2) {
    adjusted -= 10; // Too generic, likely low-confidence
  }

  // Boost for strong grounding
  if (imageMetadata.exifDate && analysis.date === imageMetadata.exifDate) {
    adjusted += 5; // Date matches EXIF, good grounding
  }

  // Boost for specificity
  if (analysis.keywords.length >= 5 && analysis.purpose.length > 30) {
    adjusted += 5; // Detailed analysis suggests confidence
  }

  return Math.max(60, Math.min(100, adjusted));
}
```

### Confidence Thresholds for Actions

```javascript
const CONFIDENCE_THRESHOLDS = {
  AUTO_ORGANIZE: 85, // Auto-move files without user review
  SUGGEST_WITH_CONFIDENCE: 75, // Show suggestion as "recommended"
  SUGGEST_WITH_CAUTION: 65, // Show suggestion with warning icon
  FALLBACK_TO_MANUAL: 60 // Below this, don't auto-suggest
};

function shouldAutoOrganize(analysis) {
  return (
    analysis.confidence >= CONFIDENCE_THRESHOLDS.AUTO_ORGANIZE &&
    analysis.category &&
    !analysis.error
  );
}
```

### Precision-Recall Tradeoffs

**Finding Optimal Threshold**:

```javascript
// Plot precision-recall curve across confidence thresholds
async function findOptimalThreshold(validationSet) {
  const thresholds = [60, 65, 70, 75, 80, 85, 90, 95];
  const results = [];

  for (const threshold of thresholds) {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const example of validationSet) {
      const analysis = await analyzeImageFile(example.path);

      if (analysis.confidence >= threshold) {
        // Model made a prediction
        if (analysis.category === example.groundTruth.category) {
          truePositives++;
        } else {
          falsePositives++;
        }
      } else {
        // Model declined to predict (below threshold)
        if (example.groundTruth.category) {
          falseNegatives++; // Missed a valid categorization
        }
      }
    }

    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / (truePositives + falseNegatives);
    const f1 = (2 * (precision * recall)) / (precision + recall);

    results.push({ threshold, precision, recall, f1 });
  }

  // Find threshold with best F1 score
  const optimal = results.reduce((best, curr) => (curr.f1 > best.f1 ? curr : best));
  logger.info('Optimal confidence threshold:', optimal);
  return optimal.threshold;
}
```

---

## Multi-Pass Verification

### 1. Self-Consistency Prompting

**Strategy**: Generate multiple responses and take the majority vote.

```javascript
async function analyzeWithSelfConsistency(imageBase64, fileName, numSamples = 3) {
  const responses = [];

  // Generate multiple independent analyses
  for (let i = 0; i < numSamples; i++) {
    const response = await analyzeImageWithOllama(imageBase64, fileName, smartFolders);
    responses.push(response);
  }

  // Aggregate results by majority vote
  const aggregated = {
    category: majorityVote(responses.map((r) => r.category)),
    content_type: majorityVote(responses.map((r) => r.content_type)),
    has_text: majorityVote(responses.map((r) => r.has_text)),
    keywords: mergeKeywords(responses.map((r) => r.keywords)),
    confidence: Math.round(responses.reduce((sum, r) => sum + r.confidence, 0) / numSamples),
    consistency_score: calculateConsistency(responses)
  };

  return aggregated;
}

function majorityVote(values) {
  const counts = {};
  values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  return Object.entries(counts).reduce((a, b) => (a[1] > b[1] ? a : b))[0];
}

function calculateConsistency(responses) {
  // Measure how similar the responses are (0-100)
  const categoryMatch =
    responses.filter((r) => r.category === responses[0].category).length / responses.length;
  const typeMatch =
    responses.filter((r) => r.content_type === responses[0].content_type).length / responses.length;
  return Math.round(((categoryMatch + typeMatch) / 2) * 100);
}
```

**When to Use**:

- **High-stakes files**: Legal documents, medical records
- **Ambiguous images**: Blurry, low contrast, or unclear content
- **Boundary cases**: Confidence between 65-75

**Cost**: 3x inference time (use sparingly)

### 2. Self-Verification

**Strategy**: Have the model verify its own output.

```javascript
async function analyzeWithSelfVerification(imageBase64, fileName) {
  // Step 1: Initial analysis
  const initialAnalysis = await analyzeImageWithOllama(imageBase64, fileName, smartFolders);

  // Step 2: Ask model to verify its own output
  const verificationPrompt = `You previously analyzed an image and output this JSON:
${JSON.stringify(initialAnalysis, null, 2)}

Now re-examine the SAME image. For each field, verify if your previous answer was accurate.
Output verification results as JSON:
{
  "category_correct": true/false,
  "content_type_correct": true/false,
  "has_text_correct": true/false,
  "keywords_accurate": true/false,
  "confidence_justified": true/false,
  "errors_found": ["list of any errors detected"],
  "revised_confidence": 60-100
}`;

  const verification = await generateWithRetry(client, {
    model: modelToUse,
    prompt: verificationPrompt,
    images: [imageBase64],
    format: 'json'
  });

  const verificationResult = JSON.parse(verification.response);

  // Step 3: Adjust confidence based on verification
  if (verificationResult.errors_found.length > 0) {
    logger.warn('Self-verification found errors:', verificationResult.errors_found);
    initialAnalysis.confidence = Math.min(
      initialAnalysis.confidence,
      verificationResult.revised_confidence
    );
    initialAnalysis.verification_errors = verificationResult.errors_found;
  }

  return initialAnalysis;
}
```

### 3. Bespoke-Minicheck Fact-Checking

**Tool**: [bespoke-minicheck](https://ollama.com/library/bespoke-minicheck) - SOTA 7B fact-checking
model

**How It Works**:

1. Extract claims from vision model output
2. Compare each claim against source image (as text description)
3. Returns "Yes" (supported) or "No" (hallucination)

```javascript
async function factCheckAnalysis(imageBase64, fileName, analysis) {
  const ollama = await getOllama();

  // Generate a text description of the image (ground truth)
  const descriptionPrompt = 'Describe exactly what you see in this image. Be literal and factual.';
  const descriptionResponse = await ollama.generate({
    model: getOllamaVisionModel(),
    prompt: descriptionPrompt,
    images: [imageBase64],
    options: { temperature: 0.1 }
  });
  const groundTruthDescription = descriptionResponse.response;

  // Extract claims from analysis
  const claims = [
    `The image is categorized as: ${analysis.category}`,
    `The content type is: ${analysis.content_type}`,
    `The image ${analysis.has_text ? 'contains' : 'does not contain'} readable text`,
    `The main subject is: ${analysis.project}`,
    `The purpose is: ${analysis.purpose}`
  ];

  // Check each claim
  const verificationResults = [];
  for (const claim of claims) {
    const checkPrompt = `Document: ${groundTruthDescription}\n\nClaim: ${claim}`;

    const result = await ollama.generate({
      model: 'bespoke-minicheck',
      prompt: checkPrompt
    });

    const isSupported = result.response.trim().toLowerCase() === 'yes';
    verificationResults.push({ claim, supported: isSupported });

    if (!isSupported) {
      logger.warn('Hallucination detected:', claim);
    }
  }

  // Calculate hallucination score
  const hallucinationRate =
    verificationResults.filter((r) => !r.supported).length / verificationResults.length;

  // Penalize confidence if hallucinations detected
  if (hallucinationRate > 0.2) {
    // More than 20% hallucination
    analysis.confidence = Math.max(60, analysis.confidence - Math.round(hallucinationRate * 30));
    analysis.hallucination_detected = true;
    analysis.hallucination_rate = hallucinationRate;
  }

  return analysis;
}
```

**Installation**:

```bash
ollama pull bespoke-minicheck
```

### 4. Temporal Consistency

**Strategy**: Multi-pass verification with self-reflection over time.

```javascript
async function analyzeWithTemporalConsistency(imageBase64, fileName) {
  const iterations = 3;
  let currentAnalysis = null;
  let consistencyScores = [];

  for (let i = 0; i < iterations; i++) {
    const prompt =
      i === 0 ? buildInitialPrompt(fileName) : buildReflectionPrompt(fileName, currentAnalysis, i);

    const response = await analyzeImageWithOllama(imageBase64, prompt, smartFolders);

    if (currentAnalysis) {
      const consistency = measureConsistency(currentAnalysis, response);
      consistencyScores.push(consistency);

      // If consistency is low, reduce confidence
      if (consistency < 0.7) {
        logger.warn('Low temporal consistency detected:', consistency);
        response.confidence = Math.min(response.confidence, 70);
      }
    }

    currentAnalysis = response;
  }

  const avgConsistency = consistencyScores.reduce((a, b) => a + b, 0) / consistencyScores.length;
  currentAnalysis.temporal_consistency = avgConsistency;

  return currentAnalysis;
}

function buildReflectionPrompt(fileName, previousAnalysis, iteration) {
  return `You previously analyzed this image and determined:
Category: ${previousAnalysis.category}
Content Type: ${previousAnalysis.content_type}
Keywords: ${previousAnalysis.keywords.join(', ')}

This is iteration ${iteration + 1}. Re-examine the image carefully.
Were your previous assessments correct? Provide an updated analysis.
If you notice any errors in your previous analysis, correct them.`;
}

function measureConsistency(prev, curr) {
  let matches = 0;
  let total = 0;

  if (prev.category === curr.category) matches++;
  total++;

  if (prev.content_type === curr.content_type) matches++;
  total++;

  if (prev.has_text === curr.has_text) matches++;
  total++;

  // Keyword overlap
  const prevKeywords = new Set(prev.keywords);
  const currKeywords = new Set(curr.keywords);
  const intersection = [...prevKeywords].filter((k) => currKeywords.has(k));
  const union = new Set([...prevKeywords, ...currKeywords]);
  const keywordSimilarity = intersection.length / union.size;

  return (matches / total + keywordSimilarity) / 2;
}
```

---

## Chain-of-Thought Reasoning

### Benefits for Hallucination Reduction

**Research Findings**:

- Forces step-by-step reasoning, reducing premature conclusions
- Provides transparency into model's reasoning process
- Can reduce hallucination rates by 10-30% on vision tasks
- BUT: Can also obscure hallucination detection signals (tradeoff)

### Visual Inference Chain (VIC) Framework

**Key Insight**: "Thinking while looking" causes bias. Instead, reason with text FIRST, then
introduce visual input.

**Implementation**:

```javascript
async function analyzeWithVIC(imageBase64, fileName, smartFolders) {
  // STAGE 1: Text-only reasoning (without image)
  const textOnlyPrompt = `A file named "${fileName}" is being analyzed for organization.

Based ONLY on the filename, what would you hypothesize about:
1. File type and content
2. Likely category
3. Expected keywords

Output your reasoning as JSON:
{
  "filename_hypothesis": "what the filename suggests",
  "expected_content": "predicted content type",
  "predicted_category": "most likely category",
  "confidence_in_filename": 0-100,
  "verification_needed": ["what aspects need visual verification"]
}`;

  const textReasoning = await ollama.generate({
    model: getOllamaModel(), // Text-only model
    prompt: textOnlyPrompt,
    format: 'json'
  });

  const hypothesis = JSON.parse(textReasoning.response);

  // STAGE 2: Visual verification (with image)
  const visualVerificationPrompt = `FILENAME HYPOTHESIS (from filename analysis):
${JSON.stringify(hypothesis, null, 2)}

Now examine the ACTUAL IMAGE and verify/refute the hypothesis.

CRITICAL: If the image contradicts the filename, TRUST THE IMAGE.

Output verified analysis:
{
  "filename_accurate": true/false,
  "actual_content": "what the image actually shows",
  "category": "actual category based on image",
  "keywords": ["actual keywords from image"],
  "hypothesis_verification": "how image compares to filename hypothesis"
}`;

  const visualAnalysis = await ollama.generate({
    model: getOllamaVisionModel(),
    prompt: visualVerificationPrompt,
    images: [imageBase64],
    format: 'json'
  });

  const verified = JSON.parse(visualAnalysis.response);

  // STAGE 3: Combine with confidence adjustment
  const finalAnalysis = {
    ...verified,
    confidence: verified.filename_accurate ? 90 : 75,
    reasoning_chain: {
      hypothesis,
      verification: verified
    }
  };

  return finalAnalysis;
}
```

### Chain-of-Verification (CoVe)

**Strategy**: Model generates verification questions and answers them.

```javascript
async function analyzeWithCoVe(imageBase64, fileName) {
  // Step 1: Initial analysis
  const initial = await analyzeImageWithOllama(imageBase64, fileName, smartFolders);

  // Step 2: Generate verification questions
  const verificationPrompt = `You analyzed an image and claimed:
- Category: ${initial.category}
- Content type: ${initial.content_type}
- Has text: ${initial.has_text}
- Keywords: ${initial.keywords.join(', ')}

Generate 3-5 verification questions to check if these claims are accurate.
Output as JSON array: ["Question 1?", "Question 2?", ...]`;

  const questionsResponse = await ollama.generate({
    model: getOllamaModel(),
    prompt: verificationPrompt,
    format: 'json'
  });

  const questions = JSON.parse(questionsResponse.response);

  // Step 3: Answer verification questions while viewing image
  const answers = [];
  for (const question of questions) {
    const answerPrompt = `Look at this image and answer: ${question}`;
    const answerResponse = await ollama.generate({
      model: getOllamaVisionModel(),
      prompt: answerPrompt,
      images: [imageBase64]
    });
    answers.push({ question, answer: answerResponse.response });
  }

  // Step 4: Revise initial analysis based on verification
  const revisionPrompt = `Original analysis:
${JSON.stringify(initial, null, 2)}

Verification Q&A:
${answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}

Based on the verification, revise the original analysis if needed.
Output corrected JSON with same schema as original.`;

  const revised = await ollama.generate({
    model: getOllamaVisionModel(),
    prompt: revisionPrompt,
    images: [imageBase64],
    format: 'json'
  });

  return JSON.parse(revised.response);
}
```

---

## Teaching Models to Say "I Don't Know"

### The Problem

**Research Finding**: Models struggle to admit knowledge gaps, assigning high confidence even to
fabricated answers.

### Solution: Uncertainty-Aware Training & Prompting

**Prompt Engineering Approach**:

```javascript
const uncertaintyAwarePrompt = `You are an expert image analyzer. Your reputation depends on ACCURACY, not completeness.

UNCERTAINTY GUIDELINES:
- If you cannot determine a field with >70% confidence, OMIT it entirely
- It is BETTER to return fewer fields than to guess
- Use these phrases when uncertain:
  * "unclear" (not confident enough to determine)
  * "unknown" (information not visible in image)
  * "ambiguous" (multiple interpretations possible)

REQUIRED HONESTY:
- If image is blurry: Set confidence < 70 and note in purpose field
- If text is unreadable: Set has_text = false (don't guess content)
- If category unclear: Omit category field or use "uncategorized"
- If colors are indistinct: Return fewer colors or omit field

SCORING YOUR CONFIDENCE:
- 95-100: Absolutely certain (crisp image, clear content)
- 85-94: Very confident (minor ambiguity)
- 75-84: Confident (some interpretation needed)
- 65-74: Uncertain (significant ambiguity, should omit some fields)
- 60-64: Very uncertain (minimal information extractable)

Remember: An incomplete but accurate analysis is MUCH better than a complete but hallucinated one.

Now analyze this image named "${fileName}":`;
```

### Explicit "Unknown" Values

```javascript
// Allow "unknown" as valid value
const analysisSchema = {
  type: 'object',
  properties: {
    content_type: {
      type: 'string',
      enum: [
        'people',
        'landscape',
        'text_document',
        'interface',
        'object',
        'animal',
        'food',
        'vehicle',
        'architecture',
        'unknown',
        'unclear'
      ] // Added uncertainty options
    },
    date: {
      type: ['string', 'null'], // Explicitly allow null
      pattern: '^\\d{4}-\\d{2}-\\d{2}$|^unknown$'
    }
  }
};

// Post-processing: Treat "unknown" as omission
function cleanUnknowns(analysis) {
  for (const [key, value] of Object.entries(analysis)) {
    if (value === 'unknown' || value === 'unclear' || value === null) {
      delete analysis[key];
    }
  }
  return analysis;
}
```

### Confidence-Gated Field Inclusion

```javascript
async function analyzeWithConfidenceGating(imageBase64, fileName) {
  // Request per-field confidence
  const prompt = `Analyze this image: "${fileName}"

For EACH field, provide:
1. The value
2. Your confidence in that value (0-100)

Output schema:
{
  "project": { "value": "...", "confidence": 0-100 },
  "purpose": { "value": "...", "confidence": 0-100 },
  "category": { "value": "...", "confidence": 0-100 },
  "keywords": { "value": [...], "confidence": 0-100 },
  "content_type": { "value": "...", "confidence": 0-100 },
  "has_text": { "value": true/false, "confidence": 0-100 },
  "colors": { "value": [...], "confidence": 0-100 },
  "date": { "value": "...", "confidence": 0-100 }
}

ONLY include fields where confidence >= 70. Omit uncertain fields.`;

  const response = await analyzeImageWithOllama(imageBase64, prompt, smartFolders);

  // Filter out low-confidence fields
  const filtered = {};
  for (const [field, data] of Object.entries(response)) {
    if (data.confidence >= 70) {
      filtered[field] = data.value;
    } else {
      logger.debug(`Omitting field "${field}" due to low confidence: ${data.confidence}`);
    }
  }

  // Calculate overall confidence as average of included fields
  const confidences = Object.values(response).map((d) => d.confidence);
  filtered.confidence = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);

  return filtered;
}
```

---

## Model-Specific Optimizations

### Model Selection by Use Case

| Model                   | Best For                                      | Hallucination Rate | Speed     |
| ----------------------- | --------------------------------------------- | ------------------ | --------- |
| **Qwen2.5-VL:7B**       | OCR, detailed captions, complex docs          | LOW                | Medium    |
| **Llama3.2-Vision:11B** | Accuracy-critical tasks, legal/financial docs | LOW                | Slow      |
| **LLaVA:7B**            | General purpose, balanced speed/accuracy      | MEDIUM             | Fast      |
| **MiniCPM-V:8B**        | High-resolution images, detailed diagrams     | MEDIUM             | Medium    |
| **Moondream:2B**        | Edge devices, resource-constrained            | HIGH               | Very Fast |

**Current Default**: llava (balances speed/quality)

**Recommendation for Hallucination-Sensitive Tasks**: Switch to Qwen2.5-VL or Llama3.2-Vision

### Model-Specific Prompt Optimization

```javascript
function getOptimizedPrompt(modelName, fileName, smartFolders) {
  const basePrompt = buildBasePrompt(fileName, smartFolders);

  // Model-specific adjustments
  if (modelName.includes('llama3.2-vision')) {
    // Llama 3.2 benefits from detailed multi-sentence instructions
    return basePrompt + `\n\nProvide thorough, step-by-step analysis with detailed reasoning.`;
  }

  if (modelName.includes('gemma')) {
    // Gemma hallucinates on >50% of images with long prompts - keep it SHORT
    return buildShortPrompt(fileName, smartFolders);
  }

  if (modelName.includes('moondream')) {
    // Moondream optimized for concise captions
    return `Create a caption with exactly one sentence in the active voice that describes the main visual content. Begin with the main subject and clear action. Avoid text formatting, meta-language, and filler words.`;
  }

  if (modelName.includes('qwen')) {
    // Qwen2.5-VL excels at detailed multi-sentence captions and OCR
    return (
      basePrompt +
      `\n\nProvide detailed, multi-sentence description. Extract all visible text accurately.`
    );
  }

  return basePrompt;
}

function buildShortPrompt(fileName, smartFolders) {
  return `Image: "${fileName}"
Output JSON:
{
  "category": "${smartFolders.map((f) => f.name).join('|')}",
  "keywords": [3-7 words],
  "confidence": 60-100
}`;
}
```

### Parameter Tuning by Model

```javascript
function getOptimizedParameters(modelName, taskType = 'image_analysis') {
  const params = {
    temperature: 0.1, // Default: low for factual tasks
    num_predict: 512,
    top_p: 0.9,
    top_k: 40
  };

  if (modelName.includes('llama3.2-vision')) {
    params.temperature = 0.05; // Even more deterministic for accuracy
    params.num_predict = 1024; // Can handle longer outputs
  }

  if (modelName.includes('moondream')) {
    params.temperature = 0.15; // Slightly higher for natural captions
    params.num_predict = 256; // Optimized for concise output
  }

  if (modelName.includes('qwen')) {
    params.num_predict = 2048; // Supports detailed outputs
  }

  // Task-specific overrides
  if (taskType === 'ocr') {
    params.temperature = 0; // Deterministic for text extraction
  }

  if (taskType === 'creative_caption') {
    params.temperature = 0.7; // Higher for creative tasks
  }

  return params;
}
```

### LLaVA-Specific: Image Aspect Ratio Padding

```javascript
// LLaVA hallucination reduction technique
async function preprocessForLLaVA(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();

  // LLaVA works best with square images (padding reduces hallucination)
  if (meta.width !== meta.height) {
    const size = Math.max(meta.width, meta.height);

    // Pad to square with white background
    const padded = await sharp(imageBuffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .toBuffer();

    return padded;
  }

  return imageBuffer;
}
```

---

## Implementation Recommendations

### Priority 1: Quick Wins (Immediate Implementation)

1. **Lower Temperature to 0-0.1** for image analysis

   ```javascript
   // ollamaImageAnalysis.js:161
   temperature: 0.1, // Changed from current value
   ```

2. **Add Explicit "Omit if Uncertain" Instructions**

   ```javascript
   const prompt = `...
   If you cannot determine a field with high confidence, OMIT it from the JSON.
   Do not make up information. An incomplete but accurate response is preferred.`;
   ```

3. **Implement Confidence Calibration**

   ```javascript
   function calibrateConfidence(rawConfidence, analysis) {
     // Implementation from Confidence Scoring section
   }
   ```

4. **Add EXIF Date Override**
   ```javascript
   if (exifDate) {
     analysis.date = exifDate; // Already implemented! Line 663
   }
   ```

### Priority 2: Medium-Term Improvements (1-2 weeks)

1. **Upgrade to JSON Schema Mode** (Ollama v0.5+)
   - Replace `format: 'json'` with full schema
   - Enforce enum constraints on category/content_type
   - Validate min/max lengths

2. **Implement Self-Consistency** for high-stakes files
   - Generate 3 samples for confidence < 75
   - Aggregate with majority vote
   - Add consistency score to output

3. **Add Bespoke-Minicheck Fact-Checking**
   - Install model: `ollama pull bespoke-minicheck`
   - Implement fact-check pipeline
   - Penalize confidence for detected hallucinations

4. **Enhanced Metadata Grounding**
   - Include file size, dates, folder context
   - Extract full EXIF data (camera, GPS, etc.)
   - Use as grounding facts in prompt

### Priority 3: Advanced Features (Long-Term)

1. **RAG-Enhanced Analysis**
   - Retrieve similar files from ChromaDB
   - Use as examples in prompt
   - Improve category consistency

2. **Visual Inference Chain (VIC)**
   - Separate text reasoning from visual analysis
   - Reduce cross-modal biases

3. **Chain-of-Verification (CoVe)**
   - Generate verification questions
   - Self-correct based on answers

4. **Model-Specific Optimization**
   - Implement model detection and prompt/parameter tuning
   - LLaVA: aspect ratio padding
   - Gemma: short prompts
   - Qwen: detailed prompts

### Implementation Checklist

- [ ] Update temperature to 0.1 for image analysis
- [ ] Add uncertainty instructions to prompts
- [ ] Implement confidence calibration function
- [ ] Add filename/metadata grounding context
- [ ] Upgrade to JSON schema mode (if Ollama v0.5+)
- [ ] Implement self-consistency for uncertain cases
- [ ] Install and integrate bespoke-minicheck
- [ ] Add per-field confidence gating
- [ ] Implement RAG with ChromaDB similarity search
- [ ] Create model-specific prompt templates
- [ ] Build evaluation dataset with ground truth
- [ ] Measure hallucination rate on AMBER benchmark

---

## Benchmarking & Evaluation

### Creating a Validation Dataset

```javascript
// Structure for ground truth annotations
const validationDataset = [
  {
    path: 'test_images/sunset_beach.jpg',
    groundTruth: {
      category: 'photos',
      content_type: 'landscape',
      has_text: false,
      keywords: ['sunset', 'beach', 'ocean', 'sky'],
      project: 'Beach Sunset',
      confidence_min: 85
    }
  },
  {
    path: 'test_images/contract_document.png',
    groundTruth: {
      category: 'legal',
      content_type: 'text_document',
      has_text: true,
      keywords: ['contract', 'legal', 'agreement'],
      date: '2024-03-01',
      confidence_min: 90
    }
  }
  // Add 50-100 diverse examples
];
```

### Hallucination Rate Measurement

```javascript
async function measureHallucinationRate(validationSet) {
  let totalClaims = 0;
  let hallucinatedClaims = 0;

  for (const example of validationSet) {
    const analysis = await analyzeImageFile(example.path);

    // Check category
    if (analysis.category && analysis.category !== example.groundTruth.category) {
      hallucinatedClaims++;
    }
    totalClaims++;

    // Check content_type
    if (analysis.content_type && analysis.content_type !== example.groundTruth.content_type) {
      hallucinatedClaims++;
    }
    totalClaims++;

    // Check has_text
    if (analysis.has_text !== example.groundTruth.has_text) {
      hallucinatedClaims++;
    }
    totalClaims++;

    // Check keywords (partial match acceptable)
    const keywordOverlap = analysis.keywords.filter((k) =>
      example.groundTruth.keywords.includes(k)
    ).length;
    if (keywordOverlap < example.groundTruth.keywords.length * 0.5) {
      hallucinatedClaims++; // Less than 50% keyword match = hallucination
    }
    totalClaims++;
  }

  const hallucinationRate = hallucinatedClaims / totalClaims;
  logger.info('Hallucination Evaluation:', {
    totalClaims,
    hallucinatedClaims,
    hallucinationRate: `${(hallucinationRate * 100).toFixed(2)}%`
  });

  return hallucinationRate;
}
```

### AMBER Benchmark Integration

```javascript
// Use AMBER benchmark for standardized evaluation
async function runAMBERBenchmark() {
  // Download AMBER dataset: https://github.com/junyangwang0410/AMBER
  const amberDataset = loadAMBERDataset();

  const results = {
    chair: 0, // Object hallucination rate
    cover: 0, // Object coverage rate
    hal: 0, // Overall hallucination rate
    cog: 0 // Cognitive metrics
  };

  for (const item of amberDataset) {
    const analysis = await analyzeImageFile(item.imagePath);

    // AMBER scoring logic (simplified)
    const mentions = extractObjectMentions(analysis);
    const groundTruthObjects = item.groundTruthObjects;

    const hallucinatedObjects = mentions.filter((m) => !groundTruthObjects.includes(m));
    const missedObjects = groundTruthObjects.filter((o) => !mentions.includes(o));

    results.chair += hallucinatedObjects.length / mentions.length;
    results.cover += (groundTruthObjects.length - missedObjects.length) / groundTruthObjects.length;
  }

  // Average scores
  results.chair /= amberDataset.length;
  results.cover /= amberDataset.length;
  results.hal = results.chair; // Simplified

  logger.info('AMBER Benchmark Results:', results);
  return results;
}
```

---

## References & Sources

### Research Papers

1. [AMBER: An LLM-free Multi-dimensional Benchmark for MLLMs Hallucination Evaluation](https://arxiv.org/html/2311.07397v2)
2. [Mitigating Hallucinations in Large Vision-Language Models via DPO](https://arxiv.org/html/2501.09695v1)
3. [LLaVA-o1: Let Vision Language Models Reason Step-by-Step](https://arxiv.org/html/2411.10440v1)
4. [Thinking Before Looking: Improving Multimodal LLM Reasoning via Mitigating Visual Hallucination](https://arxiv.org/html/2411.12591v1)
5. [Know the Unknown: An Uncertainty-Sensitive Method for LLM Instruction Tuning](https://arxiv.org/abs/2406.10099)
6. [Alleviating Hallucination in Large Vision-Language Models with Active Retrieval Augmentation](https://arxiv.org/html/2408.00555v1)

### Documentation & Tools

7. [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)
8. [Ollama Blog: Reduce hallucinations with Bespoke-Minicheck](https://ollama.com/blog/reduce-hallucinations-with-bespoke-minicheck)
9. [Ollama Vision Models](https://ollama.com/blog/vision-models)
10. [Promptfoo: Prevent LLM Hallucinations](https://www.promptfoo.dev/docs/guides/prevent-llm-hallucations/)
11. [LLM Evaluation Techniques for JSON Outputs](https://www.promptfoo.dev/docs/guides/evaluate-json/)
12. [Contrastive Region Guidance](https://contrastive-region-guidance.github.io/)
13. [GitHub: Awesome LVLM Hallucination](https://github.com/NishilBalar/Awesome-LVLM-Hallucination)
14. [Vision Model Comparison (PhotoPrism)](https://docs.photoprism.app/developer-guide/vision/model-comparison/)

### Blog Posts & Guides

15. [Chain-of-thought is a secret weapon against hallucinations - PrimerAI](https://primer.ai/research/chain-of-thought-is-a-secret-weapon-against-hallucinations/)
16. [How to Prevent AI Hallucinations in LLM Models](https://medium.com/@obotnt/how-to-prevent-ai-hallucinations-in-llm-models-a-proven-method-1b4b1cc24fa1)
17. [Understanding Hallucination In LLMs: A Brief Introduction](https://blog.gdeltproject.org/understanding-hallucination-in-llms-a-brief-introduction/)
18. [Finding the Optimal Confidence Threshold](https://medium.com/voxel51/finding-the-optimal-confidence-threshold-cd524f1afe92)
19. [Structured LLM Output Using Ollama](https://towardsdatascience.com/structured-llm-output-using-ollama-73422889c7ad/)
20. [Best Ollama Models 2025: Complete Performance Guide](https://collabnix.com/best-ollama-models-in-2025-complete-performance-comparison/)

### Model Documentation

21. [LLaVA GitHub](https://github.com/haotian-liu/LLaVA)
22. [MiniCPM-V GitHub](https://github.com/OpenBMB/MiniCPM-V)
23. [Moondream](https://moondream.ai/)
24. [Llama 3.2 Model Cards](https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_2/)

---

## Conclusion

Preventing hallucinations in local vision models requires a **multi-layered defense strategy**:

1. **Grounding**: Anchor responses with known facts (filename, EXIF, metadata)
2. **Constraints**: Use JSON schema mode to enforce valid outputs
3. **Prompting**: Explicit instructions to omit uncertain fields
4. **Temperature**: Keep low (0-0.1) for factual tasks
5. **Verification**: Self-consistency, fact-checking, temporal consistency
6. **Calibration**: Adjust confidence scores based on validation signals

**No single technique eliminates hallucinations**, but combining these approaches can reduce
hallucination rates by **40-70%** compared to baseline implementations.

**Key Recommendation for ElstratoSort**:

- Implement Priority 1 quick wins immediately (1-2 days effort)
- Add Priority 2 features incrementally (minimal risk, high impact)
- Evaluate on a small validation dataset before deploying Priority 3 features

With these techniques, vision model accuracy for file organization should reach **85-95%
confidence** on clear images, with graceful degradation (confidence < 70, omitted fields) on
ambiguous cases.
