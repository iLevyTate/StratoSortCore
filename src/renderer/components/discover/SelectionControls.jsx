import React, { memo } from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';

const SelectionControls = memo(function SelectionControls({
  onSelectFiles,
  onSelectFolder,
  isScanning,
  className = '',
}) {
  return (
    <div className={`flex items-center gap-4 flex-wrap ${className}`}>
      <Button onClick={onSelectFiles} variant="primary" disabled={isScanning}>
        Select Files
      </Button>
      <Button
        onClick={onSelectFolder}
        variant="secondary"
        disabled={isScanning}
      >
        Scan Folder
      </Button>
    </div>
  );
});

SelectionControls.propTypes = {
  onSelectFiles: PropTypes.func.isRequired,
  onSelectFolder: PropTypes.func.isRequired,
  isScanning: PropTypes.bool,
  className: PropTypes.string,
};

export default SelectionControls;
