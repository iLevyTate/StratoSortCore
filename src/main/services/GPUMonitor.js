// src/main/services/GPUMonitor.js

const { execFile } = require('child_process');
const { promisify } = require('util');
const { createLogger } = require('../../shared/logger');

const execFileAsync = promisify(execFile);

/**
 * Run a shell command asynchronously, returning stdout as string.
 * Swallows errors and returns null on failure.
 */
async function runCommand(cmd, args = [], options = {}) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 5000, ...options });
    return stdout;
  } catch {
    return null;
  }
}

function parseNvidiaSmiGpuInfo(output) {
  if (!output || typeof output !== 'string') return null;
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;

  const [rawName, rawVram] = firstLine.split(',');
  const name = (rawName || '').trim() || 'NVIDIA GPU';
  const vramMB = Number.parseInt((rawVram || '').trim(), 10);
  if (!Number.isFinite(vramMB) || vramMB < 0) {
    return null;
  }

  return {
    type: 'cuda',
    name,
    vramBytes: vramMB * 1024 * 1024,
    vramMB
  };
}

const logger = createLogger('GPUMonitor');

class GPUMonitor {
  constructor() {
    this._platform = process.platform;
    this._gpuInfo = null;
  }

  /**
   * Detect GPU and get info.
   *
   * Results are cached after the first successful detection because GPU
   * hardware does not change during a session.  Pass `{ force: true }` to
   * re-probe (e.g. after a driver update or hot-plug event).
   *
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - Bypass the cache and re-detect
   * @returns {Promise<Object>} GPU info
   */
  async detectGPU(options = {}) {
    if (this._gpuInfo && !options.force) {
      return this._gpuInfo;
    }

    try {
      let info;
      if (this._platform === 'darwin') {
        info = await this._detectMacGPU();
      } else if (this._platform === 'win32') {
        info = await this._detectWindowsGPU();
      } else {
        info = await this._detectLinuxGPU();
      }
      this._gpuInfo = info;
      return info;
    } catch (error) {
      logger.warn('[GPU] Detection failed', error);
      const fallback = { type: 'cpu', name: 'CPU (No GPU detected)' };
      this._gpuInfo = fallback;
      return fallback;
    }
  }

  async _detectMacGPU() {
    try {
      const output = await runCommand('system_profiler', ['SPDisplaysDataType', '-json']);
      if (!output) return { type: 'cpu', name: 'CPU' };
      const data = JSON.parse(output);
      const gpu = data.SPDisplaysDataType?.[0];

      if (gpu?.sppci_model?.toLowerCase().includes('apple')) {
        const memOutput = await runCommand('sysctl', ['hw.memsize']);
        const totalMem = parseInt(memOutput?.split(':')[1]?.trim()) || 0;
        const vramEstimate = Math.round(totalMem * 0.75);

        return {
          type: 'metal',
          name: gpu.sppci_model,
          vramBytes: vramEstimate,
          vramMB: Math.round(vramEstimate / 1024 / 1024),
          isAppleSilicon: true
        };
      }

      return {
        type: 'metal',
        name: gpu?.sppci_model || 'Unknown GPU',
        vramBytes: parseInt(gpu?.sppci_vram) * 1024 * 1024 || 0,
        vramMB: parseInt(gpu?.sppci_vram) || 0,
        isAppleSilicon: false
      };
    } catch {
      return { type: 'cpu', name: 'CPU' };
    }
  }

  async _detectWindowsGPU() {
    // Try nvidia-smi first
    const nvidiaSmi = await runCommand('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader,nounits'
    ]);
    if (nvidiaSmi) {
      const parsedNvidia = parseNvidiaSmiGpuInfo(nvidiaSmi);
      if (parsedNvidia) {
        return parsedNvidia;
      }
    }

