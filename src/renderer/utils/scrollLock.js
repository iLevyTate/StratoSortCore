let lockCount = 0;
let savedOverflow = { body: '', main: '' };
let savedPaddingRight = { body: '', main: '' };

/** Get the scrollbar width to reserve space and prevent layout shift when overflow:hidden hides it */
function getScrollbarWidth() {
  if (typeof document === 'undefined') return 0;
  return window.innerWidth - document.documentElement.clientWidth;
}

export function lockAppScroll() {
  if (typeof document === 'undefined') return;

  lockCount += 1;
  if (lockCount > 1) return;

  const mainContent = document.getElementById('main-content');
  const scrollbarWidth = getScrollbarWidth();

  savedOverflow = {
    body: document.body.style.overflow || '',
    main: mainContent?.style.overflow || ''
  };
  savedPaddingRight = {
    body: document.body.style.paddingRight || '',
    main: mainContent?.style.paddingRight || ''
  };

  document.body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }
  if (mainContent) {
    mainContent.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      mainContent.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
}

export function unlockAppScroll() {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) return;

  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;

  const mainContent = document.getElementById('main-content');
  document.body.style.overflow = savedOverflow.body || '';
  document.body.style.paddingRight = savedPaddingRight.body || '';
  if (mainContent) {
    mainContent.style.overflow = savedOverflow.main || '';
    mainContent.style.paddingRight = savedPaddingRight.main || '';
  }
}
