let lockCount = 0;
let savedOverflow = { body: '', main: '' };
let savedPaddingRight = { body: '', main: '' };

/** Get viewport scrollbar width (fallback target). */
function getViewportScrollbarWidth() {
  if (typeof document === 'undefined') return 0;
  return window.innerWidth - document.documentElement.clientWidth;
}

/** Get element scrollbar width to reserve space and prevent layout shift. */
function getElementScrollbarWidth(element) {
  if (!element) return 0;
  return Math.max(0, element.offsetWidth - element.clientWidth);
}

export function lockAppScroll(_lockId) {
  if (typeof document === 'undefined') return;

  lockCount += 1;
  if (lockCount > 1) return;

  const mainContent = document.getElementById('main-content');
  savedOverflow = {
    body: document.body.style.overflow || '',
    main: mainContent?.style.overflow || ''
  };
  savedPaddingRight = {
    body: document.body.style.paddingRight || '',
    main: mainContent?.style.paddingRight || ''
  };

  // Keep body lock semantics for compatibility and deterministic behavior.
  document.body.style.overflow = 'hidden';

  // Prefer locking the app scroller itself to avoid viewport width jumps.
  if (mainContent) {
    const scrollbarWidth = getElementScrollbarWidth(mainContent);
    mainContent.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      mainContent.style.paddingRight = `${scrollbarWidth}px`;
    }
    return;
  }

  // Fallback for early boot or non-standard layouts.
  const scrollbarWidth = getViewportScrollbarWidth();
  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }
}

export function unlockAppScroll(_lockId) {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) return;

  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;

  document.body.style.overflow = savedOverflow.body || '';
  document.body.style.paddingRight = savedPaddingRight.body || '';

  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.style.overflow = savedOverflow.main || '';
    mainContent.style.paddingRight = savedPaddingRight.main || '';
  }
}
