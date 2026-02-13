const { LLAMA } = require('../../shared/performanceConstants');
const { getModel } = require('../../shared/modelRegistry');

const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_HEADROOM_RATIO = 0.9;

function estimateTokens(text, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  if (!text) return 0;
  const safe = typeof text === 'string' ? text : String(text);
  const divisor = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(safe.length / divisor);
}

function getEmbeddingTokenLimit(explicitLimit, modelName) {
  let base = LLAMA.CONTEXT_EMBEDDINGS || 512;

  if (typeof explicitLimit === 'number' && explicitLimit > 0) {
    base = explicitLimit;
  } else if (modelName) {
    const modelInfo = getModel(modelName);
    if (modelInfo?.contextLength) {
      base = modelInfo.contextLength;
    }
  }

  return Math.max(32, Math.floor(base * DEFAULT_HEADROOM_RATIO));
}

function truncateToTokenLimit(text, maxTokens, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const safe = typeof text === 'string' ? text : String(text || '');
  const maxChars = Math.max(0, Math.floor(maxTokens * charsPerToken));
  if (safe.length <= maxChars) {
    return { text: safe, wasTruncated: false, maxChars };
  }
  return { text: safe.slice(0, maxChars), wasTruncated: true, maxChars };
}

function capEmbeddingInput(text, options = {}) {
  const maxTokens = getEmbeddingTokenLimit(options.maxTokens, options.modelName);
  const estimatedTokens = estimateTokens(text, options.charsPerToken);
  const capped = truncateToTokenLimit(text, maxTokens, options.charsPerToken);
  return {
    text: capped.text,
    wasTruncated: capped.wasTruncated,
    estimatedTokens,
    maxTokens,
    maxChars: capped.maxChars
  };
}

module.exports = {
  capEmbeddingInput,
  estimateTokens,
  getEmbeddingTokenLimit,
  truncateToTokenLimit
};
