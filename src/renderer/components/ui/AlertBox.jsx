import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle, Info, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Text } from './Typography';

const VARIANT_STYLES = {
  info: {
    container: 'bg-stratosort-blue/5 border-stratosort-blue/20',
    icon: 'text-stratosort-blue',
    text: 'text-system-gray-600'
  },
  warning: {
    container: 'bg-stratosort-warning/5 border-stratosort-warning/20',
    icon: 'text-stratosort-warning',
    text: 'text-stratosort-warning'
  },
  danger: {
    container: 'bg-stratosort-danger/5 border-stratosort-danger/20',
    icon: 'text-stratosort-danger',
    text: 'text-stratosort-danger'
  },
  success: {
    container: 'bg-stratosort-success/5 border-stratosort-success/20',
    icon: 'text-stratosort-success',
    text: 'text-system-gray-600'
  }
};

const DEFAULT_ICONS = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
  success: CheckCircle2
};

/**
 * AlertBox - Standardized inline alert/notice component.
 * Replaces ad-hoc warning/info/danger boxes scattered across settings and modals.
 *
 * @param {'info'|'warning'|'danger'|'success'} variant - Visual tone
 * @param {React.ElementType} icon - Override the default icon for the variant
 * @param {React.ReactNode} children - Alert content (text or elements)
 * @param {string} className - Additional CSS classes
 */
const AlertBox = memo(function AlertBox({
  variant = 'info',
  icon: IconOverride,
  children,
  className = ''
}) {
  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.info;
  const Icon = IconOverride || DEFAULT_ICONS[variant] || Info;

  return (
    <div
      className={`flex items-start gap-2 p-3 rounded-lg border ${styles.container} ${className}`.trim()}
      role="alert"
    >
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
      <Text as="div" variant="tiny" className={`leading-tight ${styles.text}`}>
        {children}
      </Text>
    </div>
  );
});

AlertBox.propTypes = {
  variant: PropTypes.oneOf(['info', 'warning', 'danger', 'success']),
  icon: PropTypes.elementType,
  children: PropTypes.node.isRequired,
  className: PropTypes.string
};

export default AlertBox;
