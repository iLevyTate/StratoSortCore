import React from 'react';
import PropTypes from 'prop-types';
import Card from '../ui/Card';
import { Text } from '../ui/Typography';

/**
 * Consistent settings section card wrapper.
 * Ensures all settings cards share the same structure, spacing, and typography.
 */
function SettingsCard({ title, description, headerAction, children, className = '' }) {
  return (
    <Card variant="default" className={`settings-card rounded-xl space-y-6 ${className}`.trim()}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <Text
            variant="tiny"
            className="font-semibold uppercase tracking-wide text-system-gray-500"
          >
            {title}
          </Text>
          <Text variant="small" className="text-system-gray-600 mt-1">
            {description}
          </Text>
        </div>
        {headerAction && (
          <div className="flex flex-shrink-0 items-center gap-2">{headerAction}</div>
        )}
      </div>
      {children}
    </Card>
  );
}

SettingsCard.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  headerAction: PropTypes.node,
  children: PropTypes.node.isRequired,
  className: PropTypes.string
};

export default SettingsCard;
