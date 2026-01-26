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
  pdf: { icon: FileText, color: 'text-stratosort-blue' },
  doc: { icon: FileText, color: 'text-stratosort-blue' },
  docx: { icon: FileText, color: 'text-stratosort-blue' },
  txt: { icon: FileText, color: 'text-system-gray-500' },
  rtf: { icon: FileText, color: 'text-system-gray-500' },
  md: { icon: FileText, color: 'text-system-gray-600' },
  odt: { icon: FileText, color: 'text-stratosort-blue' },

  // Spreadsheets
  xls: { icon: FileSpreadsheet, color: 'text-stratosort-success' },
  xlsx: { icon: FileSpreadsheet, color: 'text-stratosort-success' },
  csv: { icon: FileSpreadsheet, color: 'text-stratosort-success' },
  ods: { icon: FileSpreadsheet, color: 'text-stratosort-success' },

  // Presentations
  ppt: { icon: Presentation, color: 'text-stratosort-warning' },
  pptx: { icon: Presentation, color: 'text-stratosort-warning' },
  odp: { icon: Presentation, color: 'text-stratosort-warning' },

  // Images
  jpg: { icon: FileImage, color: 'text-stratosort-accent' },
  jpeg: { icon: FileImage, color: 'text-stratosort-accent' },
  png: { icon: FileImage, color: 'text-stratosort-accent' },
  gif: { icon: FileImage, color: 'text-stratosort-accent' },
  svg: { icon: FileImage, color: 'text-stratosort-accent' },
  webp: { icon: FileImage, color: 'text-stratosort-accent' },
  bmp: { icon: FileImage, color: 'text-stratosort-accent' },
  ico: { icon: FileImage, color: 'text-stratosort-accent' },
  tiff: { icon: FileImage, color: 'text-stratosort-accent' },
  heic: { icon: FileImage, color: 'text-stratosort-accent' },

  // Video
  mp4: { icon: FileVideo, color: 'text-stratosort-indigo' },
  mov: { icon: FileVideo, color: 'text-stratosort-indigo' },
  avi: { icon: FileVideo, color: 'text-stratosort-indigo' },
  mkv: { icon: FileVideo, color: 'text-stratosort-indigo' },
  webm: { icon: FileVideo, color: 'text-stratosort-indigo' },
  wmv: { icon: FileVideo, color: 'text-stratosort-indigo' },

  // Audio
  mp3: { icon: FileAudio, color: 'text-stratosort-blue' },
  wav: { icon: FileAudio, color: 'text-stratosort-blue' },
  flac: { icon: FileAudio, color: 'text-stratosort-blue' },
  aac: { icon: FileAudio, color: 'text-stratosort-blue' },
  ogg: { icon: FileAudio, color: 'text-stratosort-blue' },
  m4a: { icon: FileAudio, color: 'text-stratosort-blue' },

  // Code
  js: { icon: FileCode, color: 'text-stratosort-indigo' },
  jsx: { icon: FileCode, color: 'text-stratosort-indigo' },
  ts: { icon: FileCode, color: 'text-stratosort-indigo' },
  tsx: { icon: FileCode, color: 'text-stratosort-indigo' },
  py: { icon: FileCode, color: 'text-stratosort-indigo' },
  java: { icon: FileCode, color: 'text-stratosort-indigo' },
  cpp: { icon: FileCode, color: 'text-stratosort-indigo' },
  c: { icon: FileCode, color: 'text-stratosort-indigo' },
  h: { icon: FileCode, color: 'text-stratosort-indigo' },
  cs: { icon: FileCode, color: 'text-stratosort-indigo' },
  go: { icon: FileCode, color: 'text-stratosort-indigo' },
  rs: { icon: FileCode, color: 'text-stratosort-indigo' },
  rb: { icon: FileCode, color: 'text-stratosort-indigo' },
  php: { icon: FileCode, color: 'text-stratosort-indigo' },
  swift: { icon: FileCode, color: 'text-stratosort-indigo' },
  kt: { icon: FileCode, color: 'text-stratosort-indigo' },
  html: { icon: FileCode, color: 'text-stratosort-indigo' },
  css: { icon: FileCode, color: 'text-stratosort-indigo' },
  scss: { icon: FileCode, color: 'text-stratosort-indigo' },
  sql: { icon: FileCode, color: 'text-stratosort-indigo' },
  sh: { icon: FileCode, color: 'text-system-gray-600' },
  bash: { icon: FileCode, color: 'text-system-gray-600' },

  // Data
  json: { icon: FileJson, color: 'text-stratosort-blue' },
  xml: { icon: FileCode, color: 'text-stratosort-blue' },
  yaml: { icon: FileCode, color: 'text-stratosort-blue' },
  yml: { icon: FileCode, color: 'text-stratosort-blue' },

  // Archives
  zip: { icon: FileArchive, color: 'text-stratosort-warning' },
  rar: { icon: FileArchive, color: 'text-stratosort-warning' },
  '7z': { icon: FileArchive, color: 'text-stratosort-warning' },
  tar: { icon: FileArchive, color: 'text-stratosort-warning' },
  gz: { icon: FileArchive, color: 'text-stratosort-warning' }
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
