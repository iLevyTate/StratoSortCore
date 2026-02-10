import React from 'react';
import PropTypes from 'prop-types';
import { cx } from '../layout/classNames';

/**
 * Consistent wrapper for grouped settings content within a card.
 * Use for nested blocks (e.g. confidence slider, mode picker, danger zone).
 * Ensures same border, background, rounding, and padding across all settings sections.
 */
function SettingsGroup({ children, className = '', gap = 'default' }) {
  const gapClass =
    gap === 'compact'
      ? 'space-y-2'
      : gap === 'cozy'
        ? 'space-y-3'
        : gap === 'spacious'
          ? 'space-y-6'
          : 'space-y-4';

  return (
    <div
      className={cx(
        'rounded-xl border border-border-soft bg-surface-muted p-4',
        gapClass,
        className
      )}
    >
      {children}
    </div>
  );
}

SettingsGroup.propTypes = {
  children: PropTypes.node.isRequired,
  className: PropTypes.string,
  gap: PropTypes.oneOf(['compact', 'cozy', 'default', 'spacious'])
};

export default SettingsGroup;
