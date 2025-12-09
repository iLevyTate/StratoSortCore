import React from 'react';
import PropTypes from 'prop-types';

// Animation configuration constants
const ANIMATION_CONFIG = {
  DELAY_INCREMENT: 0.1, // Seconds between skeleton animation delays
  DEFAULT_FILE_COUNT: 5, // Default number of file skeletons to show
  DEFAULT_FOLDER_COUNT: 6, // Default number of folder skeletons to show
};

/**
 * LoadingSkeleton component for displaying placeholder content while data loads
 * @param {string} className - Additional CSS classes
 * @param {string} variant - Type of skeleton to display
 * @param {number} count - Number of skeletons to render
 */
const LoadingSkeleton = ({
  className = '',
  variant = 'default',
  count = 1,
}) => {
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
    folder: 'h-20 w-full rounded-[var(--radius-lg)]',
  };

  const skeletons = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={`${baseClasses} ${variantClasses[variant] || variantClasses.default} ${className}`}
      aria-hidden="true"
      style={{ animationDelay: `${i * ANIMATION_CONFIG.DELAY_INCREMENT}s` }}
    />
  ));

  return count > 1 ? (
    <div className="space-y-2">{skeletons}</div>
  ) : (
    skeletons[0]
  );
};

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
    'folder',
  ]),
  count: PropTypes.number,
};

/**
 * Composite loading state for file list UI
 * @param {number} count - Number of skeleton items to display
 */
export const FileListSkeleton = ({
  count = ANIMATION_CONFIG.DEFAULT_FILE_COUNT,
}) => (
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

FileListSkeleton.propTypes = {
  count: PropTypes.number,
};

/**
 * Composite loading state for folder grid UI
 * @param {number} count - Number of skeleton items to display
 */
export const FolderGridSkeleton = ({
  count = ANIMATION_CONFIG.DEFAULT_FOLDER_COUNT,
}) => (
  <div
    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    role="status"
    aria-label="Loading folders"
  >
    {Array.from({ length: count }, (_, i) => (
      <div
        key={i}
        className="p-4 bg-white rounded-xl border border-border-soft"
      >
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

FolderGridSkeleton.propTypes = {
  count: PropTypes.number,
};

export const AnalysisProgressSkeleton = () => (
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

/**
 * Composite loading state for smart folder list UI (vertical list layout)
 * @param {number} count - Number of skeleton items to display
 */
export const SmartFolderListSkeleton = ({
  count = ANIMATION_CONFIG.DEFAULT_FOLDER_COUNT,
}) => (
  <div className="space-y-8" role="status" aria-label="Loading smart folders">
    {Array.from({ length: count }, (_, i) => (
      <div
        key={i}
        className="p-13 bg-surface-muted rounded-lg border border-border-soft"
      >
        <div className="flex items-start justify-between gap-8">
          <div className="flex-1 min-w-0">
            <LoadingSkeleton className="w-3/4 mb-2" />
            <LoadingSkeleton variant="text" className="w-full mb-3" />
            <div className="text-sm bg-stratosort-blue/5 p-8 rounded-lg border-l-4 border-stratosort-blue/30">
              <LoadingSkeleton className="w-1/4 mb-2" />
              <LoadingSkeleton variant="text" className="w-2/3" />
            </div>
          </div>
          <div className="flex items-center gap-8 shrink-0">
            <div className="flex items-center gap-5">
              <LoadingSkeleton
                variant="avatar"
                className="w-3 h-3 rounded-full"
              />
              <LoadingSkeleton className="w-12 h-4" />
            </div>
            <div className="flex gap-5">
              <LoadingSkeleton variant="button" className="w-8 h-8 rounded" />
              <LoadingSkeleton variant="button" className="w-8 h-8 rounded" />
              <LoadingSkeleton variant="button" className="w-8 h-8 rounded" />
              <LoadingSkeleton variant="button" className="w-8 h-8 rounded" />
            </div>
          </div>
        </div>
      </div>
    ))}
    <span className="sr-only">Loading smart folder list...</span>
  </div>
);

SmartFolderListSkeleton.propTypes = {
  count: PropTypes.number,
};

// Alias for backward compatibility - now uses vertical list skeleton
export const SmartFolderSkeleton = SmartFolderListSkeleton;

// Enhanced loading spinner for lazy-loaded components
export const LazyLoadingSpinner = ({ message = 'Loading...' }) => (
  <div
    className="flex items-center justify-center py-21"
    role="status"
    aria-label={message}
  >
    <div className="text-center">
      <div className="animate-spin w-13 h-13 border-4 border-stratosort-blue border-t-transparent rounded-full mx-auto mb-8"></div>
      <p className="text-system-gray-700">{message}</p>
      <span className="sr-only">{message}</span>
    </div>
  </div>
);

LazyLoadingSpinner.propTypes = {
  message: PropTypes.string,
};

// Modal loading overlay for lazy-loaded modals/panels
export const ModalLoadingOverlay = ({ message = 'Loading...' }) => (
  <div
    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-modal"
    role="status"
    aria-label={message}
  >
    <div className="bg-white rounded-lg shadow-xl p-21 text-center">
      <div className="animate-spin w-13 h-13 border-4 border-stratosort-blue border-t-transparent rounded-full mx-auto mb-8"></div>
      <p className="text-system-gray-700">{message}</p>
      <span className="sr-only">{message}</span>
    </div>
  </div>
);

ModalLoadingOverlay.propTypes = {
  message: PropTypes.string,
};

export default LoadingSkeleton;
