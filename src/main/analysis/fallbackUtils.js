/**
 * Fallback Analysis Utilities
 *
 * This module provides intelligent filename-based analysis fallbacks
 * for when AI analysis is unavailable or fails. It includes:
 * - Smart category matching against folder definitions
 * - Intelligent keyword extraction from filenames
 * - Safe filename suggestion generation
 * - Unified fallback factory function
 *
 * @module analysis/fallbackUtils
 */

// Use shared semantic extension mapping
const {
  getSemanticExtensionScore,
  getSemanticConceptsForExtension
} = require('./semanticExtensionMap');
const FolderMatchingService = require('../services/FolderMatchingService');

const normalizeCategoryToSmartFolders =
  typeof FolderMatchingService?.matchCategoryToFolder === 'function'
    ? FolderMatchingService.matchCategoryToFolder.bind(FolderMatchingService)
    : (category, smartFolders) => {
        const folders = Array.isArray(smartFolders) ? smartFolders : [];
        if (!folders.length) return category;
        const normalized = String(category || '')
          .trim()
          .toLowerCase();
        const match = folders.find(
          (folder) =>
            String(folder?.name || '')
              .trim()
              .toLowerCase() === normalized
        );
        return match?.name || category;
      };

function getIntelligentCategory(fileName, extension, smartFolders = []) {
  const lowerFileName = fileName.toLowerCase();
  const lowerExtension = extension ? extension.toLowerCase() : '';
  // Extension without dot for matching (e.g., 'stl' from '.stl')
  const extNoDot = lowerExtension.replace(/^\./, '');

  if (smartFolders && smartFolders.length > 0) {
    const validFolders = smartFolders.filter(
      (f) => f && f.name && typeof f.name === 'string' && f.name.trim().length > 0
    );
    let bestMatch = null;
    let bestScore = 0;
    for (const folder of validFolders) {
      const folderNameLower = folder.name.toLowerCase();
      let score = 0;
      if (lowerFileName.includes(folderNameLower)) score += 10;
      const folderWords = folderNameLower.split(/[\s_-]+/).filter((w) => w.length > 2);
      for (const word of folderWords) if (lowerFileName.includes(word)) score += 8;

      // SEMANTIC EXTENSION MATCHING: Understand that "3D printing" folder means .stl files belong there
      // This checks folder NAME for semantic concepts (e.g., "3D Prints" folder → .stl files)
      if (extNoDot) {
        const nameSemanticScore = getSemanticExtensionScore(folderNameLower, extNoDot);
        if (nameSemanticScore > 0) {
          score += nameSemanticScore; // Up to +20 for semantic match in folder name
        }
      }

      if (folder.description) {
        const descLower = folder.description.toLowerCase();
        const descWords = descLower.split(/[\s,.-]+/).filter((w) => w.length > 3);
        for (const word of descWords) if (lowerFileName.includes(word)) score += 6;

        // SEMANTIC EXTENSION MATCHING: Understand that "models for my Ender 3" means .stl files
        // This checks folder DESCRIPTION for semantic concepts
        if (extNoDot) {
          const descSemanticScore = getSemanticExtensionScore(descLower, extNoDot);
          if (descSemanticScore > 0) {
            score += descSemanticScore; // Up to +20 for semantic match in description
          }
        }

        // EXPLICIT EXTENSION MATCHING: Check if folder description explicitly lists this extension
        // This allows folder descriptions like "3D printing files: .stl, .obj, .3mf" to match
        if (extNoDot && extNoDot.length >= 2) {
          // Match extension with or without dot (e.g., ".stl" or "stl")
          if (descLower.includes(lowerExtension) || descLower.includes(extNoDot)) {
            score += 15; // High score for explicit extension match in description
          }
        }
      }
      if (Array.isArray(folder.semanticTags)) {
        for (const tag of folder.semanticTags) {
          const tagLower = String(tag).toLowerCase();
          if (lowerFileName.includes(tagLower)) score += 5;
          // Extension match in semantic tags (e.g., semanticTags: ["stl", "3d-model"])
          if (extNoDot && (tagLower === lowerExtension || tagLower === extNoDot)) {
            score += 10; // High score for explicit extension in semantic tags
          }
        }
      }
      // Check keywords for extension match as well as filename match
      if (Array.isArray(folder.keywords)) {
        for (const kw of folder.keywords) {
          const kwLower = String(kw).toLowerCase();
          if (lowerFileName.includes(kwLower)) score += 4;
          // Extension match in keywords (e.g., keywords: [".stl", "3mf", "gcode"])
          if (extNoDot && (kwLower === lowerExtension || kwLower === extNoDot)) {
            score += 12; // High score for explicit extension in keywords
          }
        }
      }
      // FIXED Bug #25: Validate split() result before access to prevent crashes
      if (folder.path && typeof folder.path === 'string') {
        const pathParts = folder.path.toLowerCase().split(/[\\/]/);
        // Validate that split returned an array
        if (Array.isArray(pathParts)) {
          const parts = pathParts.filter((p) => p && p.length > 2);
          for (const part of parts) {
            if (lowerFileName.includes(part)) score += 3;
          }
        }
      }
      if (folder.category) {
        for (const word of folder.category.toLowerCase().split(/[\s_-]+/)) {
          if (word.length > 2 && lowerFileName.includes(word)) score += 2;
        }
      }
      if (Array.isArray(folder.relatedFolders)) {
        for (const relatedName of folder.relatedFolders)
          if (lowerFileName.includes(String(relatedName).toLowerCase())) score += 1;
      }
      if (folder.confidenceScore && folder.confidenceScore > 0.8) score *= 1.2;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = folder.name;
      }
    }
    // HIGH PRIORITY FIX (HIGH-6): Only return bestMatch if it's not null
    // This ensures we never return null and fall through to pattern matching
    if (bestScore >= 5 && bestMatch) return bestMatch;
  }

  const patterns = {
    financial: [
      'invoice',
      'receipt',
      'tax',
      'financial',
      'payment',
      'bank',
      'budget',
      'expense',
      'income',
      'billing',
      'statement',
      'transaction',
      'payroll',
      'accounting',
      'audit',
      'revenue',
      'profit',
      'loss',
      'balance'
    ],
    legal: [
      'contract',
      'agreement',
      'legal',
      'terms',
      'policy',
      'license',
      'patent',
      'trademark',
      'copyright',
      'compliance',
      'regulation',
      'law',
      'court',
      'litigation',
      'settlement',
      'clause',
      'liability',
      'warranty'
    ],
    project: [
      'project',
      'spec',
      'requirement',
      'proposal',
      'plan',
      'design',
      'scope',
      'milestone',
      'deliverable',
      'timeline',
      'roadmap',
      'charter',
      'brief',
      'kickoff',
      'retrospective',
      'sprint',
      'agile',
      'scrum'
    ],
    personal: [
      'resume',
      'cv',
      'personal',
      'letter',
      'diary',
      'journal',
      'notes',
      'family',
      'vacation',
      'travel',
      'health',
      'medical',
      'insurance',
      'passport',
      'certificate',
      'diploma',
      'education'
    ],
    technical: [
      'manual',
      'guide',
      'technical',
      'instruction',
      'documentation',
      'api',
      'code',
      'software',
      'hardware',
      'system',
      'architecture',
      'database',
      'server',
      'network',
      'security',
      'backup',
      'config',
      'setup'
    ],
    research: [
      'research',
      'study',
      'analysis',
      'report',
      'findings',
      'data',
      'survey',
      'experiment',
      'hypothesis',
      'methodology',
      'results',
      'conclusion',
      'whitepaper',
      'thesis',
      'dissertation',
      'publication'
    ],
    marketing: [
      'marketing',
      'campaign',
      'advertisement',
      'promotion',
      'brand',
      'logo',
      'social',
      'media',
      'content',
      'strategy',
      'analytics',
      'metrics',
      'conversion',
      'lead',
      'customer',
      'segment',
      'target'
    ],
    hr: [
      'employee',
      'staff',
      'hiring',
      'recruitment',
      'onboarding',
      'training',
      'performance',
      'review',
      'evaluation',
      'benefits',
      'policy',
      'handbook',
      'job',
      'position',
      'salary',
      'compensation',
      'leave'
    ]
  };
  // FIXED Bug #27: Add early exit optimization when perfect match found
  const categoryScores = {};
  let maxScore = 0;
  let bestCategory = null;

  for (const [category, keywords] of Object.entries(patterns)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerFileName.includes(keyword)) {
        score += keyword.length;
      }
    }
    if (score > 0) {
      categoryScores[category] = score;
      // Track best category during iteration for early exit
      if (score > maxScore) {
        maxScore = score;
        bestCategory = category;
      }
    }
  }

  // Early exit: if we found a category, return it
  if (bestCategory) {
    return bestCategory;
  }

  // Map extensions to capitalized category names that match typical smart folder names
  const extensionCategories = {
    '.pdf': 'Documents',
    '.doc': 'Documents',
    '.docx': 'Documents',
    '.txt': 'Documents',
    '.rtf': 'Documents',
    '.odt': 'Documents',
    '.md': 'Documents',
    '.png': 'Images',
    '.jpg': 'Images',
    '.jpeg': 'Images',
    '.gif': 'Images',
    '.svg': 'Images',
    '.webp': 'Images',
    '.bmp': 'Images',
    '.tiff': 'Images',
    '.mp4': 'Videos',
    '.avi': 'Videos',
    '.mov': 'Videos',
    '.mkv': 'Videos',
    '.wmv': 'Videos',
    '.xlsx': 'Spreadsheets',
    '.xls': 'Spreadsheets',
    '.csv': 'Data',
    '.json': 'Data',
    '.xml': 'Data',
    '.zip': 'Archives',
    '.rar': 'Archives',
    '.7z': 'Archives',
    '.tar': 'Archives',
    '.gz': 'Archives',
    '.mp3': 'Music',
    '.wav': 'Music',
    '.flac': 'Music',
    '.aac': 'Music',
    '.pptx': 'Presentations',
    '.ppt': 'Presentations',
    '.key': 'Presentations'
  };

  const fallbackCategory = extensionCategories[lowerExtension] || 'Documents';

  // Try to find a matching smart folder for the fallback category
  if (smartFolders && smartFolders.length > 0) {
    const normalizedFallback = fallbackCategory.toLowerCase();
    for (const folder of smartFolders) {
      if (!folder || !folder.name) continue;
      const normalizedName = folder.name.toLowerCase();
      // Check if folder name matches fallback category (case-insensitive)
      if (
        normalizedName === normalizedFallback ||
        normalizedName === `${normalizedFallback}s` ||
        normalizedName === normalizedFallback.replace(/s$/, '')
      ) {
        return folder.name; // Return the actual smart folder name (preserves case)
      }
    }
  }

  return fallbackCategory;
}

