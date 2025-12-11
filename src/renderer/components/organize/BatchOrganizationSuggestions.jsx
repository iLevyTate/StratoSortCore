import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle, Lightbulb, Info, ChevronRight, FileText } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { Card, Button } from '../ui';

function BatchOrganizationSuggestions({
  batchSuggestions,
  onAcceptStrategy,
  onCustomizeGroup,
  onRejectAll
}) {
  const { addNotification } = useNotification();
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [selectedStrategy, setSelectedStrategy] = useState(null);

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
    return null;
  }

  const { groups, patterns, recommendations } = batchSuggestions;

  return (
    <div className="flex flex-col gap-[var(--spacing-default)]">
      {/* Pattern Analysis */}
      {patterns && (
        <Card className="p-4 bg-blue-50 border-stratosort-blue/30">
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
                    <span key={term} className="px-2 py-1 bg-white rounded-md text-xs">
                      {term}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <Card className="p-4 border-green-200 bg-green-50">
          <h3 className="font-medium text-system-gray-900 mb-3">Recommendations</h3>
          <div className="flex flex-col gap-[var(--spacing-cozy)]">
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
                  <div className="text-xs text-system-gray-600 mt-1">{rec.suggestion}</div>
                  <div className="text-xs text-system-gray-500 mt-1">
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
                  </div>
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
            <div className="text-xs text-system-gray-500 mt-2">
              Pattern:{' '}
              <code className="bg-white px-2 py-1 rounded-md">{suggestedStrategy.pattern}</code>
            </div>
          </div>
          <div className="flex gap-2">
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
        <div className="flex flex-col gap-[var(--spacing-cozy)] max-h-viewport-md overflow-y-auto modern-scrollbar">
          {/* FIX: Use stable identifier instead of array index as key */}
          {groups.map((group, groupIndex) => (
            <Card
              key={group.folder || group.id || `group-${groupIndex}`}
              className="overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleGroup(groupIndex)}
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
                            • {Math.round(group.confidence * 100)}% confidence
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
                    {group.files.map((file) => (
                      <div
                        key={file.path || file.id || file.name}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-system-gray-400" />
                          <span>{file.name}</span>
                        </div>
                        {file.suggestion && (
                          <span className="text-xs text-system-gray-500">
                            {Math.round((file.suggestion.confidence || 0) * 100)}% match
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* FIX: Use consistent optional chaining and add array length check */}
                  {group.files?.length > 0 && group.files[0]?.alternatives?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-system-gray-200">
                      <div className="text-xs text-system-gray-600 mb-2">
                        Alternative folders for this group:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {/* FIX: Use stable identifier instead of array index as key */}
                        {group.files[0].alternatives.slice(0, 3).map((alt) => (
                          <button
                            key={alt.folder || alt.id}
                            className="px-2 py-1 text-xs bg-white border border-system-gray-300 rounded-md hover:border-stratosort-blue transition-colors"
                            onClick={() =>
                              onCustomizeGroup(groupIndex, {
                                ...group,
                                folder: alt.folder
                              })
                            }
                          >
                            {alt.folder}
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
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              addNotification('Preview feature coming soon', 'info');
            }}
          >
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
  onRejectAll: PropTypes.func
};

export default BatchOrganizationSuggestions;
