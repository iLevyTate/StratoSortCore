import React, { memo } from 'react';
import PropTypes from 'prop-types';
import Card from './Card';
import { Heading, Text } from './Typography';

const TONE_STYLES = {
  neutral: {
    iconWrapper: 'bg-system-gray-100',
    icon: 'text-system-gray-500',
    title: 'text-system-gray-900',
    description: 'text-system-gray-500'
  },
  info: {
    iconWrapper: 'bg-stratosort-blue/10',
    icon: 'text-stratosort-blue',
    title: 'text-system-gray-900',
    description: 'text-system-gray-600'
  },
  success: {
    iconWrapper: 'bg-stratosort-success/15',
    icon: 'text-stratosort-success',
    title: 'text-system-gray-900',
    description: 'text-system-gray-600'
  },
  warning: {
    iconWrapper: 'bg-stratosort-warning/15',
    icon: 'text-stratosort-warning',
    title: 'text-system-gray-900',
    description: 'text-system-gray-600'
  },
  error: {
    iconWrapper: 'bg-stratosort-danger/10',
    icon: 'text-stratosort-danger',
    title: 'text-system-gray-900',
    description: 'text-system-gray-600'
  }
};

const INVERSE_TONE_STYLES = {
  neutral: {
    iconWrapper: 'bg-white/10',
    icon: 'text-system-gray-200',
    title: 'text-system-gray-100',
    description: 'text-system-gray-400'
  },
  info: {
    iconWrapper: 'bg-stratosort-blue/20',
    icon: 'text-stratosort-blue/90',
    title: 'text-system-gray-100',
    description: 'text-system-gray-400'
  },
  success: {
    iconWrapper: 'bg-stratosort-success/20',
    icon: 'text-stratosort-success/90',
    title: 'text-system-gray-100',
    description: 'text-system-gray-400'
  },
  warning: {
    iconWrapper: 'bg-stratosort-warning/20',
    icon: 'text-stratosort-warning/90',
    title: 'text-system-gray-100',
    description: 'text-system-gray-400'
  },
  error: {
    iconWrapper: 'bg-stratosort-danger/20',
    icon: 'text-stratosort-danger/90',
    title: 'text-system-gray-100',
    description: 'text-system-gray-400'
  }
};

const SURFACE_TONE_STYLES = {
  default: TONE_STYLES,
  inverse: INVERSE_TONE_STYLES
};

const SIZE_STYLES = {
  sm: {
    iconWrapper: 'w-8 h-8',
    icon: 'w-4 h-4',
    gap: 'gap-2',
    textGap: 'gap-1',
    titleVariant: 'h6',
    descriptionVariant: 'tiny'
  },
  md: {
    iconWrapper: 'w-10 h-10',
    icon: 'w-5 h-5',
    gap: 'gap-3',
    textGap: 'gap-1',
    titleVariant: 'h6',
    descriptionVariant: 'small'
  },
  lg: {
    iconWrapper: 'w-12 h-12',
    icon: 'w-6 h-6',
    gap: 'gap-4',
    textGap: 'gap-2',
    titleVariant: 'h5',
    descriptionVariant: 'small'
  }
};

const CARD_VARIANTS = {
  neutral: 'default',
  info: 'default',
  success: 'success',
  warning: 'warning',
  error: 'error'
};

const StateMessage = memo(function StateMessage({
  icon: Icon,
  title,
  description,
  tone = 'neutral',
  size = 'md',
  align = 'center',
  variant = 'plain',
  surface = 'default',
  action,
  children,
  className = '',
  contentClassName = '',
  ...rest
}) {
  const surfaceStyles = SURFACE_TONE_STYLES[surface] || SURFACE_TONE_STYLES.default;
  const toneStyles = surfaceStyles[tone] || surfaceStyles.neutral;
  const sizeStyles = SIZE_STYLES[size] || SIZE_STYLES.md;
  const alignClasses = align === 'left' ? 'items-start text-left' : 'items-center text-center';
  const contentClasses = ['flex flex-col', alignClasses, sizeStyles.gap, contentClassName]
    .filter(Boolean)
    .join(' ');

  const content = (
    <div className={contentClasses}>
      {Icon && (
        <div
          className={`flex items-center justify-center rounded-full ${toneStyles.iconWrapper} ${sizeStyles.iconWrapper}`}
        >
          <Icon className={`${sizeStyles.icon} ${toneStyles.icon}`} />
        </div>
      )}
      <div
        className={`flex flex-col ${
          align === 'left' ? 'items-start' : 'items-center'
        } ${sizeStyles.textGap}`}
      >
        <Heading as="h3" variant={sizeStyles.titleVariant} className={toneStyles.title}>
          {title}
        </Heading>
        {description ? (
          <Text variant={sizeStyles.descriptionVariant} className={toneStyles.description}>
            {description}
          </Text>
        ) : null}
      </div>
      {children}
      {action ? <div className={align === 'left' ? 'pt-1' : 'pt-2'}>{action}</div> : null}
    </div>
  );

  if (variant === 'card') {
    const cardVariant = CARD_VARIANTS[tone] || CARD_VARIANTS.neutral;
    return (
      <Card variant={cardVariant} className={className} {...rest}>
        {content}
      </Card>
    );
  }

  return (
    <div className={className} {...rest}>
      {content}
    </div>
  );
});

StateMessage.propTypes = {
  icon: PropTypes.elementType,
  title: PropTypes.node.isRequired,
  description: PropTypes.node,
  tone: PropTypes.oneOf(['neutral', 'info', 'success', 'warning', 'error']),
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  align: PropTypes.oneOf(['center', 'left']),
  variant: PropTypes.oneOf(['plain', 'card']),
  surface: PropTypes.oneOf(['default', 'inverse']),
  action: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
  contentClassName: PropTypes.string
};

export default StateMessage;