function getIntelligentKeywords(fileName, extension) {
  const category = getIntelligentCategory(fileName, extension);
  const lowerFileName = fileName.toLowerCase();
  const lowerCategory = category.toLowerCase();
  const baseKeywords = {
    financial: ['financial', 'money', 'business'],
    legal: ['legal', 'official', 'formal'],
    project: ['project', 'work', 'development'],
    personal: ['personal', 'individual', 'private'],
    technical: ['technical', 'manual', 'guide'],
    documents: ['document', 'file', 'text'],
    document: ['document', 'file', 'text'],
    images: ['image', 'visual', 'graphic'],
    image: ['image', 'visual', 'graphic'],
    videos: ['video', 'media', 'recording'],
    video: ['video', 'media', 'recording'],
    music: ['audio', 'music', 'sound'],
    data: ['data', 'information', 'records'],
    archives: ['archive', 'compressed', 'backup'],
    spreadsheets: ['spreadsheet', 'data', 'table'],
    presentations: ['presentation', 'slides', 'deck']
  };
  const keywords = [...(baseKeywords[lowerCategory] || ['file', 'document'])];
  if (lowerFileName.includes('report')) keywords.push('report');
  if (lowerFileName.includes('summary')) keywords.push('summary');
  if (lowerFileName.includes('analysis')) keywords.push('analysis');
  if (lowerFileName.includes('proposal')) keywords.push('proposal');
  if (lowerFileName.includes('presentation')) keywords.push('presentation');
  if (extension) keywords.push(extension.replace('.', ''));

  // Add semantic keywords from extension mapping
  // This ensures that .stl files include keywords like "3d", "printing", "model"
  const semanticConcepts = getSemanticConceptsForExtension(extension);
  if (semanticConcepts.length > 0) {
    // Add top 3 most relevant semantic concepts
    for (const concept of semanticConcepts.slice(0, 3)) {
      if (!keywords.includes(concept)) {
        keywords.push(concept);
      }
    }
  }

  return keywords.slice(0, 10); // Increased from 7 to 10 to include semantic keywords
}

