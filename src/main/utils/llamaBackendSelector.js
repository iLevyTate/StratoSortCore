const normalizeGpuType = (gpuInfo) => {
  if (!gpuInfo || typeof gpuInfo.type !== 'string') return null;
  return gpuInfo.type.toLowerCase();
};

function buildBackendCandidates(gpuInfo) {
  const gpuType = normalizeGpuType(gpuInfo);
  if (gpuType === 'cuda') return ['cuda', 'auto'];
  if (gpuType === 'metal') return ['metal', 'auto'];
  if (gpuType === 'vulkan') return ['vulkan', 'auto'];
  return ['auto'];
}

async function initLlamaWithBackend({ getLlama, gpuInfo, logger, context }) {
  const log = logger || console;
  const candidates = buildBackendCandidates(gpuInfo);
  const attempted = [];

  for (const backend of candidates) {
    try {
      const llama = await getLlama({ gpu: backend });
      const actualBackend = llama?.gpu || (backend === 'auto' ? 'cpu' : backend);
      attempted.push({ backend, success: true, actualBackend });

      log.info(`[${context}] Llama backend selected`, {
        requested: backend,
        actual: actualBackend,
        detectedGpu: gpuInfo?.name || gpuInfo?.type || 'unknown',
        attempted: attempted.map((entry) => ({
          backend: entry.backend,
          success: entry.success,
          actualBackend: entry.actualBackend,
          error: entry.error
        }))
      });

      return {
        llama,
        backend: actualBackend,
        selection: {
          attempted,
          selected: actualBackend,
          requested: backend,
          detectedGpu: gpuInfo || null
        }
      };
    } catch (error) {
      attempted.push({
        backend,
        success: false,
        error: error?.message || String(error || 'Unknown error')
      });
      log.warn(`[${context}] Llama backend init failed`, {
        backend,
        error: error?.message || String(error || 'Unknown error')
      });
    }
  }

  // GPU init failed for all candidates, fall back to CPU explicitly
  try {
    const llama = await getLlama({ gpu: false });
    attempted.push({ backend: 'cpu', success: true, actualBackend: 'cpu' });
    log.warn(`[${context}] Falling back to CPU backend`, {
      detectedGpu: gpuInfo?.name || gpuInfo?.type || 'unknown',
      attempted: attempted.map((entry) => ({
        backend: entry.backend,
        success: entry.success,
        actualBackend: entry.actualBackend,
        error: entry.error
      }))
    });
    return {
      llama,
      backend: 'cpu',
      selection: {
        attempted,
        selected: 'cpu',
        requested: 'cpu',
        detectedGpu: gpuInfo || null
      }
    };
  } catch (error) {
    const fatalError = new Error(
      `Failed to initialize Llama backend (attempted: ${attempted
        .map((entry) => entry.backend)
        .join(', ')})`
    );
    fatalError.attempts = attempted;
    fatalError.originalError = error;
    throw fatalError;
  }
}

module.exports = {
  buildBackendCandidates,
  initLlamaWithBackend
};
