import React, { memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { FileText, Play } from 'lucide-react';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { StatusBadge } from '../ui';
import { Inline, Stack } from '../layout';
import { formatDisplayPath } from '../../utils/pathDisplay';

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
  const redactPaths = useSelector((state) => Boolean(state?.system?.redactPaths));
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
  const displayFilePath = formatDisplayPath(filePath, { redact: redactPaths, segments: 2 });
  const displayDestination = formatDisplayPath(destination || '', {
    redact: redactPaths,
    segments: 2
  });
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
      <div className="flex gap-3 h-full">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggle}
          className="form-checkbox mt-1 flex-shrink-0 accent-stratosort-blue h-4 w-4"
          aria-label={`Select ${file.name}`}
        />
        <div className="flex-1 min-w-0 overflow-visible">
          <Stack gap="cozy" className="w-full">
            {/* Header Section */}
            <Inline className="justify-between w-full" align="start" wrap={false} gap="cozy">
              <Inline align="start" wrap={false} gap="cozy" className="min-w-0 flex-1">
                <FileText className="w-6 h-6 text-system-gray-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div
                    className="font-medium text-system-gray-900 whitespace-normal break-words leading-tight w-full"
                    title={`${file.name}${displayFilePath ? ` (${displayFilePath})` : ''}`}
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
              </Inline>

              <StatusBadge variant={tone}>
                <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
                  {stateDisplay.icon}
                </span>
                <span className="hidden sm:inline">{stateDisplay.label}</span>
              </StatusBadge>
            </Inline>

            {/* Analysis Section */}
            {analysis ? (
              <>
                <div className="grid grid-cols-1 gap-3 w-full">
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

                {/* Keywords removed from main card view - available in details modal */}

                <div className="pt-3 border-t border-border-soft/70">
                  <button
                    type="button"
                    onClick={() => onViewDetails && onViewDetails(file)}
                    className="text-sm text-system-gray-600 hover:text-system-gray-900 font-medium flex items-center gap-2 w-full transition-colors"
                    aria-label={`View analysis details for ${file.name}`}
                  >
                    <Play className="w-3 h-3 fill-current opacity-70" aria-hidden="true" />
                    View Analysis Details
                  </button>
                </div>

                <div className="flex items-end justify-between gap-3">
                  {destination ? (
                    <details className="text-sm text-system-gray-600 overflow-visible group min-w-0 flex-1">
                      <summary className="cursor-pointer list-none font-medium hover:text-system-gray-900 transition-colors flex items-center gap-2 select-none focus:outline-none">
                        <Play className="w-3 h-3 fill-current opacity-70 transition-transform group-open:rotate-90" />
                        Destination
                      </summary>
                      <span
                        className="text-stratosort-blue block mt-1 break-all line-clamp-2 pl-5"
                        title={displayDestination}
                      >
                        {displayDestination}
                      </span>
                    </details>
                  ) : (
                    <div />
                  )}

                  {computedConfidence !== null && (
                    <div className="text-[11px] text-system-gray-500 flex-shrink-0">
                      Confidence {computedConfidence}%
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-system-red-600 mt-2">
                Analysis failed - will be skipped
              </div>
            )}
          </Stack>
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