function safeSuggestedName(fileName, extension) {
  // CRITICAL FIX: Comprehensive input sanitization to prevent file system issues

  // If the filename is already just the extension or empty, use a default topic
  if (!fileName || fileName === extension) {
    return `unnamed_file${extension}`;
  }

  // HIGH FIX: Use proper trailing extension removal instead of string.replace()
  // string.replace() only removes the first occurrence, which could incorrectly
  // modify filenames like "report.pdf.backup.pdf" → "report.backup.pdf" instead of "report.pdf.backup"
  let nameWithoutExt = fileName;
  if (extension && fileName.toLowerCase().endsWith(extension.toLowerCase())) {
    nameWithoutExt = fileName.slice(0, -extension.length);
  }

  // Try to extract a topic from the existing filename if it's descriptive
  // Split by common separators
  const parts = nameWithoutExt.split(/[_\-.\s]+/);
  // Take first 1-3 significant words (skip overly short ones like "a", "the", numbers unless relevant)
  const meaningfulParts = parts.filter((p) => p && p.length > 2 && !/^\d+$/.test(p));

  if (meaningfulParts.length > 0) {
    // Reassemble first 3 parts
    nameWithoutExt = meaningfulParts.slice(0, 3).join('_');
  } else {
    // Fallback: just clean the original name
    nameWithoutExt = nameWithoutExt.trim();
  }

  // CRITICAL FIX: Handle reserved Windows file names
  const reservedNames = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9'
  ];

  const upperName = nameWithoutExt.toUpperCase().trim();
  if (reservedNames.includes(upperName)) {
    nameWithoutExt = `${nameWithoutExt}_file`;
  }

  // CRITICAL FIX: Handle leading dots (hidden files on Unix-like systems)
  // and prevent empty names
  if (!nameWithoutExt || nameWithoutExt.trim().length === 0) {
    nameWithoutExt = 'unnamed_file';
  }

  // Remove leading/trailing dots and spaces
  nameWithoutExt = nameWithoutExt.trim().replace(/^\.+/, '').replace(/\.+$/, '');

  // If stripping dots results in empty name, use default
  if (!nameWithoutExt || nameWithoutExt.length === 0) {
    nameWithoutExt = 'unnamed_file';
  }

  // CRITICAL FIX: Sanitize invalid characters (comprehensive)
  // Windows: < > : " / \ | ? *
  // Unix: /
  // Also remove control characters
  const sanitized = nameWithoutExt
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_+/, '') // Remove leading underscores
    .replace(/_+$/, ''); // Remove trailing underscores

  // Final fallback if name is empty after sanitization
  const finalName = sanitized || 'unnamed_file';

  // CRITICAL FIX: Ensure name doesn't exceed filesystem limits (255 chars typical)
  const maxLength = 200; // Leave room for extension and path components
  const truncatedName =
    finalName.length > maxLength ? finalName.substring(0, maxLength) : finalName;

  // Always include extension to prevent files from becoming unopenable
  return truncatedName + extension;
}

