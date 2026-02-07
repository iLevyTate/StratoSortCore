import React, { useId } from 'react';
import PropTypes from 'prop-types';
import Label from './Label';

function Textarea({
  className = '',
  invalid = false,
  error = '',
  label = '',
  required = false,
  autoExpand = false,
  ref,
  ...rest
}) {
  // Always call useId unconditionally to follow React hooks rules
  const generatedId = useId();
  const id = rest.id || `textarea-${generatedId}`;
  const errorId = `${id}-error`;

  const invalidClass =
    invalid || error ? 'border-stratosort-danger focus:ring-stratosort-danger/20' : '';
  const autoExpandClass = autoExpand ? 'auto-expand' : '';
  const classes = `form-textarea-enhanced ${invalidClass} ${autoExpandClass} ${className}`.trim();

  // If used standalone without label/error, return simple textarea
  if (!label && !error) {
    return <textarea ref={ref} className={classes} aria-invalid={invalid || !!error} {...rest} />;
  }

  // Full form field with label and error
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
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
        <p id={errorId} className="text-sm text-stratosort-danger mt-0.5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

Textarea.propTypes = {
  className: PropTypes.string,
  invalid: PropTypes.bool,
  error: PropTypes.string,
  label: PropTypes.string,
  required: PropTypes.bool,
  autoExpand: PropTypes.bool
};

export default Textarea;
