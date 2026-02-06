import { ERROR_CODES as AI_ERROR_CODES } from '../../shared/errorCodes';

const DEFAULT_NOTIFICATION = {
  severity: 'error',
  duration: 5000
};

const ERROR_TYPE_MAP = {
  TIMEOUT: {
    severity: 'warning',
    message: 'Operation timed out. Please try again.'
  },
  IPC_TIMEOUT: {
    severity: 'warning',
    message: 'The AI is busy processing other requests. Please try again shortly.'
  },
  RATE_LIMITED: {
    severity: 'warning',
    message: 'Too many requests. Please wait a moment and try again.'
  },
  CIRCUIT_OPEN: {
    severity: 'warning',
    message: 'AI service is temporarily recovering. Please wait a moment and try again.'
  },
  HANDLER_NOT_READY: {
    severity: 'warning',
    message: 'Service is still starting up. Please wait a moment and try again.'
  },
  NETWORK: {
    severity: 'warning',
    message: 'Network error. Check your connection and try again.'
  },
  FILE_NOT_FOUND: {
    severity: 'error',
    message: 'File not found. It may have been moved or deleted.'
  },
  MODEL_NOT_FOUND: {
    severity: 'error',
    message: 'Required model is missing. Install the model and retry.'
  },
  AI_ENGINE_ERROR: {
    severity: 'error',
    message: 'AI service error. Check model status and try again.'
  },
  OUT_OF_MEMORY: {
    severity: 'error',
    message: 'Out of memory. Try a smaller file or reduce concurrency.'
  },
  FILE_TOO_LARGE: {
    severity: 'warning',
    message: 'File too large to process with current limits.'
  },
  PERMISSION_DENIED: {
    severity: 'error',
    message: 'Permission denied. Check file access permissions.'
  },
  UNSUPPORTED_FORMAT: {
    severity: 'warning',
    message: 'Unsupported file format.'
  }
};

const ERROR_CODE_MAP = {
  [AI_ERROR_CODES.LLAMA_MODEL_LOAD_FAILED]: {
    severity: 'error',
    message: 'Failed to load AI model. Please re-download the model and try again.'
  },
  [AI_ERROR_CODES.LLAMA_MODEL_NOT_FOUND]: {
    severity: 'error',
    message: 'AI model not found. Install or select a model and retry.'
  },
  [AI_ERROR_CODES.LLAMA_INFERENCE_FAILED]: {
    severity: 'error',
    message: 'AI inference failed. Please try again.'
  },
  [AI_ERROR_CODES.LLAMA_GPU_ERROR]: {
    severity: 'warning',
    message: 'GPU error detected. The app will retry using CPU.'
  },
  [AI_ERROR_CODES.LLAMA_OOM]: {
    severity: 'error',
    message: 'Out of memory. Try a smaller file or reduce concurrency.'
  },
  [AI_ERROR_CODES.VECTOR_DB_INIT_FAILED]: {
    severity: 'error',
    message: 'Vector database failed to initialize. Please restart the app.'
  },
  [AI_ERROR_CODES.VECTOR_DB_PERSIST_FAILED]: {
    severity: 'warning',
    message: 'Failed to save embeddings. Recent changes may not persist.'
  },
  [AI_ERROR_CODES.VECTOR_DB_QUERY_FAILED]: {
    severity: 'error',
    message: 'Search failed. Please try again.'
  },
  [AI_ERROR_CODES.VECTOR_DB_DIMENSION_MISMATCH]: {
    severity: 'warning',
    message: 'Embedding model changed. Rebuild embeddings in Settings.'
  },
  [AI_ERROR_CODES.EMBEDDING_GENERATION_FAILED]: {
    severity: 'error',
    message: 'Failed to generate embeddings. Please try again.'
  },
  [AI_ERROR_CODES.ANALYSIS_FAILED]: {
    severity: 'error',
    message: 'Analysis failed. Please try again.'
  },
  [AI_ERROR_CODES.MIGRATION_FAILED]: {
    severity: 'error',
    message: 'Migration failed. Please restart the app or check logs.'
  }
};

/**
 * Classify raw error strings into known error types.
 */
function classifyError(errorStr) {
  if (!errorStr || typeof errorStr !== 'string') return null;
  if (errorStr.includes('IPC timeout')) return 'IPC_TIMEOUT';
  if (errorStr.includes('Rate limit exceeded')) return 'RATE_LIMITED';
  if (errorStr.includes('circuit breaker open') || errorStr.includes('temporarily unavailable'))
    return 'CIRCUIT_OPEN';
  if (errorStr.includes('No handler registered')) return 'HANDLER_NOT_READY';
  if (errorStr.includes('timed out')) return 'TIMEOUT';
  return null;
}

export function mapErrorToNotification({ error, errorType, errorCode, operationType } = {}) {
  const typeKey = typeof errorType === 'string' ? errorType.toUpperCase() : null;
  const codeKey =
    typeof errorCode === 'string'
      ? errorCode
      : typeof error?.code === 'string'
        ? error.code
        : typeof error?.errorCode === 'string'
          ? error.errorCode
          : null;
  const inferred = !typeKey
    ? classifyError(typeof error === 'string' ? error : error?.message)
    : null;
  const mapped =
    (codeKey ? ERROR_CODE_MAP[codeKey] : null) ||
    ERROR_TYPE_MAP[typeKey] ||
    (inferred ? ERROR_TYPE_MAP[inferred] : null);
  const baseMessage =
    mapped?.message || (typeof error === 'string' && error.trim()) || 'Operation failed.';
  const severity = mapped?.severity || DEFAULT_NOTIFICATION.severity;
  const prefix = operationType ? `${operationType} failed: ` : '';
  return {
    message: `${prefix}${baseMessage}`,
    severity,
    duration: DEFAULT_NOTIFICATION.duration
  };
}
