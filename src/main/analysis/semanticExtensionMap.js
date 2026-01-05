/**
 * Semantic Extension Mapping
 *
 * Maps semantic concepts/domains to their associated file extensions and vice versa.
 * This enables intelligent file routing where folder descriptions like "3D printing projects"
 * automatically understand that .stl, .obj, .3mf files belong there.
 *
 * @module analysis/semanticExtensionMap
 */

/**
 * Semantic mapping of concepts/domains to their associated file extensions.
 * Keys are lowercase concepts that might appear in folder names/descriptions.
 * Values are arrays of file extensions (without dots) that belong to that concept.
 */
const SEMANTIC_EXTENSION_MAP = {
  // 3D Printing & Modeling
  '3d': ['stl', 'obj', '3mf', 'gcode', 'step', 'iges', 'fbx', 'blend', 'max', 'c4d', 'dae'],
  '3d print': ['stl', 'obj', '3mf', 'gcode'],
  print: ['stl', 'obj', '3mf', 'gcode'],
  printing: ['stl', 'obj', '3mf', 'gcode'],
  slicer: ['stl', 'obj', '3mf', 'gcode'],
  slicing: ['stl', 'obj', '3mf', 'gcode'],
  model: ['stl', 'obj', '3mf', 'fbx', 'blend', 'dae', 'glb', 'gltf'],
  mesh: ['stl', 'obj', '3mf', 'fbx', 'ply', 'off'],
  cad: ['step', 'stp', 'iges', 'igs', 'dwg', 'dxf', 'sat', 'x_t', 'x_b'],
  blender: ['blend', 'fbx', 'obj', 'stl', 'dae', 'glb', 'gltf'],
  fusion: ['f3d', 'step', 'stp', 'iges', 'stl'],
  'fusion 360': ['f3d', 'step', 'stp', 'iges', 'stl'],
  solidworks: ['sldprt', 'sldasm', 'slddrw', 'step', 'iges'],
  ender: ['stl', 'obj', '3mf', 'gcode'],
  prusa: ['stl', 'obj', '3mf', 'gcode'],
  creality: ['stl', 'obj', '3mf', 'gcode'],
  bambu: ['stl', 'obj', '3mf', 'gcode'],
  thingiverse: ['stl', 'obj', '3mf'],
  printables: ['stl', 'obj', '3mf'],
  cura: ['stl', 'obj', '3mf', 'gcode'],
  prusaslicer: ['stl', 'obj', '3mf', 'gcode'],
  orcaslicer: ['stl', 'obj', '3mf', 'gcode'],

  // Audio & Music Production
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff'],
  music: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'mid', 'midi'],
  daw: ['flp', 'als', 'logic', 'ptx', 'cpr', 'rpp', 'aup'],
  ableton: ['als', 'alp', 'adg', 'adv', 'agr'],
  'fl studio': ['flp', 'fst'],
  logic: ['logic', 'logicx'],
  'pro tools': ['ptx', 'pts'],
  cubase: ['cpr', 'npr'],
  reaper: ['rpp'],
  audacity: ['aup', 'aup3'],
  podcast: ['mp3', 'wav', 'aiff', 'm4a'],
  sample: ['wav', 'aiff', 'mp3', 'flac'],
  stems: ['wav', 'aiff', 'flac'],

  // Video & Animation
  video: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'webm', 'flv', 'm4v'],
  animation: ['mp4', 'mov', 'gif', 'webm', 'blend', 'aep', 'fla'],
  premiere: ['prproj', 'prel'],
  'after effects': ['aep', 'aepx'],
  davinci: ['drp', 'dra'],
  'final cut': ['fcpx', 'fcpbundle'],

  // Design & Creative
  design: ['psd', 'ai', 'sketch', 'xd', 'fig', 'afdesign', 'afphoto'],
  photoshop: ['psd', 'psb'],
  illustrator: ['ai', 'eps', 'svg'],
  sketch: ['sketch'],
  figma: ['fig'],
  affinity: ['afdesign', 'afphoto', 'afpub'],
  indesign: ['indd', 'indt', 'idml'],
  vector: ['svg', 'ai', 'eps', 'pdf'],
  raster: ['psd', 'tiff', 'png', 'jpg', 'raw'],
  raw: ['raw', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'dng', 'raf'],
  photo: ['jpg', 'jpeg', 'png', 'tiff', 'raw', 'cr2', 'nef', 'heic'],
  lightroom: ['lrcat', 'lrdata', 'xmp', 'dng'],

  // Development & Code
  code: ['js', 'ts', 'py', 'java', 'cpp', 'c', 'cs', 'go', 'rs', 'rb', 'php'],
  web: ['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'vue', 'svelte'],
  python: ['py', 'pyw', 'ipynb', 'pyx'],
  javascript: ['js', 'mjs', 'cjs', 'jsx'],
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  java: ['java', 'jar', 'class', 'war'],
  react: ['jsx', 'tsx', 'js', 'ts'],
  unity: ['unity', 'prefab', 'asset', 'cs'],
  unreal: ['uproject', 'uasset', 'umap', 'cpp', 'h'],
  godot: ['gd', 'tscn', 'tres', 'godot'],

  // Data & Analysis
  data: ['csv', 'json', 'xml', 'xlsx', 'xls', 'parquet', 'feather'],
  database: ['sql', 'db', 'sqlite', 'mdb', 'accdb'],
  spreadsheet: ['xlsx', 'xls', 'ods', 'csv'],
  jupyter: ['ipynb'],
  notebook: ['ipynb', 'rmd', 'qmd'],

  // Archives & Compression
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  backup: ['zip', 'rar', '7z', 'tar', 'gz', 'bak'],
  compressed: ['zip', 'rar', '7z', 'gz', 'bz2', 'xz'],

  // Documents
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt'],
  ebook: ['epub', 'mobi', 'azw', 'azw3', 'pdf'],
  kindle: ['mobi', 'azw', 'azw3', 'kfx'],
  presentation: ['pptx', 'ppt', 'odp', 'key'],
  slides: ['pptx', 'ppt', 'odp', 'key'],

  // Gaming & ROMs
  rom: ['nes', 'snes', 'gba', 'gbc', 'gb', 'n64', 'nds', '3ds', 'iso', 'cue'],
  emulator: ['nes', 'snes', 'gba', 'gbc', 'n64', 'nds', 'iso', 'sav'],
  save: ['sav', 'srm', 'sram'],
  game: ['exe', 'app', 'iso', 'rom', 'sav'],

  // Fonts
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot', 'fon'],
  typography: ['ttf', 'otf', 'woff', 'woff2'],

  // GIS & Mapping
  gis: ['shp', 'geojson', 'kml', 'kmz', 'gpx', 'osm'],
  map: ['kml', 'kmz', 'gpx', 'geojson'],
  gps: ['gpx', 'kml', 'kmz', 'fit'],

  // Engineering & Electronics
  pcb: ['kicad_pcb', 'brd', 'sch', 'gbr', 'drl'],
  kicad: ['kicad_pcb', 'kicad_sch', 'kicad_pro'],
  eagle: ['brd', 'sch', 'lbr'],
  schematic: ['sch', 'kicad_sch', 'asc'],
  gerber: ['gbr', 'gtl', 'gbl', 'gts', 'gbs', 'gto', 'gbo', 'drl'],
  circuit: ['sch', 'asc', 'cir', 'net'],
  arduino: ['ino', 'pde', 'cpp', 'h'],
  firmware: ['hex', 'bin', 'elf', 'uf2'],

  // Laser cutting & CNC
  laser: ['svg', 'dxf', 'ai', 'pdf', 'lbrn', 'lbrn2'],
  cnc: ['nc', 'gcode', 'ngc', 'tap', 'dxf', 'dwg'],
  lightburn: ['lbrn', 'lbrn2'],
  engrave: ['svg', 'dxf', 'ai', 'png', 'jpg']
};

