import React, { memo } from 'react';
import PropTypes from 'prop-types';

/**
 * SelectionCard - Standardized interactive selection card.
 * Use for radio-style choices (profile pickers, mode selectors, etc.)
 * that are styled as clickable cards with a clear selected/unselected state.
 *
 * Renders as a `<button>` by default. Set `as="label"` with a hidden radio input
 * inside `children` for form-based radio groups.
 *
 * @param {boolean} selected - Whether this card is currently selected
 * @param {Function} onSelect - Click handler
 * @param {boolean} disabled - Whether interaction is disabled
 * @param {'button'|'label'} as - Root element type
 * @param {string} className - Additional CSS classes
 * @param {React.ReactNode} children - Card content
 */
const SelectionCard = memo(function SelectionCard({
  selected = false,
  onSelect,
  disabled = false,
  as: Component = 'button',
  className = '',
  children,
  ...rest
}) {
  const selectedClasses = selected
    ? 'border-stratosort-blue bg-stratosort-blue/5 ring-1 ring-stratosort-blue/20'
    : 'border-border-soft bg-surface-primary hover:border-system-gray-300';

  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

  const buttonProps =
    Component === 'button'
      ? { type: 'button', onClick: onSelect, disabled }
      : { onClick: !disabled ? onSelect : undefined };

  return (
    <Component
      className={`text-left rounded-xl border p-4 ${selectedClasses} ${disabledClasses} focus:outline-none focus-visible:ring-2 focus-visible:ring-stratosort-blue focus-visible:ring-offset-2 ${className}`.trim()}
      style={{
        transitionProperty: 'background-color, border-color, box-shadow, color, opacity',
        transitionDuration: 'var(--motion-duration-fast)',
        transitionTimingFunction: 'var(--motion-ease-standard)'
      }}
      {...buttonProps}
      {...rest}
    >
      {children}
    </Component>
  );
});

SelectionCard.propTypes = {
  selected: PropTypes.bool,
  onSelect: PropTypes.func,
  disabled: PropTypes.bool,
  as: PropTypes.elementType,
  className: PropTypes.string,
  children: PropTypes.node.isRequired
};

export default SelectionCard;
