import React from 'react';
import PropTypes from 'prop-types';

/**
 * LoadingSkeleton component for displaying placeholder content while data loads
 * @param {string} className - Additional CSS classes
 * @param {string} variant - Type of skeleton to display
 * @param {number} count - Number of skeletons to render
 */
export function LoadingSkeleton({ className = '', variant = 'default', count = 1 }) {
  const baseClasses =
    'animate-pulse bg-gradient-to-r from-system-gray-100 to-system-gray-200 rounded';

  const variantClasses = {
    default: 'h-4 w-full',
    title: 'h-8 w-3/4',
    text: 'h-3 w-full',
    card: 'h-32 w-full rounded-[var(--radius-md)]',
    avatar: 'h-12 w-12 rounded-[var(--radius-full)]',
    button: 'h-10 w-24 rounded-[var(--radius-md)]',
    input: 'h-10 w-full rounded-[var(--radius-md)]',
    file: 'h-16 w-full rounded-[var(--radius-md)]',
    folder: 'h-20 w-full rounded-[var(--radius-lg)]'
  };

  const skeletons = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={`${baseClasses} ${variantClasses[variant] || variantClasses.default} ${className}`}
      aria-hidden="true"
      style={{ animationDelay: `${i * 0.1}s` }}
    />
  ));

  return count > 1 ? <div className="space-y-2">{skeletons}</div> : skeletons[0];
}

LoadingSkeleton.propTypes = {
  className: PropTypes.string,
  variant: PropTypes.oneOf([
    'default',
    'title',
    'text',
    'card',
    'avatar',
    'button',
    'input',
    'file',
    'folder'
  ]),
  count: PropTypes.number
};

// Animation configuration constants
export const ANIMATION_CONFIG = {
  DELAY_INCREMENT: 0.1,
  DEFAULT_FILE_COUNT: 5,
  DEFAULT_FOLDER_COUNT: 6
};

/**
 * Composite loading state for file list UI
 * @param {number} count - Number of skeleton items to display
 */
export function FileListSkeleton({ count = ANIMATION_CONFIG.DEFAULT_FILE_COUNT }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading files">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 bg-white rounded-lg border border-border-soft"
        >
          <LoadingSkeleton variant="avatar" />
          <div className="flex-1 space-y-2">
            <LoadingSkeleton className="w-2/3" />
            <LoadingSkeleton variant="text" className="w-1/3" />
          </div>
          <LoadingSkeleton variant="button" />
        </div>
      ))}
      <span className="sr-only">Loading file list...</span>
    </div>
  );
}

FileListSkeleton.propTypes = {
  count: PropTypes.number
};

/**
 * Composite loading state for folder grid UI
 * @param {number} count - Number of skeleton items to display
 */
export function FolderGridSkeleton({ count = ANIMATION_CONFIG.DEFAULT_FOLDER_COUNT }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      role="status"
      aria-label="Loading folders"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="p-4 bg-white rounded-xl border border-border-soft">
          <LoadingSkeleton variant="folder" />
          <div className="mt-3 space-y-2">
            <LoadingSkeleton className="w-3/4" />
            <LoadingSkeleton variant="text" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading folder list...</span>
    </div>
  );
}

FolderGridSkeleton.propTypes = {
  count: PropTypes.number
};

export function AnalysisProgressSkeleton() {
  return (
    <div
      className="p-6 bg-white rounded-xl border border-border-soft shadow-sm"
      role="status"
      aria-label="Loading analysis"
    >
      <div className="flex items-center justify-between mb-4">
        <LoadingSkeleton variant="title" className="w-1/3" />
        <LoadingSkeleton variant="button" />
      </div>
      <div className="space-y-3">
        <LoadingSkeleton className="h-2 w-full rounded-full" />
        <div className="flex justify-between">
          <LoadingSkeleton variant="text" className="w-20" />
          <LoadingSkeleton variant="text" className="w-20" />
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border-soft">
        <LoadingSkeleton variant="text" className="w-2/3" />
      </div>
      <span className="sr-only">Loading analysis progress...</span>
    </div>
  );
}

/**
 * Composite loading state for smart folder list UI (mirrors card grid layout)
 * @param {number} count - Number of skeleton items to display
 * @param {boolean} compact - Render compact row-style skeletons
 */