/**
 * Reverse mapping: extension -> array of semantic concepts
 * Built from SEMANTIC_EXTENSION_MAP for efficient lookup
 */
const EXTENSION_TO_CONCEPTS = {};

// Build the reverse mapping
for (const [concept, extensions] of Object.entries(SEMANTIC_EXTENSION_MAP)) {
  for (const ext of extensions) {
    if (!EXTENSION_TO_CONCEPTS[ext]) {
      EXTENSION_TO_CONCEPTS[ext] = [];
    }
    if (!EXTENSION_TO_CONCEPTS[ext].includes(concept)) {
      EXTENSION_TO_CONCEPTS[ext].push(concept);
    }
  }
}

/**
 * Common/standard file extensions that should NOT use semantic scoring.
 * These file types are so common that semantic scoring would cause too many false matches.
 * For example, we don't want a "Documents" folder to match all .pdf files just because
 * "document" is a semantic concept for PDFs.
 *
 * Semantic scoring is reserved for specialized file types like .stl, .blend, .flp, etc.
 */
const COMMON_EXTENSIONS_NO_SEMANTIC = new Set([
  // Documents - too common, use keyword matching instead
  'pdf',
  'doc',
  'docx',
  'txt',
  'rtf',
  'odt',
  // Spreadsheets
  'xlsx',
  'xls',
  'csv',
  'ods',
  // Presentations
  'pptx',
  'ppt',
  'odp',
  'key',
  // Images - very common
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'tiff',
  'svg',
  // Videos - common
  'mp4',
  'avi',
  'mov',
  'mkv',
  'wmv',
  'webm',
  // Audio - common
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  // Archives - common
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  // Code - common
  'js',
  'ts',
  'py',
  'java',
  'cpp',
  'c',
  'html',
  'css',
  'json',
  'xml'
]);