    // wmic is deprecated and often returns empty/malformed data for integrated GPUs
    const ps = await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json'
    ]);

    if (ps) {
      try {
        const data = JSON.parse(ps);
        // Handle single object or array of objects
        const gpus = Array.isArray(data) ? data : [data];

        let bestGPU = null;
        let maxRAM = -1;

        for (const gpu of gpus) {
          // capped at ~4GB. Values of 0 or exactly 4294967295 (0xFFFFFFFF)
          // typically indicate truncation for GPUs with >4GB VRAM. In that
          // case, fall through to nvidia-smi or report 0 rather than a
          // misleading number.
          let ramBytes = parseInt(gpu.AdapterRAM) || 0;
          if (ramBytes === 4294967295 || ramBytes < 0) {
            // Truncated uint32 -- treat as unknown
            ramBytes = 0;
            logger.debug('[GPUMonitor] AdapterRAM truncated (uint32 overflow), reporting 0', {
              name: gpu.Name,
              rawValue: gpu.AdapterRAM
            });
          }
          if (ramBytes > maxRAM) {
            maxRAM = ramBytes;
            bestGPU = {
              type: 'vulkan', // Assume Vulkan/DirectX capable
              name: gpu.Name || 'Unknown GPU',
              vramBytes: ramBytes,
              vramMB: Math.round(ramBytes / 1024 / 1024)
            };
          }
        }
        if (bestGPU) return bestGPU;
      } catch (e) {
        logger.debug('[GPUMonitor] PowerShell JSON parse failed', { error: e.message });
      }
    }

    // Fall back to WMIC with CSV format for robust parsing (legacy support)
    const wmic = await runCommand('wmic', [
      'path',
      'win32_VideoController',
      'get',
      'name,adapterram',
      '/format:csv'
    ]);

    if (wmic) {
      // WMIC CSV output: Node,AdapterRAM,Name (alphabetical column order)
      const lines = wmic
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.trim());

      let bestGPU = null;
      let maxRAM = -1;

      for (const line of lines) {
        // Skip header or invalid lines
        if (!line.includes(',') || line.toLowerCase().includes('adapterram')) continue;

        const parts = line.split(',');
        // Node, AdapterRAM, Name
        if (parts.length < 3) continue;

        const ramStr = parts[1];
        const name = parts.slice(2).join(','); // Name might contain commas
        const ramBytes = parseInt(ramStr);

        if (!isNaN(ramBytes) && ramBytes > maxRAM) {
          maxRAM = ramBytes;
          bestGPU = {
            type: 'vulkan', // Assume Vulkan/DirectX capable if visible to OS
            name: name || 'Unknown GPU',
            vramBytes: ramBytes,
            vramMB: Math.round(ramBytes / 1024 / 1024)
          };
        }
      }

      if (bestGPU) return bestGPU;
    }

    return { type: 'cpu', name: 'CPU' };
  }

  async _detectLinuxGPU() {
    // Try nvidia-smi
    const nvidiaSmi = await runCommand('nvidia-smi', [
      '--query-gpu=name,memory.total',
      '--format=csv,noheader,nounits'
    ]);
    if (nvidiaSmi) {
      const parsedNvidia = parseNvidiaSmiGpuInfo(nvidiaSmi);
      if (parsedNvidia) {
        return parsedNvidia;
      }
    }

    // Try lspci for AMD/Intel
    const lspci = await runCommand('lspci', [], { shell: true });
    if (lspci) {
      const vgaLine = lspci.split('\n').find((l) => /vga/i.test(l));
      if (vgaLine) {
        return {
          type: 'vulkan',
          name: vgaLine.split(':').pop()?.trim() || 'Unknown GPU',
          vramBytes: 0,
          vramMB: 0
        };
      }
    }

    return { type: 'cpu', name: 'CPU' };
  }

  /**
   * Get current GPU memory usage (NVIDIA only)
   */
  async getGPUMemoryUsage() {
    if (this._platform !== 'win32' && this._platform !== 'linux') {
      // macOS doesn't have easy VRAM monitoring
      return null;
    }

    const output = await runCommand('nvidia-smi', [
      '--query-gpu=memory.used,memory.total',
      '--format=csv,noheader,nounits'
    ]);
    if (!output) return null;

    const [used, total] = output
      .trim()
      .split(',')
      .map((s) => parseInt(s.trim()));

    // reporting 0 MB used would incorrectly return null with `!used`.
    if (isNaN(used) || isNaN(total) || total <= 0) return null;

    return {
      usedMB: used,
      totalMB: total,
      percentUsed: Math.round((used / total) * 100)
    };
  }
}

// Singleton
let instance = null;
function getInstance() {
  if (!instance) {
    instance = new GPUMonitor();
  }
  return instance;
}

module.exports = { GPUMonitor, getInstance };
