import React from 'react';
import PropTypes from 'prop-types';

/**
 * Standard layout for a setting row.
 * Displays label and description on the left, and the control (switch, input, etc.) on the right/bottom.
 */
function SettingRow({ label, description, children, className = '', layout = 'row' }) {
  // layout 'row' puts control on the right (good for switches)
  // layout 'col' puts control below description (good for inputs/selects)

  return (
    <div
      className={`flex ${layout === 'row' ? 'flex-row items-center justify-between gap-4' : 'flex-col gap-2'} ${className}`}
    >
      <div className={`${layout === 'row' ? 'flex-1' : ''} min-w-0`}>
        {label && <h3 className="text-sm font-medium text-system-gray-900">{label}</h3>}
        {description && <p className="text-sm text-system-gray-500 mt-1">{description}</p>}
      </div>
      <div className={layout === 'row' ? 'flex-shrink-0' : 'w-full max-w-md'}>{children}</div>
    </div>
  );
}

SettingRow.propTypes = {
  label: PropTypes.node,
  description: PropTypes.node,
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
  layout: PropTypes.oneOf(['row', 'col'])
};

export default SettingRow;
