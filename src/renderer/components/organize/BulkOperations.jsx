import React from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Select from '../ui/Select';

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
}) {
  return (
    <div className="surface-quiet flex items-center justify-between flex-wrap gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="checkbox"
          checked={selectedCount === total && total > 0}
          onChange={onSelectAll}
          className="form-checkbox accent-stratosort-blue"
        />
        <span className="text-sm font-medium">
          {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
        </span>
        {selectedCount > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={onApproveSelected}
              variant="primary"
              className="text-sm"
            >
              ✓ Approve Selected
            </Button>
            <Button
              onClick={() => setBulkEditMode(!bulkEditMode)}
              variant="secondary"
              className="text-sm"
            >
              ✏️ Bulk Edit
            </Button>
          </div>
        )}
      </div>
      {bulkEditMode && (
        <div className="flex items-center gap-4 flex-wrap">
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
            disabled={!bulkCategory}
          >
            Apply
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
        </div>
      )}
    </div>
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
      name: PropTypes.string.isRequired,
    }),
  ),
};

export default BulkOperations;