/**
 * Get semantic concepts associated with a file extension.
 * Returns an array of concept strings that describe the file type domain.
 *
 * @param {string} extension - File extension (with or without leading dot)
 * @returns {string[]} Array of semantic concepts (e.g., ['3d', '3d print', 'model', 'mesh'])
 *
 * @example
 * getSemanticConceptsForExtension('.stl')
 * // Returns: ['3d', '3d print', 'print', 'printing', 'slicer', 'slicing', 'model', 'mesh', ...]
 */
function getSemanticConceptsForExtension(extension) {
  if (!extension) return [];
  const ext = extension.toLowerCase().replace(/^\./, '');
  return EXTENSION_TO_CONCEPTS[ext] || [];
}

/**
 * Get semantic keywords to enrich embedding text for a file.
 * Returns a string of keywords that help the embedding understand the file's domain.
 *
 * NOTE: Only returns keywords for specialized file types, not common ones like PDF/JPG.
 *
 * @param {string} extension - File extension (with or without leading dot)
 * @returns {string} Space-separated keywords for embedding enrichment
 *
 * @example
 * getSemanticKeywordsForFile('.stl')
 * // Returns: "3d 3d-print 3d-model mesh printing slicer stl-file"
 */
function getSemanticKeywordsForFile(extension) {
  if (!extension) return '';

  const ext = extension.toLowerCase().replace(/^\./, '');

  // Skip semantic keywords for common file types
  if (COMMON_EXTENSIONS_NO_SEMANTIC.has(ext)) {
    return '';
  }

  const concepts = getSemanticConceptsForExtension(extension);
  if (concepts.length === 0) return '';

  // Deduplicate and create keyword variations
  const keywords = new Set();

  for (const concept of concepts) {
    keywords.add(concept);
    // Add hyphenated version for compound concepts
    keywords.add(concept.replace(/\s+/g, '-'));
  }

  // Add the extension itself
  keywords.add(ext);
  keywords.add(`${ext}-file`);

  return Array.from(keywords).join(' ');
}

/**
 * Get extensions that match semantic concepts found in text.
 * Analyzes text for semantic concepts and returns associated extensions.
 *
 * @param {string} text - Text to analyze (e.g., folder name or description)
 * @returns {string[]} Array of extensions that semantically match the text
 *
 * @example
 * getExtensionsForSemanticText('3D printing projects for my Ender 3')
 * // Returns: ['stl', 'obj', '3mf', 'gcode']
 */
function getExtensionsForSemanticText(text) {
  if (!text) return [];

  const textLower = text.toLowerCase();
  const extensions = new Set();

  for (const [concept, exts] of Object.entries(SEMANTIC_EXTENSION_MAP)) {
    if (textLower.includes(concept)) {
      for (const ext of exts) {
        extensions.add(ext);
      }
    }
  }

  return Array.from(extensions);
}

