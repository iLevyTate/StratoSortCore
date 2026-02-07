import React, { useId, useMemo, memo } from 'react';
import PropTypes from 'prop-types';
import Label from './Label';

const Input = memo(function Input({
  className = '',
  invalid = false,
  error = '',
  label = '',
  required = false,
  ref,
  ...rest
}) {
  // Always call useId unconditionally to follow React hooks rules
  const generatedId = useId();
  const id = rest.id || `input-${generatedId}`;
  const errorId = `${id}-error`;

  const classes = useMemo(() => {
    const invalidClass =
      invalid || error ? 'border-stratosort-danger focus:ring-stratosort-danger/20' : '';
    return `form-input-enhanced ${invalidClass} ${className}`.trim();
  }, [invalid, error, className]);

  // If used standalone without label/error, return simple input
  if (!label && !error) {
    return (
      <input
        ref={ref}
        className={classes}
        aria-invalid={invalid || !!error}
        aria-required={required}
        {...rest}
      />
    );
  }

  // Full form field with label and error
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      )}
      <input
        ref={ref}
        id={id}
        className={classes}
        aria-invalid={invalid || !!error}
        aria-describedby={error ? errorId : undefined}
        aria-required={required}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-sm text-stratosort-danger mt-0.5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

Input.propTypes = {
  className: PropTypes.string,
  invalid: PropTypes.bool,
  error: PropTypes.string,
  label: PropTypes.string,
  required: PropTypes.bool
};

export default Input;
