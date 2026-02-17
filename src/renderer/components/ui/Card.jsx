import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';

const VARIANT_TO_CLASS = {
  default: 'surface-card p-4 sm:p-6 shadow-sm border border-system-gray-200/60',
  static: 'bg-white rounded-xl border border-system-gray-200 p-4 sm:p-6',
  compact: 'surface-card p-3 sm:p-4 shadow-sm border border-system-gray-200/60',
  elevated: 'surface-card shadow-lg border border-system-gray-100 p-4 sm:p-6',
  hero: 'glass-panel rounded-2xl shadow-2xl border border-white/40 p-6 sm:p-8 backdrop-blur-xl bg-white/70',
  success:
    'bg-gradient-to-br from-success-muted to-success-muted/90 border border-stratosort-success/30 rounded-xl p-4 sm:p-6 shadow-sm',
  error:
    'bg-gradient-to-br from-danger-muted to-danger-muted/90 border border-stratosort-danger/30 rounded-xl p-4 sm:p-6 shadow-sm',
  warning:
    'bg-gradient-to-br from-warning-muted to-warning-muted/90 border border-stratosort-warning/30 rounded-xl p-4 sm:p-6 shadow-sm',
  interactive:
    'surface-card p-4 sm:p-6 shadow-sm border border-system-gray-200/60 hover:shadow-md cursor-pointer'
};

const Card = memo(function Card({
  as: Component = 'div',
  variant = 'default',
  className = '',
  children,
  ...rest
}) {
  const classes = useMemo(() => {
    const variantClass = VARIANT_TO_CLASS[variant] || VARIANT_TO_CLASS.default;
    return `${variantClass} ${className}`.trim();
  }, [variant, className]);

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
});

export default Card;

Card.propTypes = {
  as: PropTypes.elementType,
  variant: PropTypes.oneOf([
    'default',
    'static',
    'compact',
    'elevated',
    'hero',
    'success',
    'error',
    'warning',
    'interactive'
  ]),
  className: PropTypes.string,
  children: PropTypes.node
};