/**
 * Enrich folder text for embedding with semantic keywords.
 * Adds keywords based on what file types the folder name/description implies.
 *
 * @param {string} folderName - Folder name
 * @param {string} [folderDescription] - Optional folder description
 * @returns {string} Enriched text for embedding
 *
 * @example
 * enrichFolderTextForEmbedding('3D Prints', 'Models for my Ender 3 printer')
 * // Returns: "3D Prints - Models for my Ender 3 printer | File types: stl obj 3mf gcode | Domain: 3d printing model mesh"
 */
function enrichFolderTextForEmbedding(folderName, folderDescription = '') {
  const baseText = [folderName, folderDescription].filter(Boolean).join(' - ');
  const combinedText = `${folderName} ${folderDescription}`.toLowerCase();

  // Find all matching extensions and concepts
  const matchedExtensions = new Set();
  const matchedConcepts = new Set();

  for (const [concept, extensions] of Object.entries(SEMANTIC_EXTENSION_MAP)) {
    if (combinedText.includes(concept)) {
      matchedConcepts.add(concept);
      for (const ext of extensions) {
        matchedExtensions.add(ext);
      }
    }
  }

  if (matchedExtensions.size === 0) {
    return baseText; // No semantic enrichment needed
  }

  // Build enriched text
  const extensionList = Array.from(matchedExtensions).slice(0, 10).join(' ');
  const conceptList = Array.from(matchedConcepts).slice(0, 5).join(' ');

  return `${baseText} | File types: ${extensionList} | Domain: ${conceptList}`;
}

/**
 * Enrich file analysis text for embedding with semantic context.
 * Adds domain keywords based on file extension for better folder matching.
 *
 * @param {string} analysisText - Original analysis text/summary
 * @param {string} extension - File extension
 * @returns {string} Enriched text for embedding
 *
 * @example
 * enrichFileTextForEmbedding('benchy boat model', '.stl')
 * // Returns: "benchy boat model | 3d printing model mesh file | stl"
 */
function enrichFileTextForEmbedding(analysisText, extension) {
  const semanticKeywords = getSemanticKeywordsForFile(extension);

  if (!semanticKeywords) {
    return analysisText || '';
  }

  return `${analysisText || ''} | ${semanticKeywords}`.trim();
}

/**
 * Check if a text semantically implies certain file extensions.
 * Returns a score based on how strongly the text matches the extension's domain.
 *
 * NOTE: This only applies semantic scoring for specialized/uncommon file types
 * (like .stl, .blend, .flp) to avoid false matches with common extensions.
 *
 * @param {string} text - Text to analyze (folder name, description, etc.)
 * @param {string} extension - File extension to check
 * @returns {number} Score (0-20) based on semantic match strength
 */
function getSemanticExtensionScore(text, extension) {
  if (!text || !extension) return 0;

  const textLower = text.toLowerCase();
  const extLower = extension.toLowerCase().replace(/^\./, '');

  // Skip semantic scoring for common file types
  // These should use traditional keyword matching to avoid false positives
  if (COMMON_EXTENSIONS_NO_SEMANTIC.has(extLower)) {
    return 0;
  }

  let maxScore = 0;

  for (const [concept, extensions] of Object.entries(SEMANTIC_EXTENSION_MAP)) {
    // Check if the concept appears in the text
    if (textLower.includes(concept)) {
      // Check if the file extension is associated with this concept
      if (extensions.includes(extLower)) {
        // Longer concept matches are more specific, so score higher
        const conceptScore = Math.min(20, 10 + concept.length);
        maxScore = Math.max(maxScore, conceptScore);
      }
    }
  }

  return maxScore;
}

module.exports = {
  SEMANTIC_EXTENSION_MAP,
  EXTENSION_TO_CONCEPTS,
  getSemanticConceptsForExtension,
  getSemanticKeywordsForFile,
  getExtensionsForSemanticText,
  enrichFolderTextForEmbedding,
  enrichFileTextForEmbedding,
  getSemanticExtensionScore
};
