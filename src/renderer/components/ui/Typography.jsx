import React, { memo } from 'react';
import PropTypes from 'prop-types';

const HEADING_VARIANTS = {
  h1: 'text-4xl font-bold tracking-tight text-system-gray-900',
  h2: 'text-3xl font-semibold tracking-tight text-system-gray-900',
  h3: 'text-2xl font-semibold text-system-gray-900',
  h4: 'text-xl font-medium text-system-gray-900',
  h5: 'text-lg font-medium text-system-gray-900',
  h6: 'text-base font-medium text-system-gray-900',
  display:
    'text-display font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-stratosort-blue to-stratosort-indigo'
};

export const Heading = memo(function Heading({
  as: Component = 'h2',
  variant,
  className = '',
  children,
  ...rest
}) {
  // If variant is not provided, default to the tag name (e.g. h1 -> h1 style)
  // If tag is not a heading tag, default to h2 style
  const styleVariant = variant || (HEADING_VARIANTS[Component] ? Component : 'h2');
  const classes = `${HEADING_VARIANTS[styleVariant] || HEADING_VARIANTS.h2} ${className}`.trim();

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
});

Heading.propTypes = {
  as: PropTypes.elementType,
  variant: PropTypes.oneOf(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'display']),
  className: PropTypes.string,
  children: PropTypes.node
};

const TEXT_VARIANTS = {
  body: 'text-base text-system-gray-700 leading-relaxed',
  small: 'text-sm text-system-gray-600',
  tiny: 'text-xs text-system-gray-500',
  lead: 'text-lg text-system-gray-600 leading-relaxed',
  mono: 'font-mono text-sm text-system-gray-700'
};

export const Text = memo(function Text({
  as: Component = 'p',
  variant = 'body',
  className = '',
  children,
  ...rest
}) {
  const classes = `${TEXT_VARIANTS[variant] || TEXT_VARIANTS.body} ${className}`.trim();

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
});

Text.propTypes = {
  as: PropTypes.elementType,
  variant: PropTypes.oneOf(['body', 'small', 'tiny', 'lead', 'mono']),
  className: PropTypes.string,
  children: PropTypes.node
};

export const Caption = memo(function Caption({ className = '', children, ...rest }) {
  return (
    <Text
      as="span"
      variant="tiny"
      className={`uppercase tracking-wider font-semibold ${className}`}
      {...rest}
    >
      {children}
    </Text>
  );
});

Caption.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node
};

export const Code = memo(function Code({ className = '', children, ...rest }) {
  return (
    <code
      className={`font-mono text-sm bg-system-gray-100 text-stratosort-indigo px-1.5 py-0.5 rounded-md ${className}`}
      {...rest}
    >
      {children}
    </code>
  );
});

Code.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node
};
