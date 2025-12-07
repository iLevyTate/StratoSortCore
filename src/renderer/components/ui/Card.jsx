import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';

const VARIANT_TO_CLASS = {
  default:
    'bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] hover:shadow-md hover:border-border-strong/60 transition-all duration-200 backdrop-blur-sm',
  compact:
    'bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[calc(var(--panel-padding)*0.75)] hover:shadow-md hover:border-border-strong/60 transition-all duration-200 backdrop-blur-sm',
  elevated:
    'bg-surface-primary rounded-xl border border-border-soft shadow-lg p-[var(--panel-padding)] transition-all duration-200 backdrop-blur-sm',
  hero: 'glass-medium rounded-2xl shadow-2xl border border-white/30 p-[calc(var(--panel-padding)*1.35)]',
  success:
    'bg-gradient-to-br from-emerald-50 to-green-50 border-stratosort-success/30 rounded-xl p-[var(--panel-padding)] shadow-sm ring-1 ring-stratosort-success/10',
  error:
    'bg-gradient-to-br from-red-50 to-rose-50 border-stratosort-accent/30 rounded-xl p-[var(--panel-padding)] shadow-sm ring-1 ring-stratosort-accent/10',
  warning:
    'bg-gradient-to-br from-amber-50 to-yellow-50 border-stratosort-warning/30 rounded-xl p-[var(--panel-padding)] shadow-sm ring-1 ring-stratosort-warning/10',
  interactive:
    'bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] transition-transform duration-150 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] backdrop-blur-sm',
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
