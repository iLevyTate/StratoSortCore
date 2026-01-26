import React from 'react';
import PropTypes from 'prop-types';
import { cx } from './classNames';

/**
 * ActionBar - standardized footer action area (uses existing `.page-action-bar` styles).
 */
export default function ActionBar({ as: Comp = 'div', className, children, ...rest }) {
  return (
    <Comp className={cx('page-action-bar', className)} {...rest}>
      {children}
    </Comp>
  );
}

ActionBar.propTypes = {
  as: PropTypes.elementType,
  className: PropTypes.string,
  children: PropTypes.node
};
