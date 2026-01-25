import React, { memo } from 'react';
import PropTypes from 'prop-types';

const Label = memo(function Label({
  htmlFor,
  required = false,
  className = '',
  children,
  ...rest
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`block text-sm font-medium text-system-gray-700 mb-1.5 ${className}`.trim()}
      {...rest}
    >
      {children}
      {required && (
        <span className="text-stratosort-danger ml-1" aria-label="required">
          *
        </span>
      )}
    </label>
  );
});

Label.propTypes = {
  htmlFor: PropTypes.string,
  required: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node
};

export default Label;
