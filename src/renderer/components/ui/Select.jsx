import React, { forwardRef, useId, useMemo, memo } from 'react';
import PropTypes from 'prop-types';

const Select = memo(
  forwardRef(function Select(
    {
      className = '',
      invalid = false,
      error = '',
      label = '',
      required = false,
      children,
      ...rest
    },
    ref
  ) {
    // Always call useId unconditionally to follow React hooks rules
    const generatedId = useId();
    const id = rest.id || `select-${generatedId}`;
    const errorId = `${id}-error`;

    const classes = useMemo(() => {
      const invalidClass =
        invalid || error ? 'border-stratosort-danger focus:ring-stratosort-danger/20' : '';
      return `form-input-enhanced ${invalidClass} ${className}`.trim();
    }, [invalid, error, className]);

    // If used standalone without label/error, return simple select
    if (!label && !error) {
      return (
        <select
          ref={ref}
          className={classes}
          role="combobox"
          aria-invalid={invalid || !!error}
          aria-required={required}
          {...rest}
        >
          {children}
        </select>
      );
    }

    // Full form field with label and error
    return (
      <div className="flex flex-col gap-2">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-system-gray-700">
            {label}
            {required && (
              <span className="text-stratosort-danger ml-1" aria-label="required">
                *
              </span>
            )}
          </label>
        )}
        <select
          ref={ref}
          id={id}
          className={classes}
          role="combobox"
          aria-invalid={invalid || !!error}
          aria-describedby={error ? errorId : undefined}
          aria-required={required}
          aria-labelledby={label ? id : undefined}
          {...rest}
        >
          {children}
        </select>
        {error && (
          <p id={errorId} className="text-sm text-stratosort-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  })
);

Select.propTypes = {
  className: PropTypes.string,
  invalid: PropTypes.bool,
  error: PropTypes.string,
  label: PropTypes.string,
  required: PropTypes.bool,
  children: PropTypes.node
};

export default Select;
