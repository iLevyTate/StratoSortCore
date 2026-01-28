import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  CheckCircle,
  Lightbulb,
  Info,
  ChevronRight,
  FileText,
  Folder,
  ArrowRight,
  X,
  Eye
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { Card, Button, IconButton, StateMessage } from '../ui';
import { Text } from '../ui/Typography';

function BatchOrganizationSuggestions({
  batchSuggestions,
  onAcceptStrategy,
  onCustomizeGroup,
  onRejectAll,
  onMemorySaved
}) {
  const { addNotification } = useNotification();
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [memoryNote, setMemoryNote] = useState('');
  const [savingMemory, setSavingMemory] = useState(false);

  // FIX: Memoize toggleGroup to prevent unnecessary re-renders
  const toggleGroup = useCallback((groupIndex) => {
    setExpandedGroups((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(groupIndex)) {
        newExpanded.delete(groupIndex);
      } else {
        newExpanded.add(groupIndex);
      }
      return newExpanded;
    });
  }, []);

  // Extract values before early return for use in callbacks
  const suggestedStrategy = batchSuggestions?.suggestedStrategy;

  // FIX: Memoize handleStrategyAccept
  const handleStrategyAccept = useCallback(() => {
    if (onAcceptStrategy) {
      onAcceptStrategy(selectedStrategy || suggestedStrategy);
    }
  }, [onAcceptStrategy, selectedStrategy, suggestedStrategy]);

  if (!batchSuggestions || !batchSuggestions.groups) {
    return (
      <StateMessage
        icon={Info}
        tone="info"
        variant="card"
        size="md"
        title="No batch suggestions available"
        description="Select multiple files to see organization options."
        className="p-8"
        contentClassName="max-w-sm"
      />
    );
  }

  const { groups, patterns, recommendations } = batchSuggestions;

  const handleSaveMemory = async () => {
    const trimmed = memoryNote.trim();
    if (!trimmed) return;
    setSavingMemory(true);
    try {
      await window.electronAPI.suggestions.addFeedbackMemory(trimmed);
      setMemoryNote('');
      addNotification('Memory saved', 'success');
      if (onMemorySaved) {
        onMemorySaved();
      }
    } catch {
      addNotification('Failed to save memory', 'warning');
    } finally {
      setSavingMemory(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-4 border-system-gray-200 bg-system-gray-50">
        <h3 className="font-medium text-system-gray-900 mb-2">Batch Feedback Note</h3>
        <textarea
          value={memoryNote}
          onChange={(event) => setMemoryNote(event.target.value)}
          placeholder='e.g., "All 3D files go to 3D Prints"'
          className="w-full rounded-md border border-system-gray-200 bg-white p-2 text-sm text-system-gray-800 focus:outline-none focus:ring-2 focus:ring-stratosort-blue/30"
          rows={2}
        />
        <div className="mt-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleSaveMemory}
            disabled={savingMemory || !memoryNote.trim()}
            className="bg-stratosort-blue hover:bg-stratosort-blue/90"
          >
            Save Memory
          </Button>
        </div>
        <Text variant="tiny" className="mt-2 text-system-gray-500">
          Saved notes guide future suggestions for all files.
        </Text>
      </Card>
      {/* Pattern Analysis */}
      {patterns && (
        <Card className="p-4 bg-stratosort-blue/5 border-stratosort-blue/20">
          <h3 className="font-medium text-system-gray-900 mb-3">Pattern Analysis</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--spacing-cozy)] text-sm">
            {patterns.hasCommonProject && (
              <div>
                <span className="text-system-gray-600">Common Project:</span>
                <span className="ml-2 font-medium">{patterns.project}</span>
              </div>
            )}
            {patterns.dominantCategory && (
              <div>
                <span className="text-system-gray-600">Main Category:</span>
                <span className="ml-2 font-medium">{patterns.dominantCategory}</span>
              </div>
            )}
            {patterns.fileTypes && patterns.fileTypes.length > 0 && (
              <div>
                <span className="text-system-gray-600">File Types:</span>
                <span className="ml-2">{patterns.fileTypes.join(', ')}</span>
              </div>
            )}
            {patterns.commonTerms && patterns.commonTerms.length > 0 && (
              <div className="col-span-2">
                <span className="text-system-gray-600">Common Terms:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {patterns.commonTerms.map((term) => (
                    <Text
                      as="span"
                      variant="tiny"
                      key={term}
                      className="px-2 py-1 bg-white rounded-md"
                    >
                      {term}
                    </Text>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <Card className="p-4 border-stratosort-success/20 bg-stratosort-success/10">
          <h3 className="font-medium text-system-gray-900 mb-3">Recommendations</h3>
          <div className="flex flex-col gap-6">
            {/* FIX: Use stable identifier instead of array index as key */}
            {recommendations.map((rec) => (
              <div key={rec.id || rec.description || rec.type} className="flex items-start gap-3">
                <div className="mt-0.5">
                  {rec.confidence >= 0.8 ? (
                    <CheckCircle className="w-4 h-4 text-stratosort-success" />
                  ) : rec.confidence >= 0.5 ? (
                    <Lightbulb className="w-4 h-4 text-stratosort-warning" />
                  ) : (
                    <Info className="w-4 h-4 text-stratosort-blue" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">{rec.description}</div>
                  <Text variant="tiny" className="text-system-gray-600 mt-1">
                    {rec.suggestion}
                  </Text>
                  <Text variant="tiny" className="text-system-gray-500 mt-1">
                    Confidence:{' '}
                    {Math.round(
                      Math.min(
                        100,
                        Math.max(
                          0,
                          (rec.confidence || 0) > 1 ? rec.confidence : (rec.confidence || 0) * 100
                        )
                      )
                    )}
                    %
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Suggested Strategy */}
      {suggestedStrategy && (
        <Card className="p-4 border-stratosort-blue/50 bg-stratosort-blue/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-system-gray-900">Suggested Organization Strategy</h3>
            <span className="text-sm text-stratosort-blue">
              {Math.round(
                Math.min(
                  100,
                  Math.max(
                    0,
                    (suggestedStrategy.score || 0) > 1
                      ? suggestedStrategy.score
                      : (suggestedStrategy.score || 0) * 100
                  )
                )
              )}
              % Match
            </span>
          </div>
          <div className="mb-4">
            <div className="font-medium">{suggestedStrategy.name}</div>
            <div className="text-sm text-system-gray-600 mt-1">{suggestedStrategy.description}</div>
            <Text variant="tiny" className="text-system-gray-500 mt-2">
              Pattern:{' '}
              <code className="bg-white px-2 py-1 rounded-md">{suggestedStrategy.pattern}</code>
            </Text>
          </div>
          <div className="flex gap-cozy">
            <Button
              size="sm"
              variant="primary"
              onClick={handleStrategyAccept}
              className="bg-stratosort-blue hover:bg-stratosort-blue/90"
            >
              Apply This Strategy
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelectedStrategy(null)}>
              Choose Different
            </Button>
          </div>
        </Card>
      )}

      {/* File Groups */}
      <div>
        <h3 className="font-medium text-system-gray-900 mb-3">
          Suggested File Groups ({groups.length})
        </h3>
        <div className="flex flex-col gap-6 max-h-viewport-md overflow-y-auto modern-scrollbar">
          {/* FIX: Use stable identifier instead of array index as key */}
          {groups.map((group, groupIndex) => (
            <Card
              key={group.folder || group.id || `group-${groupIndex}`}
              className="overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-system-gray-50 transition-colors"
                onClick={() => toggleGroup(groupIndex)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleGroup(groupIndex)}
                role="button"
                tabIndex={0}
                aria-expanded={expandedGroups.has(groupIndex)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ChevronRight
                      className={`w-4 h-4 text-system-gray-500 transform transition-transform ${
                        expandedGroups.has(groupIndex) ? 'rotate-90' : ''
                      }`}
                    />
                    <div>
                      <div className="font-medium">{group.folder}</div>
                      <div className="text-sm text-system-gray-600">
                        {group.files.length} file
                        {group.files.length !== 1 ? 's' : ''}
                        {group.confidence && (
                          <span className="ml-2">
                            {/* FIX: Handle confidence values that may already be 0-100 scale */}•{' '}
                            {Math.round(
                              group.confidence <= 1 ? group.confidence * 100 : group.confidence
                            )}
                            % confidence
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onCustomizeGroup) {
                        onCustomizeGroup(groupIndex, group);
                      }
                    }}
                    className="text-stratosort-blue"
                  >
                    Customize
                  </Button>
                </div>
              </div>

              {expandedGroups.has(groupIndex) && (
                <div className="border-t border-system-gray-200 p-4 bg-system-gray-50">
                  <div className="space-y-2">
                    {/* FIX: Use stable identifier instead of array index as key */}
                    {Array.isArray(group.files) &&
                      group.files.map((file) => (
                        <div
                          key={file.path || file.id || file.name}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-system-gray-400" />
                            <span>{file.name}</span>
                          </div>
                          {file.suggestion && (
                            <Text as="span" variant="tiny" className="text-system-gray-500">
                              {Math.round((file.suggestion.confidence || 0) * 100)}% match
                            </Text>
                          )}
                        </div>
                      ))}
                  </div>

                  {/* FIX: Use consistent optional chaining and add array length check */}
                  {Array.isArray(group.files) &&
                    group.files.length > 0 &&
                    Array.isArray(group.files[0]?.alternatives) &&
                    group.files[0].alternatives.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-system-gray-200">
                        <Text variant="tiny" className="text-system-gray-600 mb-2">
                          Alternative folders for this group:
                        </Text>
                        <div className="flex flex-wrap gap-2">
                          {/* FIX: Use stable identifier instead of array index as key */}
                          {group.files[0].alternatives.slice(0, 3).map((alt) => (
                            <button
                              key={alt.folder || alt.id}
                              className="px-2 py-1 bg-white border border-system-gray-300 rounded-md hover:border-stratosort-blue transition-colors"
                              onClick={() =>
                                onCustomizeGroup(groupIndex, {
                                  ...group,
                                  folder: alt.folder
                                })
                              }
                            >
                              <Text as="span" variant="tiny">
                                {alt.folder}
                              </Text>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="secondary" onClick={onRejectAll}>
          Cancel Batch Organization
        </Button>
        <div className="flex gap-cozy">
          <Button
            variant="secondary"
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1.5"
          >
            <Eye className="w-4 h-4" />
            Preview Changes
          </Button>
          <Button
            variant="primary"
            onClick={handleStrategyAccept}
            className="bg-stratosort-blue hover:bg-stratosort-blue/90"
          >
            Apply All Suggestions
          </Button>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-hidden m-4 flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="heading-secondary">Preview Organization Changes</h3>
              <IconButton
                onClick={() => setShowPreview(false)}
                variant="ghost"
                size="sm"
                aria-label="Close preview"
                icon={<X className="w-5 h-5" />}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {groups.map((group, index) => (
                  <div key={group.folder || index} className="border rounded-lg overflow-hidden">
                    <div className="bg-system-gray-50 p-3 flex items-center gap-2">
                      <Folder className="w-5 h-5 text-stratosort-blue" />
                      <span className="font-medium">{group.folder}</span>
                      <span className="text-sm text-system-gray-500">
                        ({group.files.length} file{group.files.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <div className="divide-y divide-system-gray-100">
                      {group.files.map((file) => (
                        <div
                          key={file.path || file.name}
                          className="p-3 flex items-center gap-3 text-sm"
                        >
                          <FileText className="w-4 h-4 text-system-gray-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{file.name}</div>
                            {file.currentPath && (
                              <Text
                                as="div"
                                variant="tiny"
                                className="flex items-center gap-2 text-system-gray-500 mt-1"
                              >
                                <span className="truncate">{file.currentPath}</span>
                                <ArrowRight className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate text-stratosort-blue">
                                  {group.folder}
                                </span>
                              </Text>
                            )}
                          </div>
                          {file.suggestion?.confidence && (
                            <Text
                              as="span"
                              variant="tiny"
                              className="bg-system-gray-100 px-2 py-0.5 rounded"
                            >
                              {Math.round(file.suggestion.confidence * 100)}%
                            </Text>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="mt-4 p-3 bg-stratosort-blue/5 rounded-lg border border-stratosort-blue/20">
                <div className="text-sm text-system-gray-700">
                  <span className="font-medium">{groups.length}</span> folder
                  {groups.length !== 1 ? 's' : ''} will receive{' '}
                  <span className="font-medium">
                    {groups.reduce((sum, g) => sum + g.files.length, 0)}
                  </span>{' '}
                  file{groups.reduce((sum, g) => sum + g.files.length, 0) !== 1 ? 's' : ''} total
                </div>
              </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowPreview(false)}>
                Close Preview
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setShowPreview(false);
                  handleStrategyAccept();
                }}
                className="bg-stratosort-blue hover:bg-stratosort-blue/90"
              >
                Apply All Changes
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

const alternativeShape = PropTypes.shape({
  folder: PropTypes.string,
  confidence: PropTypes.number
});

const fileShape = PropTypes.shape({
  name: PropTypes.string.isRequired,
  suggestion: PropTypes.shape({
    confidence: PropTypes.number
  }),
  alternatives: PropTypes.arrayOf(alternativeShape)
});

const groupShape = PropTypes.shape({
  folder: PropTypes.string,
  files: PropTypes.arrayOf(fileShape).isRequired,
  confidence: PropTypes.number
});

const patternsShape = PropTypes.shape({
  hasCommonProject: PropTypes.bool,
  project: PropTypes.string,
  dominantCategory: PropTypes.string,
  fileTypes: PropTypes.arrayOf(PropTypes.string),
  commonTerms: PropTypes.arrayOf(PropTypes.string)
});

const recommendationShape = PropTypes.shape({
  description: PropTypes.string,
  suggestion: PropTypes.string,
  confidence: PropTypes.number
});

const strategyShape = PropTypes.shape({
  name: PropTypes.string,
  description: PropTypes.string,
  pattern: PropTypes.string,
  score: PropTypes.number
});

BatchOrganizationSuggestions.propTypes = {
  batchSuggestions: PropTypes.shape({
    groups: PropTypes.arrayOf(groupShape).isRequired,
    patterns: patternsShape,
    recommendations: PropTypes.arrayOf(recommendationShape),
    suggestedStrategy: strategyShape
  }),
  onAcceptStrategy: PropTypes.func,
  onCustomizeGroup: PropTypes.func,
  onRejectAll: PropTypes.func,
  onMemorySaved: PropTypes.func
};

export default BatchOrganizationSuggestions;
