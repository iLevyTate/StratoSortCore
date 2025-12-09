import React, { memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { FileText, Play } from 'lucide-react';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { StatusBadge } from '../ui';

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
  const hasCategoryOption = smartFolders?.some(
    (folder) => folder.name === category,
  );
  const computedConfidence =
    typeof analysis?.confidence === 'number'
      ? analysis.confidence > 1
        ? Math.round(analysis.confidence)
        : Math.round(analysis.confidence * 100)
      : null;
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
      className={`surface-card w-full transition-all [transition-duration:var(--duration-normal)] overflow-visible ${isSelected ? 'ring-2 ring-stratosort-blue/25 shadow-md' : ''}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggle}
          className="form-checkbox mt-1 flex-shrink-0 accent-stratosort-blue h-4 w-4"
          aria-label={`Select ${file.name}`}
        />
        <div className="flex-1 min-w-0 overflow-visible">
          <div className="flex items-center gap-3 mb-3">
            <FileText className="w-6 h-6 text-system-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0 overflow-visible w-full">
              <div
                className="font-medium text-system-gray-900 whitespace-normal break-words leading-tight w-full"
                title={`${file.name}${filePath ? ` (${filePath})` : ''}`}
              >
                {file.name}
              </div>
              <div className="text-sm text-system-gray-500 whitespace-normal break-words leading-tight w-full">
                {[
                  file.size
                    ? `${Math.round(file.size / 1024)} KB`
                    : 'Pending size',
                  file.source && file.source !== 'file_selection'
                    ? file.source.replace('_', ' ')
                    : null,
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </div>
            </div>
          </div>
          {analysis ? (
            <>
              <div className="grid grid-cols-1 gap-3 mb-3 w-full">
                <div className="w-full min-w-0">
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
                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-system-gray-700 mb-1">
                    Category
                  </label>
                  <Select
                    value={category}
                    onChange={handleEditCategory}
                    className="text-sm w-full"
                  >
                    {!hasCategoryOption && category && (
                      <option value={category}>{`Unmapped: ${category}`}</option>
                    )}
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
                  <Play className="w-3 h-3" />
                  View Analysis Details
                </button>
              </div>
              {destination && (
                <div className="text-sm text-system-gray-600 mt-2 overflow-visible">
                  <strong>Destination:</strong>{' '}
                  <span
                    className="text-stratosort-blue block mt-1 break-words"
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
          <StatusBadge variant={tone}>
            <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
              {stateDisplay.icon}
            </span>
            <span className="hidden sm:inline">{stateDisplay.label}</span>
          </StatusBadge>
          {computedConfidence !== null && (
            <span className="text-[11px] text-system-gray-500">
              Confidence {computedConfidence}%
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
