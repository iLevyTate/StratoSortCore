import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';

const VARIANT_TO_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  success: 'btn-success',
  danger: 'btn-danger',
  warning: 'btn-warning',
  info: 'btn-info',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  subtle: 'btn-subtle'
};

// Size variants - sm size uses px-3 py-1.5 for compact buttons in file action rows
const SIZE_TO_CLASS = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-base px-6 py-2.5',
  lg: 'text-lg px-8 py-3'
};

const Spinner = memo(function Spinner({ className = '' }) {
  return (
    <svg
      className={`animate-spin h-4 w-4 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
});
Spinner.propTypes = {
  className: PropTypes.string
};

const Button = memo(function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  type = 'button',
  isLoading = false,
  disabled = false,
  leftIcon = null,
  rightIcon = null,
  'aria-label': ariaLabel,
  ...rest
}) {
  const classes = useMemo(() => {
    const variantClass = VARIANT_TO_CLASS[variant] || VARIANT_TO_CLASS.primary;
    const sizeClass = SIZE_TO_CLASS[size] || SIZE_TO_CLASS.md;
    // FIX: Loading state keeps full opacity (shows spinner), disabled state uses opacity-50
    const stateClass = disabled ? 'opacity-50 cursor-not-allowed' : isLoading ? 'cursor-wait' : '';
    // Accessibility: Add focus-visible ring for keyboard navigation
    const focusClass =
      'focus-visible:ring-2 focus-visible:ring-stratosort-blue focus-visible:ring-offset-2 focus-visible:outline-none';
    return `${variantClass} ${sizeClass} ${focusClass} ${stateClass} ${className}`.trim();
  }, [variant, size, disabled, isLoading, className]);

  // Bug #39: Ensure button has accessible label
  const accessibleLabel = ariaLabel || (typeof children === 'string' ? children : undefined);

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || isLoading}
      role="button"
      aria-busy={isLoading}
      aria-disabled={disabled || isLoading}
      aria-label={accessibleLabel}
      {...rest}
    >
      {isLoading && <Spinner className="button-icon" />}
      {!isLoading && leftIcon && (
        <span className="button-icon" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {children}
      {!isLoading && rightIcon && (
        <span className="button-icon" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </button>
  );
});

export default Button;

Button.propTypes = {
  variant: PropTypes.oneOf([
    'primary',
    'secondary',
    'success',
    'danger',
    'warning',
    'info',
    'ghost',
    'outline',
    'subtle'
  ]),
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  className: PropTypes.string,
  children: PropTypes.node,
  type: PropTypes.string,
  isLoading: PropTypes.bool,
  disabled: PropTypes.bool,
  leftIcon: PropTypes.node,
  rightIcon: PropTypes.node,
  'aria-label': PropTypes.string
};
