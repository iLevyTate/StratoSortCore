/**
 * FileIcon - Renders appropriate icon based on file extension
 *
 * Maps file extensions to Lucide icons with semantic colors
 */

import React, { memo } from 'react';
import PropTypes from 'prop-types';
import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  File,
  FileJson,
  Presentation
} from 'lucide-react';

// File extension to icon/color mapping
const FILE_TYPE_CONFIG = {
  // Documents
  pdf: { icon: FileText, color: 'text-red-500' },
  doc: { icon: FileText, color: 'text-blue-600' },
  docx: { icon: FileText, color: 'text-blue-600' },
  txt: { icon: FileText, color: 'text-system-gray-500' },
  rtf: { icon: FileText, color: 'text-system-gray-500' },
  md: { icon: FileText, color: 'text-system-gray-600' },
  odt: { icon: FileText, color: 'text-blue-500' },

  // Spreadsheets
  xls: { icon: FileSpreadsheet, color: 'text-green-600' },
  xlsx: { icon: FileSpreadsheet, color: 'text-green-600' },
  csv: { icon: FileSpreadsheet, color: 'text-green-500' },
  ods: { icon: FileSpreadsheet, color: 'text-green-500' },

  // Presentations
  ppt: { icon: Presentation, color: 'text-orange-500' },
  pptx: { icon: Presentation, color: 'text-orange-500' },
  odp: { icon: Presentation, color: 'text-orange-400' },

  // Images
  jpg: { icon: FileImage, color: 'text-purple-500' },
  jpeg: { icon: FileImage, color: 'text-purple-500' },
  png: { icon: FileImage, color: 'text-purple-500' },
  gif: { icon: FileImage, color: 'text-purple-400' },
  svg: { icon: FileImage, color: 'text-purple-600' },
  webp: { icon: FileImage, color: 'text-purple-500' },
  bmp: { icon: FileImage, color: 'text-purple-400' },
  ico: { icon: FileImage, color: 'text-purple-400' },
  tiff: { icon: FileImage, color: 'text-purple-500' },
  heic: { icon: FileImage, color: 'text-purple-500' },

  // Video
  mp4: { icon: FileVideo, color: 'text-pink-500' },
  mov: { icon: FileVideo, color: 'text-pink-500' },
  avi: { icon: FileVideo, color: 'text-pink-500' },
  mkv: { icon: FileVideo, color: 'text-pink-500' },
  webm: { icon: FileVideo, color: 'text-pink-400' },
  wmv: { icon: FileVideo, color: 'text-pink-400' },

  // Audio
  mp3: { icon: FileAudio, color: 'text-cyan-500' },
  wav: { icon: FileAudio, color: 'text-cyan-500' },
  flac: { icon: FileAudio, color: 'text-cyan-600' },
  aac: { icon: FileAudio, color: 'text-cyan-500' },
  ogg: { icon: FileAudio, color: 'text-cyan-400' },
  m4a: { icon: FileAudio, color: 'text-cyan-500' },

  // Code
  js: { icon: FileCode, color: 'text-yellow-500' },
  jsx: { icon: FileCode, color: 'text-yellow-500' },
  ts: { icon: FileCode, color: 'text-blue-500' },
  tsx: { icon: FileCode, color: 'text-blue-500' },
  py: { icon: FileCode, color: 'text-blue-400' },
  java: { icon: FileCode, color: 'text-red-400' },
  cpp: { icon: FileCode, color: 'text-blue-600' },
  c: { icon: FileCode, color: 'text-blue-600' },
  h: { icon: FileCode, color: 'text-blue-500' },
  cs: { icon: FileCode, color: 'text-purple-600' },
  go: { icon: FileCode, color: 'text-cyan-600' },
  rs: { icon: FileCode, color: 'text-orange-600' },
  rb: { icon: FileCode, color: 'text-red-500' },
  php: { icon: FileCode, color: 'text-indigo-500' },
  swift: { icon: FileCode, color: 'text-orange-500' },
  kt: { icon: FileCode, color: 'text-purple-500' },
  html: { icon: FileCode, color: 'text-orange-500' },
  css: { icon: FileCode, color: 'text-blue-400' },
  scss: { icon: FileCode, color: 'text-pink-400' },
  sql: { icon: FileCode, color: 'text-amber-500' },
  sh: { icon: FileCode, color: 'text-system-gray-600' },
  bash: { icon: FileCode, color: 'text-system-gray-600' },

  // Data
  json: { icon: FileJson, color: 'text-yellow-600' },
  xml: { icon: FileCode, color: 'text-orange-400' },
  yaml: { icon: FileCode, color: 'text-red-400' },
  yml: { icon: FileCode, color: 'text-red-400' },

  // Archives
  zip: { icon: FileArchive, color: 'text-amber-600' },
  rar: { icon: FileArchive, color: 'text-amber-600' },
  '7z': { icon: FileArchive, color: 'text-amber-600' },
  tar: { icon: FileArchive, color: 'text-amber-500' },
  gz: { icon: FileArchive, color: 'text-amber-500' }
};

// Default for unknown extensions
const DEFAULT_CONFIG = { icon: File, color: 'text-system-gray-400' };

/**
 * Get file extension from filename or path
 */
function getExtension(filename) {
  if (!filename) return '';
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

const FileIcon = memo(function FileIcon({ filename, extension, size = 'md', className = '' }) {
  // Get extension from prop or derive from filename
  const ext = extension || getExtension(filename);
  const config = FILE_TYPE_CONFIG[ext] || DEFAULT_CONFIG;
  const IconComponent = config.icon;

  // Size classes
  const sizeClasses = {
    xs: 'w-3 h-3',
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
    xl: 'w-8 h-8'
  };

  return (
    <IconComponent
      className={`${sizeClasses[size] || sizeClasses.md} ${config.color} shrink-0 ${className}`}
      aria-hidden="true"
    />
  );
});

FileIcon.propTypes = {
  /** Filename or path to derive extension from */
  filename: PropTypes.string,
  /** Explicit file extension (overrides filename) */
  extension: PropTypes.string,
  /** Icon size: xs, sm, md, lg, xl */
  size: PropTypes.oneOf(['xs', 'sm', 'md', 'lg', 'xl']),
  /** Additional CSS classes */
  className: PropTypes.string
};

export default FileIcon;

/**
 * Get the file type category for grouping
 */
export function getFileCategory(filename) {
  const ext = getExtension(filename);

  // Document types
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'md', 'odt'].includes(ext)) {
    return 'Documents';
  }

  // Spreadsheets
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return 'Spreadsheets';
  }

  // Presentations
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return 'Presentations';
  }

  // Images
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'heic'].includes(ext)) {
    return 'Images';
  }

  // Video
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv'].includes(ext)) {
    return 'Videos';
  }

  // Audio
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return 'Audio';
  }

  // Code
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'java',
      'cpp',
      'c',
      'h',
      'cs',
      'go',
      'rs',
      'rb',
      'php',
      'swift',
      'kt',
      'html',
      'css',
      'scss',
      'sql',
      'sh',
      'bash'
    ].includes(ext)
  ) {
    return 'Code';
  }

  // Data
  if (['json', 'xml', 'yaml', 'yml'].includes(ext)) {
    return 'Data';
  }

  // Archives
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return 'Archives';
  }

  return 'Other';
}
