import React, { useState, memo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Card, Button } from '../ui';

const OrganizationSuggestions = memo(function OrganizationSuggestions({
  file,
  suggestions,
  onAccept,
  onReject,
  onStrategyChange,
}) {
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [expandedAlternatives, setExpandedAlternatives] = useState(false);

  // FIX: Move useCallback before early return to follow React hooks rules
  const handleStrategySelect = useCallback(
    (strategyId) => {
      setSelectedStrategy(strategyId);
      if (onStrategyChange) {
        onStrategyChange(file, strategyId);
      }
    },
    [file, onStrategyChange],
  );

  if (!suggestions || !suggestions.primary) {
    return null;
  }

  const {
    primary,
    alternatives = [],
    strategies = [],
    confidence = 0,
    explanation,
  } = suggestions;

  // Normalize confidence for both display (0-100) and logic (0-1)
  const normalizeConfidenceFraction = (value) => {
    if (!Number.isFinite(value)) return 0;
    const fraction = value > 1 ? value / 100 : value;
    return Math.min(1, Math.max(0, fraction));
  };

  const confidenceFraction = normalizeConfidenceFraction(confidence);
  const confidencePercent = Math.round(confidenceFraction * 100);
  const safeConfidence = confidenceFraction;

  // SECURITY FIX #7: Comprehensive XSS prevention in folder names
  // React automatically escapes text content when using {}, but we add defense-in-depth:
  // 1. Type validation to prevent object injection
  // 2. Remove script-injection characters and control characters
  // 3. Prevent empty strings that could cause layout issues
  const sanitizeFolderName = (name) => {
    if (typeof name !== 'string') return 'Unknown';

    // Remove dangerous characters for defense-in-depth:
    // - HTML tags: < > (prevent <script> injection)
    // - Quotes: ' " ` (prevent attribute injection)
    // - Null bytes: \0 (prevent string termination attacks)
    // - Control characters: \u0000-\u001F (prevent terminal injection if logged)
    const sanitized = name
      // eslint-disable-next-line no-control-regex
      .replace(/[<>'"`\u0000-\u001F]/g, '')
      .trim();

    return sanitized || 'Unknown';
  };

  const getConfidenceColor = (conf) => {
    if (conf >= 0.8) return 'text-stratosort-success';
    if (conf >= 0.5) return 'text-stratosort-warning';
    return 'text-stratosort-accent';
  };

  const getConfidenceLabel = (conf) => {
    if (conf >= 0.8) return 'Great Match';
    if (conf >= 0.5) return 'Good Match';
    return 'Possible Match';
  };

  return (
    <div className="space-y-4">
      {/* Primary Suggestion */}
      <Card className="p-4 border-stratosort-blue/30">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h4 className="font-medium text-system-gray-900">
                Suggested Organization
              </h4>
              <span
                className={`text-sm ${getConfidenceColor(confidenceFraction)}`}
              >
                {getConfidenceLabel(confidenceFraction)} (
                {confidencePercent}
                %)
              </span>
            </div>

            <div className="mb-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-system-gray-600">Folder:</span>
                <span className="font-medium text-stratosort-blue">
                  {sanitizeFolderName(primary.folder)}
                </span>
                {primary.path && (
                  <span className="text-system-gray-500">
                    ({sanitizeFolderName(primary.path)})
                  </span>
                )}
              </div>

              {explanation && (
                <p className="text-sm text-system-gray-600 mt-2 italic">
                  {explanation}
                </p>
              )}

              {primary.strategy && (
                <div className="mt-2 text-xs text-system-gray-500">
                  Strategy: {primary.strategyName || primary.strategy}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => onAccept && onAccept(file, primary)}
                className="bg-stratosort-blue hover:bg-stratosort-blue/90"
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onReject && onReject(file, primary)}
              >
                Reject
              </Button>
            </div>
          </div>

          {/* Confidence Indicator */}
          <div className="ml-4">
            <div className="w-16 h-16 relative">
              <svg className="transform -rotate-90 w-16 h-16">
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                  className="text-system-gray-200"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                  strokeDasharray={`${2 * Math.PI * 28 * safeConfidence} ${2 * Math.PI * 28}`}
                  className={getConfidenceColor(safeConfidence)}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-medium">
                  {Math.round(safeConfidence * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Alternative Suggestions */}
      {alternatives.length > 0 && (
        <div>
          <button
            onClick={() => setExpandedAlternatives(!expandedAlternatives)}
            className="flex items-center gap-2 text-sm text-system-gray-600 hover:text-stratosort-blue transition-colors"
          >
            <span
              className={`transform transition-transform ${expandedAlternatives ? 'rotate-90' : ''}`}
            >
              ▶
            </span>
            View {alternatives.length} alternative suggestion
            {alternatives.length > 1 ? 's' : ''}
          </button>

          {expandedAlternatives && (
            <div className="mt-3 space-y-2">
              {/* FIX: Use stable identifier (folder + confidence) instead of array index */}
              {alternatives.map((alt) => (
                <Card
                  key={`${alt.folder}-${alt.confidence}-${alt.method || 'default'}`}
                  className="p-3 border-system-gray-200 hover:border-stratosort-blue/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {sanitizeFolderName(alt.folder)}
                        </span>
                        <span
                          className={`text-xs ${getConfidenceColor(
                            normalizeConfidenceFraction(alt.confidence || 0),
                          )}`}
                        >
                          {Math.round(
                            normalizeConfidenceFraction(alt.confidence || 0) *
                              100,
                          )}
                          %
                        </span>
                      </div>
                      {alt.reasoning && (
                        <p className="text-xs text-system-gray-500 mt-1">
                          {alt.reasoning}
                        </p>
                      )}
                      {alt.method && (
                        <span className="text-xs text-system-gray-500">
                          Source: {alt.method.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onAccept(file, alt)}
                      className="text-stratosort-blue hover:bg-stratosort-blue/10"
                    >
                      Use This
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Organization Strategies */}
      {strategies.length > 0 && (
        <Card className="p-4 bg-system-gray-50">
          <h5 className="text-sm font-medium text-system-gray-700 mb-3">
            Organization Strategies
          </h5>
          <div className="space-y-2">
            {strategies.map((strategy) => (
              <div
                key={strategy.id}
                className={`p-2 rounded border cursor-pointer transition-all ${
                  selectedStrategy === strategy.id
                    ? 'border-stratosort-blue bg-stratosort-blue/5'
                    : 'border-system-gray-200 hover:border-system-gray-300'
                }`}
                onClick={() => handleStrategySelect(strategy.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{strategy.name}</div>
                    <div className="text-xs text-system-gray-600">
                      {strategy.description}
                    </div>
                    <div className="text-xs text-system-gray-500 mt-1">
                      Pattern: {strategy.pattern}
                    </div>
                  </div>
                  <div className="text-xs text-system-gray-500">
                    {Math.round(strategy.applicability * 100)}% match
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
});

const suggestionShape = PropTypes.shape({
  folder: PropTypes.string,
  path: PropTypes.string,
  confidence: PropTypes.number,
  reasoning: PropTypes.string,
  method: PropTypes.string,
  strategy: PropTypes.string,
  strategyName: PropTypes.string,
  suggestedName: PropTypes.string,
});

const strategyShape = PropTypes.shape({
  id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  name: PropTypes.string,
  description: PropTypes.string,
  pattern: PropTypes.string,
  applicability: PropTypes.number,
});

OrganizationSuggestions.propTypes = {
  file: PropTypes.shape({
    name: PropTypes.string.isRequired,
  }).isRequired,
  suggestions: PropTypes.shape({
    primary: suggestionShape.isRequired,
    alternatives: PropTypes.arrayOf(suggestionShape),
    strategies: PropTypes.arrayOf(strategyShape),
    confidence: PropTypes.number,
    explanation: PropTypes.string,
  }).isRequired,
  onAccept: PropTypes.func,
  onReject: PropTypes.func,
  onStrategyChange: PropTypes.func,
};

export default OrganizationSuggestions;
