import React from 'react';
import PropTypes from 'prop-types';
import { Check, Pencil } from 'lucide-react';
import Button from '../ui/Button';
import Select from '../ui/Select';
import { Inline, Stack } from '../layout';

function BulkOperations({
  total,
  selectedCount,
  onSelectAll,
  onApproveSelected,
  bulkEditMode,
  setBulkEditMode,
  bulkCategory,
  setBulkCategory,
  onApplyBulkCategory,
  smartFolders,
  isProcessing = false
}) {
  return (
    <Stack gap="cozy" className="w-full">
      <Inline className="justify-between w-full" gap="cozy">
        <Inline gap="cozy">
          <input
            id="bulk-select-all"
            type="checkbox"
            checked={selectedCount === total && total > 0}
            onChange={onSelectAll}
            className="form-checkbox accent-stratosort-blue"
            aria-label={
              selectedCount > 0 ? `${selectedCount} of ${total} items selected` : 'Select all items'
            }
          />
          <label htmlFor="bulk-select-all" className="text-sm font-medium cursor-pointer">
            {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
          </label>
        </Inline>

        {selectedCount > 0 && (
          <Inline gap="cozy">
            <Button
              onClick={onApproveSelected}
              variant="primary"
              className="text-sm"
              disabled={isProcessing}
            >
              <Inline as="span" gap="compact" wrap={false}>
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>{isProcessing ? 'Processing...' : 'Approve Selected'}</span>
              </Inline>
            </Button>
            <Button
              onClick={() => setBulkEditMode(!bulkEditMode)}
              variant="secondary"
              className="text-sm"
            >
              <Inline as="span" gap="compact" wrap={false}>
                <Pencil className="w-4 h-4" aria-hidden="true" />
                <span>Bulk Edit</span>
              </Inline>
            </Button>
          </Inline>
        )}
      </Inline>

      {bulkEditMode && (
        <Inline gap="cozy" className="w-full">
          <Select
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            className="text-sm"
          >
            <option value="">Select category...</option>
            {smartFolders.map((folder) => (
              <option key={folder.id} value={folder.name}>
                {folder.name}
              </option>
            ))}
          </Select>
          <Button
            onClick={onApplyBulkCategory}
            variant="primary"
            className="text-sm"
            disabled={!bulkCategory || isProcessing}
            title={!bulkCategory ? 'Select a category first' : 'Apply category to selected items'}
          >
            {isProcessing ? 'Applying...' : 'Apply'}
          </Button>
          <Button
            onClick={() => {
              setBulkEditMode(false);
              setBulkCategory('');
            }}
            variant="secondary"
            className="text-sm"
          >
            Cancel
          </Button>
        </Inline>
      )}
    </Stack>
  );
}

BulkOperations.propTypes = {
  total: PropTypes.number,
  selectedCount: PropTypes.number,
  onSelectAll: PropTypes.func,
  onApproveSelected: PropTypes.func,
  bulkEditMode: PropTypes.bool,
  setBulkEditMode: PropTypes.func,
  bulkCategory: PropTypes.string,
  setBulkCategory: PropTypes.func,
  onApplyBulkCategory: PropTypes.func,
  smartFolders: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      name: PropTypes.string.isRequired
    })
  ),
  isProcessing: PropTypes.bool
};

export default BulkOperations;
