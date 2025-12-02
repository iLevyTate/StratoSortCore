import React, { memo, useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import Input from '../ui/Input';
import Select from '../ui/Select';
import AnalysisDetails from '../AnalysisDetails';

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
  const [showDetails, setShowDetails] = useState(false);
  const toggleDetails = useCallback(() => setShowDetails((prev) => !prev), []);

  // Extract file path for tooltip
  const filePath = file.path || '';

  return (
    <div
      className={`border rounded-lg p-4 transition-all duration-200 overflow-hidden ${isSelected ? 'border-stratosort-blue bg-stratosort-blue/5' : 'border-system-gray-200'}`}
    >
      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleToggle}
          className="form-checkbox mt-1 flex-shrink-0"
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
              <div className="mt-3 pt-3 border-t border-system-gray-100">
                <button
                  type="button"
                  onClick={toggleDetails}
                  className="text-xs text-system-gray-500 hover:text-system-gray-700 flex items-center gap-1 mb-2"
                >
                  <span
                    className={`transition-transform ${showDetails ? 'rotate-90' : ''}`}
                  >
                    ▶
                  </span>
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
                {showDetails && (
                  <AnalysisDetails
                    analysis={analysis}
                    options={{ showName: false, showCategory: false }}
                  />
                )}
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
        <div
          className={`text-sm font-medium flex items-center gap-2 flex-shrink-0 ${stateDisplay.color}`}
        >
          <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
            {stateDisplay.icon}
          </span>
          <span className="hidden sm:inline">{stateDisplay.label}</span>
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
};

export default memo(ReadyFileItem);
