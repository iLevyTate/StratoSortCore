const activeLockIds = new Set();
let anonymousLockCount = 0;
let savedOverflow = { body: '', main: '' };

function normalizeLockId(lockId) {
  return typeof lockId === 'string' && lockId.trim().length > 0 ? lockId : null;
}

function getTotalLockCount() {
  return activeLockIds.size + anonymousLockCount;
}

export function lockAppScroll(lockId) {
  if (typeof document === 'undefined') return;

  const normalizedLockId = normalizeLockId(lockId);

  if (normalizedLockId) {
    if (activeLockIds.has(normalizedLockId)) {
      return;
    }
    activeLockIds.add(normalizedLockId);
  } else {
    anonymousLockCount += 1;
  }

  if (getTotalLockCount() > 1) return;

  const mainContent = document.getElementById('main-content');
  savedOverflow = {
    body: document.body.style.overflow || '',
    main: mainContent?.style.overflow || ''
  };

  // Keep body lock semantics for compatibility and deterministic behavior.
  document.body.style.overflow = 'hidden';

  // Lock app scroller as well. Keep width stable via CSS scrollbar-gutter.
  if (mainContent) {
    mainContent.style.overflow = 'hidden';
  }
}

export function unlockAppScroll(lockId) {
  if (typeof document === 'undefined') return;
  const normalizedLockId = normalizeLockId(lockId);

  if (normalizedLockId) {
    if (!activeLockIds.has(normalizedLockId)) return;
    activeLockIds.delete(normalizedLockId);
  } else if (anonymousLockCount > 0) {
    anonymousLockCount = Math.max(0, anonymousLockCount - 1);
  } else {
    return;
  }

  if (getTotalLockCount() > 0) return;

  document.body.style.overflow = savedOverflow.body || '';

  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.style.overflow = savedOverflow.main || '';
  }
}