/**
 * Create a unified fallback analysis result
 *
 * This factory function consolidates fallback creation patterns from:
 * - ollamaDocumentAnalysis.js (createDocumentFallback)
 * - ollamaImageAnalysis.js (createFallbackResult)
 *
 * @param {Object} params - Parameters for fallback creation
 * @param {string} params.fileName - Original file name
 * @param {string} params.fileExtension - File extension
 * @param {string} [params.reason] - Reason for fallback analysis
 * @param {Array} [params.smartFolders=[]] - Smart folders for category matching
 * @param {number} [params.confidence=65] - Confidence score
 * @param {string} [params.type='document'] - File type ('document' or 'image')
 * @param {Object} [params.options={}] - Additional options
 * @param {string} [params.options.extractionMethod='filename_fallback'] - Extraction method
 * @param {string} [params.options.date] - Override date
 * @param {string} [params.options.error] - Error message to include
 * @returns {Object} Fallback analysis result
 *
 * @example
 * const fallback = createFallbackAnalysis({
 *   fileName: 'report.pdf',
 *   fileExtension: '.pdf',
 *   reason: 'Ollama unavailable',
 *   smartFolders: folders,
 *   confidence: 60,
 *   type: 'document'
 * });
 */
function createFallbackAnalysis(params) {
  const {
    fileName,
    fileExtension,
    reason,
    smartFolders = [],
    confidence = 65,
    type = 'document',
    options = {}
  } = params;

  const {
    extractionMethod = 'filename_fallback',
    date = new Date().toISOString().split('T')[0],
    error = null
  } = options;

  // Get intelligent category and keywords from filename
  const intelligentCategory = getIntelligentCategory(fileName, fileExtension, smartFolders);
  const intelligentKeywords = getIntelligentKeywords(fileName, fileExtension);

  // Build purpose string based on type and reason
  const purpose = reason
    ? `${type === 'image' ? 'Image' : 'Document'} (fallback - ${reason})`
    : `${type === 'image' ? 'Image' : 'Document'} (fallback analysis)`;

  // Build the result object
  const baseCategory = intelligentCategory || (type === 'image' ? 'Images' : 'Documents');
  const category = normalizeCategoryToSmartFolders(baseCategory, smartFolders);

  const result = {
    purpose,
    project: fileName.replace(fileExtension, ''),
    category,
    date,
    keywords: intelligentKeywords || [],
    confidence,
    suggestedName: safeSuggestedName(fileName, fileExtension),
    extractionMethod,
    fallbackReason: reason || 'fallback analysis'
  };

  // Add error if provided
  if (error) {
    result.error = error;
  }

  return result;
}

module.exports = {
  getIntelligentCategory,
  getIntelligentKeywords,
  safeSuggestedName,
  createFallbackAnalysis
};
