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
  onViewDetails
}) {
  const analysis = editing?.analysis || file?.analysis;
  const suggestedName = editing?.suggestedName ?? analysis?.suggestedName;
  const category = categoryProp ?? editing?.category ?? analysis?.category;
  const hasCategoryOption = smartFolders?.some((folder) => folder.name === category);
  const confidenceValue =
    typeof analysis?.confidence === 'number' &&
    Number.isFinite(analysis.confidence) &&
    analysis.confidence >= 0
      ? analysis.confidence
      : null;
  const computedConfidence =
    confidenceValue === null
      ? null
      : confidenceValue > 1
        ? Math.round(confidenceValue)
        : Math.round(confidenceValue * 100);
  const handleToggle = useCallback(() => onToggleSelected(index), [onToggleSelected, index]);
  const handleEditName = useCallback(
    (e) => onEdit(index, 'suggestedName', e.target.value),
    [onEdit, index]
  );
  const handleEditCategory = useCallback(
    (e) => onEdit(index, 'category', e.target.value),
    [onEdit, index]
  );

  // Extract file path for tooltip
  const filePath = file.path || '';
  const tone = stateDisplay.color?.includes('green')
    ? 'success'
    : stateDisplay.color?.includes('amber') || stateDisplay.color?.includes('warning')
      ? 'warning'
      : stateDisplay.color?.includes('red') || stateDisplay.color?.includes('danger')
        ? 'error'
        : 'info';

  return (
    <div
      className={`surface-card w-full h-full relative transition-all [transition-duration:var(--duration-normal)] overflow-visible ${isSelected ? 'ring-2 ring-stratosort-blue/25 shadow-md' : ''}`}
    >
      {/* Absolute positioned status elements to maximize content width */}
      <div className="absolute top-4 right-4 z-10">
        <StatusBadge variant={tone}>
          <span className={stateDisplay.spinning ? 'animate-spin' : ''}>{stateDisplay.icon}</span>
          <span className="hidden sm:inline">{stateDisplay.label}</span>
        </StatusBadge>
      </div>

      {computedConfidence !== null && (
        <div className="absolute bottom-4 right-4 z-10 text-[11px] text-system-gray-500">
          Confidence {computedConfidence}%
        </div>
      )}

      <div className="flex gap-3 h-full">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggle}
          className="form-checkbox mt-1 flex-shrink-0 accent-stratosort-blue h-4 w-4"
          aria-label={`Select ${file.name}`}
        />
        <div className="flex-1 min-w-0 overflow-visible">
          {/* Header Section - with padding right to avoid badge */}
          <div className="flex items-center gap-3 mb-3 pr-28">
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
                  file.size ? `${Math.round(file.size / 1024)} KB` : 'Pending size',
                  file.source && file.source !== 'file_selection'
                    ? file.source.replace('_', ' ')
                    : null
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </div>
            </div>
          </div>

          {/* Analysis Section - Full Width (Middle section flows under badge area if needed) */}
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
                  <Select value={category} onChange={handleEditCategory} className="text-sm w-full">
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
                  aria-label={`View analysis details for ${file.name}`}
                >
                  <Play className="w-3 h-3" aria-hidden="true" />
                  View Analysis Details
                </button>
              </div>
              {destination && (
                <div className="text-sm text-system-gray-600 mt-2 overflow-visible pr-28">
                  <strong>Destination:</strong>{' '}
                  <span
                    className="text-stratosort-blue block mt-1 break-all line-clamp-2"
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
    analysis: PropTypes.object
  }).isRequired,
  index: PropTypes.number.isRequired,
  isSelected: PropTypes.bool,
  onToggleSelected: PropTypes.func.isRequired,
  stateDisplay: PropTypes.shape({
    color: PropTypes.string,
    spinning: PropTypes.bool,
    icon: PropTypes.node,
    label: PropTypes.string
  }).isRequired,
  smartFolders: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string
    })
  ),
  editing: PropTypes.shape({
    analysis: PropTypes.object,
    suggestedName: PropTypes.string,
    category: PropTypes.string
  }),
  onEdit: PropTypes.func.isRequired,
  destination: PropTypes.string,
  category: PropTypes.string,
  onViewDetails: PropTypes.func
};

// FIX L-3: Add defaultProps for optional props to prevent undefined errors
ReadyFileItem.defaultProps = {
  isSelected: false,
  smartFolders: [],
  editing: null,
  destination: '',
  category: null,
  onViewDetails: null
};

function areReadyFileItemPropsEqual(prev, next) {
  // If key callbacks change, we must re-render so handlers use the latest functions.
  if (prev.onToggleSelected !== next.onToggleSelected) return false;
  if (prev.onEdit !== next.onEdit) return false;
  if (prev.onViewDetails !== next.onViewDetails) return false;

  if (prev.index !== next.index) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.destination !== next.destination) return false;
  if (prev.category !== next.category) return false;

  // Most parent renders pass the same smartFolders reference; if it changes, re-render.
  if (prev.smartFolders !== next.smartFolders) return false;

  // Compare file fields used by this component (avoid deep equality on analysis).
  const prevFile = prev.file;
  const nextFile = next.file;
  if (prevFile !== nextFile) {
    if (prevFile?.path !== nextFile?.path) return false;
    if (prevFile?.name !== nextFile?.name) return false;
    if (prevFile?.size !== nextFile?.size) return false;
    if (prevFile?.source !== nextFile?.source) return false;
    if (prevFile?.analysis !== nextFile?.analysis) return false;
  }

  // Compare editing fields used by this component.
  const prevEditing = prev.editing;
  const nextEditing = next.editing;
  if (prevEditing !== nextEditing) {
    if (prevEditing?.suggestedName !== nextEditing?.suggestedName) return false;
    if (prevEditing?.category !== nextEditing?.category) return false;
    if (prevEditing?.analysis !== nextEditing?.analysis) return false;
  }

  // Compare stateDisplay fields used for UI.
  const prevState = prev.stateDisplay;
  const nextState = next.stateDisplay;
  if (prevState !== nextState) {
    if (prevState?.label !== nextState?.label) return false;
    if (prevState?.color !== nextState?.color) return false;
    if (prevState?.spinning !== nextState?.spinning) return false;
    if (prevState?.icon !== nextState?.icon) return false;
  }

  return true;
}

export default memo(ReadyFileItem, areReadyFileItemPropsEqual);
