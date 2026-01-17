const DEFAULT_NOTIFICATION = {
  severity: 'error',
  duration: 5000
};

const ERROR_TYPE_MAP = {
  TIMEOUT: {
    severity: 'warning',
    message: 'Operation timed out. Please try again.'
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
  OLLAMA_ERROR: {
    severity: 'error',
    message: 'AI service error. Check Ollama status and try again.'
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

export function mapErrorToNotification({ error, errorType, operationType } = {}) {
  const typeKey = typeof errorType === 'string' ? errorType.toUpperCase() : null;
  const mapped = typeKey ? ERROR_TYPE_MAP[typeKey] : null;
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
