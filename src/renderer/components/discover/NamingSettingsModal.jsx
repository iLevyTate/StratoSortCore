import React, { memo } from 'react';
import PropTypes from 'prop-types';
import Modal from '../ui/Modal';
import NamingSettings from './NamingSettings';
import { Button } from '../ui';
import { Text } from '../ui/Typography';
import { Inline, Stack } from '../layout';

const NamingSettingsModal = memo(function NamingSettingsModal({
  isOpen,
  onClose,
  namingConvention,
  setNamingConvention,
  dateFormat,
  setDateFormat,
  caseConvention,
  setCaseConvention,
  separator,
  setSeparator
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Naming Strategy"
      size="lg"
      closeOnOverlayClick
      footer={
        <Inline className="justify-end" gap="compact" wrap={false}>
          <Button onClick={onClose} variant="primary" size="sm">
            Done
          </Button>
        </Inline>
      }
    >
      <Stack gap="default">
        <Text variant="small" className="text-system-gray-600">
          Configure how StratoSort will rename your files during analysis.
        </Text>

        <NamingSettings
          namingConvention={namingConvention}
          setNamingConvention={setNamingConvention}
          dateFormat={dateFormat}
          setDateFormat={setDateFormat}
          caseConvention={caseConvention}
          setCaseConvention={setCaseConvention}
          separator={separator}
          setSeparator={setSeparator}
        />

        <div className="border-t border-border-soft/70 pt-4 mt-2">
          <Text variant="tiny" className="text-system-gray-500 mb-4">
            <strong>Preview:</strong>{' '}
            <span className="font-mono bg-system-gray-100 px-2 py-1 rounded">
              {namingConvention === 'keep-original'
                ? 'original-filename.ext'
                : `${namingConvention.replace(/-/g, separator || '-')}.ext`}
            </span>
          </Text>
        </div>
      </Stack>
    </Modal>
  );
});

NamingSettingsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  namingConvention: PropTypes.string.isRequired,
  setNamingConvention: PropTypes.func.isRequired,
  dateFormat: PropTypes.string.isRequired,
  setDateFormat: PropTypes.func.isRequired,
  caseConvention: PropTypes.string.isRequired,
  setCaseConvention: PropTypes.func.isRequired,
  separator: PropTypes.string.isRequired,
  setSeparator: PropTypes.func.isRequired
};

export default NamingSettingsModal;
