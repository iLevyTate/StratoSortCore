/**
 * ID Utilities
 *
 * Shared utility functions for generating unique identifiers.
 * FIX C-5: Extracted to separate module to break circular import between
 * batchProcessor.js and fileProcessor.js.
 *
 * @module autoOrganize/idUtils
 */

const crypto = require('crypto');

/**
 * Generates a secure unique identifier with prefix
 * Uses cryptographically secure random bytes for uniqueness
 *
 * @param {string} prefix - Identifier prefix (e.g., 'file', 'batch', 'op')
 * @returns {string} Unique identifier in format: prefix-timestamp-randomhex
 * @example
 * generateSecureId('batch') // => 'batch-1704067200000-a1b2c3d4e5f6'
 */
const generateSecureId = (prefix = 'id') => {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(6).toString('hex');
  return `${prefix}-${timestamp}-${randomBytes}`;
};

module.exports = { generateSecureId };
