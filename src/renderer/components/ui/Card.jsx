import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';

const VARIANT_TO_CLASS = {
  default:
    'bg-surface-primary rounded-xl border border-border-light shadow-sm p-6 xl:p-21 2xl:p-26 hover:shadow-md hover:border-border-medium transition-all duration-200 backdrop-blur-sm',
  compact:
    'bg-surface-primary rounded-xl border border-border-light shadow-sm p-4 xl:p-13 2xl:p-15 hover:shadow-md hover:border-border-medium transition-all duration-200 backdrop-blur-sm',
  elevated:
    'bg-surface-primary rounded-xl border border-border-light shadow-lg p-6 xl:p-21 2xl:p-26 transition-all duration-200 backdrop-blur-sm',
  hero: 'glass-medium rounded-2xl shadow-2xl border border-white/30 p-8 xl:p-34 2xl:p-42',
  success:
    'bg-gradient-to-br from-emerald-50 to-green-50 border-stratosort-success/30 rounded-xl p-6 xl:p-21 2xl:p-26 shadow-sm ring-1 ring-stratosort-success/10',
  error:
    'bg-gradient-to-br from-red-50 to-rose-50 border-stratosort-accent/30 rounded-xl p-6 xl:p-21 2xl:p-26 shadow-sm ring-1 ring-stratosort-accent/10',
  warning:
    'bg-gradient-to-br from-amber-50 to-yellow-50 border-stratosort-warning/30 rounded-xl p-6 xl:p-21 2xl:p-26 shadow-sm ring-1 ring-stratosort-warning/10',
  interactive:
    'bg-surface-primary rounded-xl border border-border-light shadow-sm p-6 xl:p-21 2xl:p-26 transition-transform duration-150 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] backdrop-blur-sm',
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
