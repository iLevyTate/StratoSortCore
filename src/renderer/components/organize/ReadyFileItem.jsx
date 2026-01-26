import React, { memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { FileText, Play } from 'lucide-react';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { StatusBadge } from '../ui';
import Card from '../ui/Card';
import { Text } from '../ui/Typography';
import { Stack } from '../layout';
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
    <Card
      variant={isSelected ? 'interactive' : 'default'}
      className={`h-full p-4 ${isSelected ? 'ring-2 ring-stratosort-blue/25' : ''}`}
    >
      <div className="flex gap-3 h-full">
        <div className="pt-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleToggle}
            className="form-checkbox accent-stratosort-blue h-4 w-4 rounded border-border-soft focus:ring-stratosort-blue"
            aria-label={`Select ${file.name}`}
          />
        </div>
        <div className="flex-1 min-w-0 overflow-visible">
          <Stack gap="cozy" className="w-full">
            {/* Header Section */}
            <div className="flex justify-between items-start gap-2">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <FileText className="w-5 h-5 text-system-gray-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <Text
                    variant="small"
                    className="font-medium text-system-gray-900 break-words leading-tight"
                    title={`${file.name}${displayFilePath ? ` (${displayFilePath})` : ''}`}
                  >
                    {file.name}
                  </Text>
                  <Text variant="tiny" className="text-system-gray-500 mt-0.5">
                    {[
                      file.size ? `${Math.round(file.size / 1024)} KB` : 'Pending size',
                      file.source && file.source !== 'file_selection'
                        ? file.source.replace('_', ' ')
                        : null
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </Text>
                </div>
              </div>

              <StatusBadge variant={tone} size="sm" className="flex-shrink-0">
                <span className={stateDisplay.spinning ? 'animate-spin mr-1' : 'mr-1'}>
                  {stateDisplay.icon}
                </span>
                <span className="hidden sm:inline">{stateDisplay.label}</span>
              </StatusBadge>
            </div>

            {/* Analysis Section */}
            {analysis ? (
              <>
                <div className="grid grid-cols-1 gap-3 w-full">
                  <div className="w-full min-w-0">
                    <Input
                      label="Suggested Name"
                      type="text"
                      value={suggestedName}
                      onChange={handleEditName}
                      className="text-sm w-full"
                      title={suggestedName}
                    />
                  </div>
                  <div className="w-full min-w-0">
                    <Select
                      label="Category"
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

                <div className="pt-3 border-t border-border-soft/70">
                  <button
                    type="button"
                    onClick={() => onViewDetails && onViewDetails(file)}
                    className="text-system-gray-600 hover:text-system-gray-900 font-medium flex items-center gap-1.5 w-full transition-colors"
                    aria-label={`View analysis details for ${file.name}`}
                  >
                    <Play className="w-3 h-3 fill-current opacity-70" aria-hidden="true" />
                    <Text as="span" variant="tiny">
                      View Analysis Details
                    </Text>
                  </button>
                </div>

                <div className="flex items-end justify-between gap-3">
                  {destination ? (
                    <details className="text-system-gray-600 overflow-visible group min-w-0 flex-1">
                      <summary className="cursor-pointer list-none font-medium hover:text-system-gray-900 transition-colors flex items-center gap-2 select-none focus:outline-none">
                        <Play className="w-3 h-3 fill-current opacity-70 transition-transform group-open:rotate-90" />
                        <Text as="span" variant="tiny">
                          Destination
                        </Text>
                      </summary>
                      <Text
                        variant="tiny"
                        className="text-stratosort-blue block mt-1 break-all line-clamp-2 pl-5"
                        title={displayDestination}
                      >
                        {displayDestination}
                      </Text>
                    </details>
                  ) : (
                    <div />
                  )}

                  {computedConfidence !== null && (
                    <Text variant="tiny" className="text-system-gray-400 flex-shrink-0">
                      {computedConfidence}% confidence
                    </Text>
                  )}
                </div>
              </>
            ) : (
              <Text variant="small" className="text-system-red-600 mt-2">
                Analysis failed - will be skipped
              </Text>
            )}
          </Stack>
        </div>
      </div>
    </Card>
  );
}

ReadyFileItem.propTypes = {
  file: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  isSelected: PropTypes.bool,
  onToggleSelected: PropTypes.func.isRequired,
  stateDisplay: PropTypes.object.isRequired,
  smartFolders: PropTypes.array,
  editing: PropTypes.object,
  onEdit: PropTypes.func.isRequired,
  destination: PropTypes.string,
  category: PropTypes.string,
  onViewDetails: PropTypes.func
};

ReadyFileItem.defaultProps = {
  isSelected: false,
  smartFolders: [],
  editing: null,
  destination: '',
  category: null,
  onViewDetails: null
};

function areReadyFileItemPropsEqual(prev, next) {
  if (prev.onToggleSelected !== next.onToggleSelected) return false;
  if (prev.onEdit !== next.onEdit) return false;
  if (prev.onViewDetails !== next.onViewDetails) return false;
  if (prev.index !== next.index) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.destination !== next.destination) return false;
  if (prev.category !== next.category) return false;
  if (prev.smartFolders !== next.smartFolders) return false;

  const prevFile = prev.file;
  const nextFile = next.file;
  if (prevFile !== nextFile) {
    if (prevFile?.path !== nextFile?.path) return false;
    if (prevFile?.name !== nextFile?.name) return false;
    if (prevFile?.size !== nextFile?.size) return false;
    if (prevFile?.source !== nextFile?.source) return false;
    if (prevFile?.analysis !== nextFile?.analysis) return false;
  }

  const prevEditing = prev.editing;
  const nextEditing = next.editing;
  if (prevEditing !== nextEditing) {
    if (prevEditing?.suggestedName !== nextEditing?.suggestedName) return false;
    if (prevEditing?.category !== nextEditing?.category) return false;
    if (prevEditing?.analysis !== nextEditing?.analysis) return false;
  }

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
