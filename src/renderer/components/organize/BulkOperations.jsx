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
            className="form-checkbox accent-stratosort-blue h-4 w-4 rounded border-border-soft focus:ring-stratosort-blue"
            aria-label={
              selectedCount > 0 ? `${selectedCount} of ${total} items selected` : 'Select all items'
            }
          />
          <label
            htmlFor="bulk-select-all"
            className="text-sm font-medium cursor-pointer text-system-gray-700 select-none"
          >
            {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
          </label>
        </Inline>

        {selectedCount > 0 && (
          <Inline gap="cozy">
            <Button onClick={onApproveSelected} variant="primary" size="sm" disabled={isProcessing}>
              <Check className="w-4 h-4 mr-2" aria-hidden="true" />
              {isProcessing ? 'Processing...' : 'Approve Selected'}
            </Button>
            <Button onClick={() => setBulkEditMode(!bulkEditMode)} variant="secondary" size="sm">
              <Pencil className="w-4 h-4 mr-2" aria-hidden="true" />
              Bulk Edit
            </Button>
          </Inline>
        )}
      </Inline>

      {bulkEditMode && (
        <div className="bg-system-gray-50 p-3 rounded-lg border border-border-soft animate-fade-in">
          <Inline gap="cozy" className="w-full items-end">
            <div className="flex-1">
              <Select
                label="Apply Category to Selected"
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                className="w-full"
              >
                <option value="">Select category...</option>
                {smartFolders.map((folder) => (
                  <option key={folder.id} value={folder.name}>
                    {folder.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              onClick={onApplyBulkCategory}
              variant="primary"
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
            >
              Cancel
            </Button>
          </Inline>
        </div>
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
