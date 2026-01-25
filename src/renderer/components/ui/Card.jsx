import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';

const VARIANT_TO_CLASS = {
  default: 'surface-card p-6 shadow-sm border border-system-gray-200/60',
  static: 'bg-white rounded-xl border border-system-gray-200 p-6',
  compact: 'surface-card p-4 shadow-sm border border-system-gray-200/60',
  elevated: 'surface-card shadow-lg border border-system-gray-100',
  hero: 'glass-panel rounded-2xl shadow-2xl border border-white/40 p-8 backdrop-blur-xl bg-white/70',
  success:
    'bg-gradient-to-br from-emerald-50 to-green-50 border border-stratosort-success/30 rounded-xl p-6 shadow-sm',
  error:
    'bg-gradient-to-br from-red-50 to-rose-50 border border-stratosort-danger/30 rounded-xl p-6 shadow-sm',
  warning:
    'bg-gradient-to-br from-amber-50 to-yellow-50 border border-stratosort-warning/30 rounded-xl p-6 shadow-sm',
  interactive:
    'surface-card p-6 shadow-sm border border-system-gray-200/60 transition-all duration-200 hover:scale-[1.01] hover:shadow-md cursor-pointer active:scale-[0.99]'
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
