import React from 'react';
import PropTypes from 'prop-types';

/**
 * IconButton - Standardized icon button component
 * Provides consistent styling for icon-only buttons across the app
 *
 * @param {ReactNode} icon - The icon to display (can be SVG, emoji, or icon component)
 * @param {string} size - The button size (sm, md, lg)
 * @param {string} variant - The button variant (default, primary, secondary, ghost)
 * @param {string} className - Additional CSS classes
 */
const IconButton = ({
  icon,
  size = 'md',
  variant = 'default',
  className = '',
  ...props
}) => {
  const sizeClasses = {
    sm: 'h-8 w-8 text-sm',
    md: 'h-10 w-10 text-base',
    lg: 'h-12 w-12 text-lg',
  };

  const variantClasses = {
    default: 'bg-white border border-system-gray-200 text-system-gray-600 hover:text-stratosort-blue hover:border-stratosort-blue hover:shadow-md',
    primary: 'bg-stratosort-blue text-white hover:bg-stratosort-blue/90 shadow-sm hover:shadow-md',
    secondary: 'bg-white/90 border border-border-soft text-system-gray-700 hover:bg-system-gray-50 hover:border-system-gray-300 shadow-sm',
    ghost: 'text-system-gray-600 hover:bg-system-gray-100 hover:text-system-gray-900',
  };

  return (
    <button
      className={`
        inline-flex items-center justify-center
        rounded-2xl transition-all [transition-duration:var(--duration-normal)]
        focus:outline-none focus:ring-2 focus:ring-stratosort-blue/80 focus:ring-offset-2
        disabled:opacity-50 disabled:cursor-not-allowed
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${className}
      `}
      {...props}
    >
      {icon}
    </button>
  );
};

IconButton.propTypes = {
  icon: PropTypes.node.isRequired,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  variant: PropTypes.oneOf(['default', 'primary', 'secondary', 'ghost']),
  className: PropTypes.string,
};

export default IconButton;
