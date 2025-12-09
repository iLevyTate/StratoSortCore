import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';

const VARIANT_TO_CLASS = {
  default:
    'surface-card',
  compact:
    'surface-card p-[calc(var(--panel-padding)*0.75)]',
  elevated:
    'surface-card shadow-lg',
  hero:
    'glass-panel rounded-2xl shadow-2xl border border-white/30 p-[calc(var(--panel-padding)*1.35)]',
  success:
    'bg-gradient-to-br from-emerald-50 to-green-50 border border-stratosort-success/30 rounded-xl p-[var(--panel-padding)] shadow-sm',
  error:
    'bg-gradient-to-br from-red-50 to-rose-50 border border-stratosort-danger/30 rounded-xl p-[var(--panel-padding)] shadow-sm',
  warning:
    'bg-gradient-to-br from-amber-50 to-yellow-50 border border-stratosort-warning/30 rounded-xl p-[var(--panel-padding)] shadow-sm',
  interactive:
    'surface-card transition-transform [transition-duration:var(--duration-fast)] hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]',
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
    'compact',
    'elevated',
    'hero',
    'success',
    'error',
    'warning',
    'interactive',
  ]),
  className: PropTypes.string,
  children: PropTypes.node,
};
