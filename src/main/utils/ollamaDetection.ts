import http from 'http';
import https from 'https';
import { asyncSpawn } from './asyncSpawnUtils';

/**
 * Check if Ollama is installed and available in PATH
 */
export async function isOllamaInstalled(): Promise<boolean> {
  const result = await asyncSpawn('ollama', ['--version'], { timeout: 5000, windowsHide: true });
  return result.status === 0;
}

/**
 * Get installed Ollama version
 */
export async function getOllamaVersion(): Promise<string | null> {
  const result = await asyncSpawn('ollama', ['--version'], { timeout: 5000, windowsHide: true });
  if (result.status === 0) {
    return (result.stdout || result.stderr).trim();
  }
  return null;
}

/**
 * Check if Ollama server is running
 * @param host - Host URL to check (default: http://127.0.0.1:11434)
 */
export async function isOllamaRunning(host: string = 'http://127.0.0.1:11434'): Promise<boolean> {
  try {
    const url = new URL('/api/tags', host);
    return new Promise((resolve) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, (res) => {
        resolve(res.statusCode === 200);
      });
      request.on('error', () => resolve(false));
      request.setTimeout(2000, () => {
        request.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

/**
 * Get list of installed models via CLI
 */
export async function getInstalledModels(): Promise<string[]> {
  try {
    const result = await asyncSpawn('ollama', ['list'], { timeout: 5000, windowsHide: true });
    if (result.status !== 0) return [];

    const lines = result.stdout.split('\n').slice(1);
    const models = lines
      .filter((line: string) => line.trim())
      .map((line: string) => {
        const parts = line.split(/\s+/);
        return parts[0] ? parts[0].toLowerCase() : null;
      })
      .filter(Boolean) as string[];
    return models;
  } catch {
    return [];
  }
}
