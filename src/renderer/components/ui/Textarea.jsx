import React, { forwardRef, useId } from 'react';
import PropTypes from 'prop-types';

const Textarea = forwardRef(function Textarea(
  {
    className = '',
    invalid = false,
    error = '',
    label = '',
    required = false,
    autoExpand = false,
    ...rest
  },
  ref,
) {
  // Always call useId unconditionally to follow React hooks rules
  const generatedId = useId();
  const id = rest.id || `textarea-${generatedId}`;
  const errorId = `${id}-error`;

  const invalidClass =
    invalid || error
      ? 'border-stratosort-danger focus:ring-stratosort-danger/15'
      : '';
  const autoExpandClass = autoExpand ? 'auto-expand' : '';
  const classes =
    `form-textarea-enhanced ${invalidClass} ${autoExpandClass} ${className}`.trim();

  // If used standalone without label/error, return simple textarea
  if (!label && !error) {
    return (
      <textarea
        ref={ref}
        className={classes}
        aria-invalid={invalid || !!error}
        {...rest}
      />
    );
  }

  // Full form field with label and error
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-system-gray-700"
        >
          {label}
          {required && (
            <span className="text-stratosort-danger ml-1" aria-label="required">
              *
            </span>
          )}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        className={classes}
        aria-invalid={invalid || !!error}
        aria-describedby={error ? errorId : undefined}
        aria-required={required}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-sm text-stratosort-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

Textarea.propTypes = {
  className: PropTypes.string,
  invalid: PropTypes.bool,
  error: PropTypes.string,
  label: PropTypes.string,
  required: PropTypes.bool,
  autoExpand: PropTypes.bool,
};

export default Textarea;
