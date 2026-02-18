export const DEBUG_STORAGE_KEYS = Object.freeze({
  debugMode: 'stratosort:debugMode',
  forceModelWizard: 'stratosort:forceModelWizard'
});

const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isTruthyDebugFlag(value) {
  if (value === null || value === undefined) return false;
  return TRUTHY_FLAG_VALUES.has(String(value).trim().toLowerCase());
}

function readSearchFlag(name) {
  const search = typeof window?.location?.search === 'string' ? window.location.search : '';
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return searchParams.get(name);
}

function readHashFlag(name) {
  const hash = typeof window?.location?.hash === 'string' ? window.location.hash : '';
  const hashQueryStart = hash.indexOf('?');
  if (hashQueryStart < 0) return null;
  const hashParams = new URLSearchParams(hash.slice(hashQueryStart + 1));
  return hashParams.get(name);
}

function readStoredFlag(key) {
  try {
    return isTruthyDebugFlag(window?.localStorage?.getItem(key));
  } catch {
    return false;
  }
}

export function writeStoredFlag(key, enabled) {
  try {
    if (!window?.localStorage) return;
    if (enabled) {
      window.localStorage.setItem(key, '1');
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Best-effort persistence only.
  }
}

export function getStoredDebugModeEnabled() {
  if (process.env.NODE_ENV !== 'development') return false;
  return readStoredFlag(DEBUG_STORAGE_KEYS.debugMode);
}

export function getStoredForceModelWizardEnabled() {
  if (process.env.NODE_ENV !== 'development') return false;
  return readStoredFlag(DEBUG_STORAGE_KEYS.forceModelWizard);
}

export function isDebugModeEnabled() {
  if (process.env.NODE_ENV !== 'development') return false;

  try {
    const globalFlag = window?.__STRATOSORT_DEBUG_MODE__;
    if (globalFlag === true || isTruthyDebugFlag(globalFlag)) return true;

    if (isTruthyDebugFlag(readSearchFlag('debugMode'))) return true;
    if (isTruthyDebugFlag(readHashFlag('debugMode'))) return true;

    return getStoredDebugModeEnabled();
  } catch {
    return false;
  }
}

export function isForceModelWizardEnabled() {
  if (process.env.NODE_ENV !== 'development') return false;

  try {
    const globalFlag = window?.__STRATOSORT_FORCE_MODEL_WIZARD__;
    if (globalFlag === true || isTruthyDebugFlag(globalFlag)) return true;

    if (isTruthyDebugFlag(readSearchFlag('forceModelWizard'))) return true;
    if (isTruthyDebugFlag(readHashFlag('forceModelWizard'))) return true;

    if (!isDebugModeEnabled()) return false;
    return getStoredForceModelWizardEnabled();
  } catch {
    return false;
  }
}