export function SmartFolderListSkeleton({
  count = ANIMATION_CONFIG.DEFAULT_FOLDER_COUNT,
  compact = false
}) {
  const gridShell = (children) => (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-6"
      role="status"
      aria-label="Loading smart folders"
    >
      {children}
      <span className="sr-only">Loading smart folder list...</span>
    </div>
  );

  if (compact) {
    return gridShell(
      Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="group flex items-center bg-white/70 rounded-xl border border-border-soft/60 shadow-sm animate-pulse h-full"
          style={{ padding: 'var(--spacing-cozy)', gap: 'var(--spacing-cozy)' }}
        >
          <div className="h-10 w-10 rounded-xl bg-stratosort-blue/10" />
          <div className="flex-1 min-w-0 space-y-2">
            <LoadingSkeleton className="w-3/4" />
            <LoadingSkeleton variant="text" className="w-1/2" />
          </div>
          <div className="w-4 h-4 rounded-full bg-system-gray-200" />
        </div>
      ))
    );
  }

  return gridShell(
    Array.from({ length: count }, (_, i) => (
      <div
        key={i}
        className="bg-white/70 rounded-xl border border-border-soft/60 shadow-sm animate-pulse flex flex-col"
        style={{ padding: 'var(--spacing-default)', gap: 'var(--spacing-cozy)' }}
      >
        <div className="flex items-start justify-between" style={{ gap: 'var(--spacing-cozy)' }}>
          <div className="flex items-start" style={{ gap: 'var(--spacing-cozy)' }}>
            <div className="h-12 w-12 rounded-xl bg-stratosort-blue/10" />
            <div className="space-y-2 w-full max-w-[14rem]">
              <LoadingSkeleton className="w-3/4" />
              <LoadingSkeleton variant="text" className="w-full" />
            </div>
          </div>
          <LoadingSkeleton className="w-20 h-6 rounded-full" />
        </div>

        <div className="bg-stratosort-blue/5 rounded-xl border border-stratosort-blue/10 p-4 space-y-2">
          <LoadingSkeleton className="w-1/3" />
          <LoadingSkeleton variant="text" className="w-2/3" />
        </div>

        <div
          className="flex items-center justify-between border-t border-border-soft/50"
          style={{ gap: 'var(--spacing-cozy)', paddingTop: 'var(--spacing-cozy)' }}
        >
          <div className="flex items-center" style={{ gap: 'var(--spacing-compact)' }}>
            <LoadingSkeleton variant="button" className="w-10 h-10 rounded-xl" />
            <LoadingSkeleton variant="button" className="w-10 h-10 rounded-xl" />
            <LoadingSkeleton variant="button" className="w-10 h-10 rounded-xl" />
          </div>
          <LoadingSkeleton variant="button" className="w-10 h-10 rounded-xl" />
        </div>
      </div>
    ))
  );
}

SmartFolderListSkeleton.propTypes = {
  count: PropTypes.number,
  compact: PropTypes.bool
};

// Alias for backward compatibility - now uses vertical list skeleton
export const SmartFolderSkeleton = SmartFolderListSkeleton;

// Enhanced loading spinner for lazy-loaded components
export function LazyLoadingSpinner({ message = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center py-12" role="status" aria-label={message}>
      <div className="text-center">
        <div className="animate-spin w-12 h-12 border-4 border-stratosort-blue border-t-transparent rounded-full mx-auto mb-8" />
        <p className="text-system-gray-700">{message}</p>
        <span className="sr-only">{message}</span>
      </div>
    </div>
  );
}

LazyLoadingSpinner.propTypes = {
  message: PropTypes.string
};

// Modal loading overlay for lazy-loaded modals/panels
// Uses fade-in animation to prevent jarring black flash during Suspense loads
export function ModalLoadingOverlay({ message = 'Loading...' }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-modal animate-modal-backdrop"
      role="status"
      aria-label={message}
    >
      <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-center animate-modal-enter">
        <div className="animate-spin w-10 h-10 border-3 border-stratosort-blue border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-sm text-system-gray-600">{message}</p>
        <span className="sr-only">{message}</span>
      </div>
    </div>
  );
}

ModalLoadingOverlay.propTypes = {
  message: PropTypes.string
};
