import React, { memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { FileText, ChevronRight, Info } from 'lucide-react';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { Button, StatusBadge } from '../ui';
import Card from '../ui/Card';
import { Text } from '../ui/Typography';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { selectRedactPaths } from '../../store/selectors';

function ReadyFileItem({
  file,
  index,
  isSelected = false,
  onToggleSelected,
  stateDisplay,
  smartFolders = [],
  editing = null,
  onEdit,
  category: categoryProp = null,
  onViewDetails = null
}) {
  // PERF: Use memoized selector instead of inline Boolean coercion
  const redactPaths = useSelector(selectRedactPaths);
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
  const showConfidence = computedConfidence !== null;
  const handleToggle = useCallback(() => onToggleSelected(index), [onToggleSelected, index]);
  const handleEditName = useCallback(
    (e) => onEdit(index, 'suggestedName', e.target.value),
    [onEdit, index]
  );
  const handleEditCategory = useCallback(
    (e) => onEdit(index, 'category', e.target.value),
    [onEdit, index]
  );
  const handleViewDetails = useCallback(
    () => onViewDetails && onViewDetails(file),
    [onViewDetails, file]
  );

  const filePath = file.path || '';
  const displayFilePath = formatDisplayPath(filePath, { redact: redactPaths, segments: 2 });
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
      className={`h-full relative ${isSelected ? 'ring-2 ring-stratosort-blue/25' : ''}`}
    >
      {/* Header: Checkbox + File Info + Status */}
      <div className="flex items-start gap-4 p-4 pb-3 border-b border-system-gray-100">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggle}
          className="form-checkbox accent-stratosort-blue h-4 w-4 rounded border-border-soft focus:ring-stratosort-blue mt-1 flex-shrink-0"
          aria-label={`Select ${file.name}`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <FileText className="w-4 h-4 text-system-gray-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <Text
                  variant="small"
                  className="font-medium text-system-gray-900 break-words leading-snug"
                  title={`${file.name}${displayFilePath ? ` (${displayFilePath})` : ''}`}
                >
                  {file.name}
                </Text>
                <Text variant="tiny" className="text-system-gray-500 mt-0.5">
                  {file.size ? `${Math.round(file.size / 1024)} KB` : 'Pending size'}
                </Text>
              </div>
            </div>

            {/* Status Badge - Top Right */}
            <StatusBadge variant={tone} size="sm" className="flex-shrink-0">
              <span className={stateDisplay.spinning ? 'animate-spin mr-1' : 'mr-1'}>
                {stateDisplay.icon}
              </span>
              {stateDisplay.label}
            </StatusBadge>
          </div>
        </div>
      </div>

      {/* Body: Form Fields */}
      {analysis ? (
        <div className="p-4 space-y-4">
          <Input
            label="Suggested Name"
            type="text"
            value={suggestedName}
            onChange={handleEditName}
            className="text-sm w-full"
            title={suggestedName}
          />

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
      ) : (
        <div className="p-4">
          <Text variant="small" className="text-system-red-600">
            Analysis failed - will be skipped
          </Text>
        </div>
      )}

      {/* Footer: Confidence + Actions */}
      {analysis && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-system-gray-50/50 border-t border-system-gray-100 rounded-b-xl">
          {/* Confidence */}
          {showConfidence ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-2 h-2 rounded-full ${
                    computedConfidence >= 80
                      ? 'bg-stratosort-success'
                      : computedConfidence >= 50
                        ? 'bg-stratosort-warning'
                        : 'bg-system-gray-400'
                  }`}
                />
                <Text variant="tiny" className="font-medium text-system-gray-600">
                  {computedConfidence}% confidence
                </Text>
              </div>
              {/* Mini progress bar */}
              <div className="w-16 h-1.5 bg-system-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    computedConfidence >= 80
                      ? 'bg-stratosort-success'
                      : computedConfidence >= 50
                        ? 'bg-stratosort-warning'
                        : 'bg-system-gray-400'
                  }`}
                  style={{ width: `${computedConfidence}%` }}
                />
              </div>
            </div>
          ) : (
            <div />
          )}

          {/* View Details Link */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleViewDetails}
            className="px-1 text-system-gray-500 hover:text-stratosort-blue"
            aria-label={`View analysis details for ${file.name}`}
          >
            <Info className="w-3.5 h-3.5" />
            Details
            <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      )}
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
  category: PropTypes.string,
  onViewDetails: PropTypes.func
};

function areReadyFileItemPropsEqual(prev, next) {
  if (prev.onToggleSelected !== next.onToggleSelected) return false;
  if (prev.onEdit !== next.onEdit) return false;
  if (prev.onViewDetails !== next.onViewDetails) return false;
  if (prev.index !== next.index) return false;
  if (prev.isSelected !== next.isSelected) return false;
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
