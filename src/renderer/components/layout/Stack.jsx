import React from 'react';
import PropTypes from 'prop-types';
import { cx } from './classNames';

/**
 * Stack - vertical layout helper with tokenized gaps.
 */
export default function Stack({ as: Comp = 'div', gap = 'default', className, children, ...rest }) {
  const gapClass =
    gap === 'compact'
      ? 'gap-compact'
      : gap === 'cozy'
        ? 'gap-cozy'
        : gap === 'relaxed'
          ? 'gap-relaxed'
          : gap === 'spacious'
            ? 'gap-spacious'
            : 'gap-default';

  return (
    <Comp className={cx('flex flex-col', gapClass, className)} {...rest}>
      {children}
    </Comp>
  );
}

Stack.propTypes = {
  as: PropTypes.elementType,
  gap: PropTypes.oneOf(['compact', 'cozy', 'default', 'relaxed', 'spacious']),
  className: PropTypes.string,
  children: PropTypes.node
};
