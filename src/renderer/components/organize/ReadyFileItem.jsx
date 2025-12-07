import React, { memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import Input from '../ui/Input';
import Select from '../ui/Select';

function ReadyFileItem({
  file,
  index,
  isSelected,
  onToggleSelected,
  stateDisplay,
  smartFolders,
  editing,
  onEdit,
  destination,
  category: categoryProp,
  onViewDetails,
}) {
  const analysis = editing?.analysis || file?.analysis;
  const suggestedName = editing?.suggestedName ?? analysis?.suggestedName;
  const category = categoryProp ?? editing?.category ?? analysis?.category;
  const handleToggle = useCallback(
    () => onToggleSelected(index),
    [onToggleSelected, index],
  );
  const handleEditName = useCallback(
    (e) => onEdit(index, 'suggestedName', e.target.value),
    [onEdit, index],
  );
  const handleEditCategory = useCallback(
    (e) => onEdit(index, 'category', e.target.value),
    [onEdit, index],
  );

  // Extract file path for tooltip
  const filePath = file.path || '';
  const tone = stateDisplay.color?.includes('green')
    ? 'success'
    : stateDisplay.color?.includes('amber') ||
        stateDisplay.color?.includes('warning')
      ? 'warning'
      : stateDisplay.color?.includes('red') ||
          stateDisplay.color?.includes('danger')
        ? 'error'
        : 'info';

  return (
    <div
      className={`surface-card transition-all duration-200 overflow-hidden ${isSelected ? 'ring-2 ring-stratosort-blue/25 shadow-md' : ''}`}
    >
      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggle}
          className="form-checkbox mt-1 flex-shrink-0 accent-stratosort-blue h-4 w-4"
          aria-label={`Select ${file.name}`}
        />
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-2xl flex-shrink-0">📄</div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div
                className="font-medium text-system-gray-900 truncate"
                title={`${file.name}${filePath ? ` (${filePath})` : ''}`}
              >
                {file.name}
              </div>
              <div className="text-sm text-system-gray-500 truncate">
                {file.size
                  ? `${Math.round(file.size / 1024)} KB`
                  : 'Unknown size'}{' '}
                • {file.source?.replace('_', ' ')}
              </div>
            </div>
          </div>
          {analysis ? (
            <>
              <div className="grid grid-cols-1 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-system-gray-700 mb-1">
                    Suggested Name
                  </label>
                  <Input
                    type="text"
                    value={suggestedName}
                    onChange={handleEditName}
                    className="text-sm w-full"
                    title={suggestedName}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-system-gray-700 mb-1">
                    Category
                  </label>
                  <Select
                    value={category}
                    onChange={handleEditCategory}
                    className="text-sm w-full"
                  >
                    {smartFolders.map((folder) => (
                      <option key={folder.id} value={folder.name}>
                        {folder.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border-soft/70">
                <button
                  type="button"
                  onClick={() => onViewDetails && onViewDetails(file)}
                  className="text-xs text-system-gray-500 hover:text-system-gray-700 flex items-center gap-1 mb-2 w-full"
                >
                  <span>▶</span>
                  View Analysis Details
                </button>
              </div>
              {destination && (
                <div className="text-sm text-system-gray-600 mt-2 overflow-hidden">
                  <strong>Destination:</strong>{' '}
                  <span
                    className="text-stratosort-blue block mt-1 truncate"
                    title={destination}
                  >
                    {destination}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-system-red-600 mt-2">
              Analysis failed - will be skipped
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className={`status-chip ${tone}`}>
            <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
              {stateDisplay.icon}
            </span>
            <span className="hidden sm:inline">{stateDisplay.label}</span>
          </div>
          {analysis?.confidence && (
            <span className="text-[11px] text-system-gray-500">
              Confidence {Math.round(analysis.confidence * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

ReadyFileItem.propTypes = {
  file: PropTypes.shape({
    name: PropTypes.string.isRequired,
    path: PropTypes.string,
    size: PropTypes.number,
    source: PropTypes.string,
    analysis: PropTypes.object,
  }).isRequired,
  index: PropTypes.number.isRequired,
  isSelected: PropTypes.bool,
  onToggleSelected: PropTypes.func.isRequired,
  stateDisplay: PropTypes.shape({
    color: PropTypes.string,
    spinning: PropTypes.bool,
    icon: PropTypes.node,
    label: PropTypes.string,
  }).isRequired,
  smartFolders: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
    }),
  ),
  editing: PropTypes.shape({
    analysis: PropTypes.object,
    suggestedName: PropTypes.string,
    category: PropTypes.string,
  }),
  onEdit: PropTypes.func.isRequired,
  destination: PropTypes.string,
  category: PropTypes.string,
  onViewDetails: PropTypes.func,
};

export default memo(ReadyFileItem);
