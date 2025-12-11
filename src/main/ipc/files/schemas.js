/**
 * Zod Validation Schemas for File Operations
 *
 * @module ipc/files/schemas
 */

let z;
try {
  z = require('zod');
} catch {
  z = null;
}

/**
 * Create file operation schemas if Zod is available
 * @returns {Object|null} Schemas object or null if Zod unavailable
 */
function createSchemas() {
  if (!z) return null;

  return {
    stringSchema: z.string().min(1),
    operationSchema: z.object({
      type: z.enum(['move', 'copy', 'delete', 'batch_organize']),
      source: z.string().optional(),
      destination: z.string().optional(),
      operations: z
        .array(
          z.object({
            source: z.string(),
            destination: z.string(),
            type: z.string().optional()
          })
        )
        .optional()
    })
  };
}

const schemas = createSchemas();

module.exports = {
  z,
  schemas,
  stringSchema: schemas?.stringSchema || null,
  operationSchema: schemas?.operationSchema || null
};
