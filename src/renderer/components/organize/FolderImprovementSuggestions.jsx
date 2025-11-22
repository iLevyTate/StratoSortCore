import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useNotification } from '../../contexts/NotificationContext';
import { Card, Button } from '../ui';

function FolderImprovementSuggestions({
  improvements = [],
  smartFolders = [],
  onAcceptImprovement,
  onCreateFolder,
  onMergeFolders,
}) {
  const { addNotification } = useNotification();
  const [expandedSections, setExpandedSections] = useState(new Set());

  const toggleSection = (type) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(type)) {
      newExpanded.delete(type);
    } else {
      newExpanded.add(type);
    }
    setExpandedSections(newExpanded);
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 bg-red-50';
      case 'medium':
        return 'text-yellow-600 bg-yellow-50';
      case 'low':
        return 'text-blue-600 bg-blue-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'high':
        return '⚠️';
      case 'medium':
        return '💡';
      case 'low':
        return 'ℹ️';
      default:
        return '📌';
    }
  };

  if (!improvements || improvements.length === 0) {
    return (
      <Card className="p-4 bg-green-50 border-green-200">
        <div className="flex items-center gap-2">
          <span className="text-green-600">✅</span>
          <span className="text-green-700 font-medium">
            Your folder structure is well-organized!
          </span>
        </div>
        <p className="text-sm text-green-600 mt-2">
          No significant improvements needed at this time.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-system-gray-900">
          Folder Structure Improvements
        </h3>
        <span className="text-sm text-system-gray-600">
          {improvements.length} suggestion{improvements.length !== 1 ? 's' : ''}
        </span>
      </div>

      {improvements.map((improvement, index) => (
        <Card
          key={index}
          className={`overflow-hidden ${
            improvement.priority === 'high'
              ? 'border-red-200'
              : 'border-gray-200'
          }`}
        >
          <div
            className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => toggleSection(improvement.type)}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <span
                  className={`transform transition-transform ${
                    expandedSections.has(improvement.type) ? 'rotate-90' : ''
                  }`}
                >
                  ▶
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span>{getPriorityIcon(improvement.priority)}</span>
                    <span className="font-medium text-system-gray-900">
                      {improvement.description}
                    </span>
                  </div>
                  <span
                    className={`inline-block mt-1 text-xs px-2 py-1 rounded ${getPriorityColor(
                      improvement.priority,
                    )}`}
                  >
                    {improvement.priority} priority
                  </span>
                </div>
              </div>
              <div className="text-sm text-system-gray-500">
                {improvement.suggestions?.length || 0} item
                {improvement.suggestions?.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {expandedSections.has(improvement.type) && (
            <div className="border-t bg-gray-50 p-4">
              {improvement.type === 'missing_categories' && (
                <div className="space-y-3">
                  {improvement.suggestions.map((category, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 bg-white rounded border"
                    >
                      <div>
                        <div className="font-medium">📁 {category.name}</div>
                        <div className="text-sm text-system-gray-600 mt-1">
                          {category.reason}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => onCreateFolder(category)}
                        className="bg-stratosort-blue hover:bg-stratosort-blue/90"
                      >
                        Create Folder
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {improvement.type === 'folder_overlaps' && (
                <div className="space-y-3">
                  {improvement.suggestions.map((overlap, idx) => (
                    <div key={idx} className="p-3 bg-white rounded border">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">
                            {overlap.folders.join(' ↔ ')}
                          </div>
                          <div className="text-sm text-system-gray-600 mt-1">
                            {Math.round(overlap.similarity * 100)}% similar
                          </div>
                          <div className="text-xs text-system-gray-500 mt-1">
                            {overlap.suggestion}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onMergeFolders(overlap.folders)}
                        >
                          Review Merge
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {improvement.type === 'underutilized_folders' && (
                <div className="space-y-3">
                  {improvement.suggestions.map((folder, idx) => (
                    <div key={idx} className="p-3 bg-white rounded border">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">
                            📁 {folder.name}
                          </div>
                          <div className="text-xs text-system-gray-600 mt-1">
                            Used {folder.usageCount} time
                            {folder.usageCount !== 1 ? 's' : ''}
                          </div>
                          <div className="text-xs text-system-gray-500 mt-1">
                            {folder.suggestion}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              addNotification(
                                'Folder editing will be available in a future update',
                                'info',
                              );
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50"
                            onClick={() => {
                              addNotification(
                                'Folder removal will be available in a future update',
                                'info',
                              );
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {improvement.type === 'hierarchy_improvements' && (
                <div className="space-y-3">
                  {improvement.suggestions.map((hierarchy, idx) => (
                    <div key={idx} className="p-3 bg-white rounded border">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">
                            {hierarchy.suggestion}
                          </div>
                          <div className="text-xs text-system-gray-600 mt-2">
                            <div>Parent: {hierarchy.parent}</div>
                            <div className="mt-1">
                              Children: {hierarchy.children.join(', ')}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            onCreateFolder({
                              name: hierarchy.parent,
                              isParent: true,
                              children: hierarchy.children,
                            })
                          }
                        >
                          Create Parent
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}

      {/* Overall Health Score */}
      <Card className="p-4 bg-gradient-to-r from-stratosort-blue/5 to-stratosort-blue/10">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-system-gray-900">
              Organization Health Score
            </h4>
            <p className="text-sm text-system-gray-600 mt-1">
              Based on folder structure analysis
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-stratosort-blue">
              {calculateHealthScore(improvements, smartFolders)}%
            </div>
            <div className="text-xs text-system-gray-500 mt-1">
              {getHealthLabel(calculateHealthScore(improvements, smartFolders))}
            </div>
          </div>
        </div>
      </Card>

      {/* Quick Actions */}
      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button
          variant="secondary"
          onClick={() => {
            addNotification(
              'Report export will be available in a future update',
              'info',
            );
          }}
        >
          Export Report
        </Button>
        <Button
          variant="primary"
          onClick={() =>
            onAcceptImprovement(
              improvements.filter((i) => i.priority === 'high'),
            )
          }
          className="bg-stratosort-blue hover:bg-stratosort-blue/90"
        >
          Apply High Priority Fixes
        </Button>
      </div>
    </div>
  );
}

// Helper functions
function calculateHealthScore(improvements, smartFolders) {
  let score = 100;

  improvements.forEach((improvement) => {
    const deduction =
      {
        high: 15,
        medium: 8,
        low: 3,
      }[improvement.priority] || 0;

    score -= deduction * (improvement.suggestions?.length || 1) * 0.5;
  });

  // Bonus for having smart folders
  if (smartFolders.length > 5) {
    score += 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getHealthLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Needs Improvement';
  return 'Poor';
}

const folderShape = PropTypes.shape({
  name: PropTypes.string,
  reason: PropTypes.string,
  suggestion: PropTypes.string,
  usageCount: PropTypes.number,
});

const improvementShape = PropTypes.shape({
  type: PropTypes.string.isRequired,
  priority: PropTypes.oneOf(['high', 'medium', 'low']),
  description: PropTypes.string,
  suggestions: PropTypes.arrayOf(
    PropTypes.oneOfType([
      folderShape,
      PropTypes.shape({
        folders: PropTypes.arrayOf(PropTypes.string),
        similarity: PropTypes.number,
        suggestion: PropTypes.string,
      }),
      PropTypes.shape({
        parent: PropTypes.string,
        children: PropTypes.arrayOf(PropTypes.string),
        suggestion: PropTypes.string,
      }),
    ]),
  ),
});

FolderImprovementSuggestions.propTypes = {
  improvements: PropTypes.arrayOf(improvementShape),
  smartFolders: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
    }),
  ),
  onAcceptImprovement: PropTypes.func,
  onCreateFolder: PropTypes.func,
  onMergeFolders: PropTypes.func,
};

export default FolderImprovementSuggestions;
