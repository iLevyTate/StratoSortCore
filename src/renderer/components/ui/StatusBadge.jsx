import React from 'react';
import PropTypes from 'prop-types';

/**
 * StatusBadge - Standardized status indicator component
 * Provides consistent styling for status indicators across the app
 *
 * @param {string} variant - The status variant (success, warning, error, info)
 * @param {ReactNode} children - The content to display
 * @param {boolean} animated - Whether to show pulse animation
 * @param {string} className - Additional CSS classes
 */
function StatusBadge({
  variant = 'info',
  size = 'md',
  children,
  animated = false,
  className = ''
}) {
  const variantClasses = {
    success: 'bg-stratosort-success/10 text-stratosort-success border-stratosort-success/50',
    warning: 'bg-stratosort-warning/10 text-stratosort-warning border-stratosort-warning/50',
    error: 'bg-stratosort-danger/10 text-stratosort-danger border-stratosort-danger/50',
    info: 'bg-stratosort-blue/10 text-stratosort-blue border-stratosort-blue/45'
  };
  const sizeClasses = {
    sm: 'text-xs px-2.5 py-1',
    md: 'text-sm px-3.5 py-2'
  };

  return (
    <div
      className={`
        inline-flex items-center gap-2 rounded-full
        font-medium border leading-tight
        ${variantClasses[variant] || variantClasses.info}
        ${sizeClasses[size] || sizeClasses.md}
        ${className}
      `}
    >
      {animated && <span className="w-2.5 h-2.5 rounded-full bg-current animate-pulse" />}
      {children}
    </div>
  );
}

StatusBadge.propTypes = {
  variant: PropTypes.oneOf(['success', 'warning', 'error', 'info']),
  size: PropTypes.oneOf(['sm', 'md']),
  children: PropTypes.node,
  animated: PropTypes.bool,
  className: PropTypes.string
};

export default StatusBadge;
