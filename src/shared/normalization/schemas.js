let z;
try {
  z = require('zod');
} catch {
  z = null;
}

const analysisResultSchema = z
  ? z.object({
      subject: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      tags: z.array(z.string()).nullable().optional(),
      confidence: z.number().optional(),
      summary: z.string().nullable().optional(),
      extractedText: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      processingTime: z.number().optional(),
      smartFolder: z.string().nullable().optional(),
      newName: z.string().nullable().optional(),
      renamed: z.boolean().optional(),
      // Extended fields for richer document/image conversations
      documentType: z.string().nullable().optional(),
      entity: z.string().nullable().optional(),
      project: z.string().nullable().optional(),
      purpose: z.string().nullable().optional(),
      reasoning: z.string().nullable().optional(),
      documentDate: z.string().nullable().optional(),
      keyEntities: z.array(z.string()).nullable().optional(),
      extractionMethod: z.string().nullable().optional(),
      // Image-specific fields
      content_type: z.string().nullable().optional(),
      has_text: z.boolean().nullable().optional(),
      colors: z.array(z.string()).nullable().optional()
    })
  : null;

const embeddingMetaSchema = z
  ? z
      .object({
        path: z.string().optional(),
        name: z.string().optional(),
        category: z.string().optional(),
        subject: z.string().optional(),
        summary: z.string().optional(),
        purpose: z.string().optional(),
        tags: z.union([z.array(z.string()), z.string()]).optional(),
        keywords: z.union([z.array(z.string()), z.string()]).optional(),
        type: z.string().optional(),
        confidence: z.number().optional(),
        fileExtension: z.string().optional(),
        fileSize: z.number().optional(),
        // Extended fields for document conversations
        entity: z.string().optional(),
        project: z.string().optional(),
        documentType: z.string().optional(),
        extractedText: z.string().optional(),
        extractionMethod: z.string().optional()
      })
      .passthrough()
  : null;

const chunkMetaSchema = z
  ? z
      .object({
        fileId: z.string().min(1),
        path: z.string().optional(),
        name: z.string().optional(),
        chunkIndex: z.number().int().optional(),
        charStart: z.number().optional(),
        charEnd: z.number().optional(),
        snippet: z.string().optional(),
        model: z.string().optional()
      })
      .passthrough()
  : null;

function validateSchema(schema, data) {
  if (!schema || !z) return { valid: true, data };
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { valid: false, error: parsed.error, data };
  }
  return { valid: true, data: parsed.data };
}

module.exports = {
  z,
  analysisResultSchema,
  embeddingMetaSchema,
  chunkMetaSchema,
  validateSchema
};
