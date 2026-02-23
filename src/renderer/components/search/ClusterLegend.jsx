/**
 * ClusterLegend - Interactive legend for cluster visualization
 *
 * Shows the meaning of different confidence levels, colors, and sizes
 * in the cluster graph visualization. Allows filtering by clicking items.
 */

import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Layers, FileText, HelpCircle, Check, Search } from 'lucide-react';
import { Button } from '../ui';
import { CONFIDENCE_COLORS, getConfidenceColor } from '../../utils/confidenceColors';

const CATEGORY_COLORS = {
  Documents: {
    bg: 'bg-stratosort-blue/10',
    border: 'border-stratosort-blue/30',
    text: 'text-stratosort-blue'
  },
  Spreadsheets: {
    bg: 'bg-stratosort-success/10',
    border: 'border-stratosort-success/30',
    text: 'text-stratosort-success'
  },
  Images: {
    bg: 'bg-stratosort-purple/10',
    border: 'border-stratosort-purple/30',
    text: 'text-stratosort-purple'
  },
  Code: {
    bg: 'bg-stratosort-accent/10',
    border: 'border-stratosort-accent/30',
    text: 'text-stratosort-accent'
  },
  Audio: {
    bg: 'bg-stratosort-indigo/10',
    border: 'border-stratosort-indigo/30',
    text: 'text-stratosort-indigo'
  },
  Videos: {
    bg: 'bg-stratosort-purple/10',
    border: 'border-stratosort-purple/30',
    text: 'text-stratosort-purple'
  }
};

const ClusterLegend = memo(
  ({
    className = '',
    compact = false,
    showHeader = true,
    activeFilters = { types: ['cluster', 'file'], confidence: ['high', 'medium', 'low'] },
    onToggleFilter
  }) => {
    const isTypeActive = (type) => activeFilters?.types?.includes(type);
    const isConfidenceActive = (conf) => activeFilters?.confidence?.includes(conf);

    const toggleType = (type) => onToggleFilter?.('types', type);
    const toggleConfidence = (conf) => onToggleFilter?.('confidence', conf);

    if (compact) {
      // Compact layout: single column, minimal noise
      return (
        <div className={`flex flex-col gap-2 text-xs text-system-gray-600 ${className}`}>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-stratosort-accent/10 text-stratosort-accent border border-stratosort-accent/30">
              Cluster
            </span>
            <span className="px-2 py-1 rounded-full bg-stratosort-blue/10 text-stratosort-blue border border-stratosort-blue/30">
              File
            </span>
            <span className="px-2 py-1 rounded-full bg-stratosort-indigo/10 text-stratosort-indigo border border-stratosort-indigo/30">
              Query
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${CONFIDENCE_COLORS.high.dotBg}`} />
              <span>High</span>
            </div>
            <div className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${CONFIDENCE_COLORS.medium.dotBg}`} />
              <span>Med</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-system-gray-400" />
              <span>Low</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <span className="w-6 h-0.5 bg-stratosort-blue rounded-full" />
              <span>Shared tags</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-6 h-0.5 border-t border-dashed border-system-gray-400" />
              <span>Similarity</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`bg-white/95 backdrop-blur-sm border border-system-gray-200 rounded-lg p-3 shadow-sm text-left ${className}`}
      >
        {showHeader && (
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-system-gray-700">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Legend & Filters</span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {/* Node types */}
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-system-gray-400 font-medium flex justify-between">
              <span>Node Types</span>
              <span className="text-xs text-system-gray-400 font-normal">Click to filter</span>
            </div>

            <Button
              onClick={() => toggleType('cluster')}
              aria-label="Toggle cluster nodes visibility"
              aria-pressed={isTypeActive('cluster')}
              variant="ghost"
              size="sm"
              className={`w-full justify-start text-left p-1 text-xs rounded-md h-auto ${
                isTypeActive('cluster')
                  ? 'hover:bg-stratosort-accent/10'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-md bg-stratosort-accent/10 border border-stratosort-accent/30 flex items-center justify-center">
                  <Layers className="w-2.5 h-2.5 text-stratosort-accent" aria-hidden="true" />
                </div>
                <span className="text-system-gray-600">Cluster</span>
              </div>
              {isTypeActive('cluster') && (
                <Check className="w-3 h-3 text-stratosort-accent ml-auto" aria-hidden="true" />
              )}
            </Button>

            <Button
              onClick={() => toggleType('file')}
              aria-label="Toggle file nodes visibility"
              aria-pressed={isTypeActive('file')}
              variant="ghost"
              size="sm"
              className={`w-full justify-start text-left p-1 text-xs rounded-md h-auto ${
                isTypeActive('file')
                  ? 'hover:bg-stratosort-blue/10'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-md bg-white border border-system-gray-200 flex items-center justify-center">
                  <FileText className="w-2.5 h-2.5 text-stratosort-blue" aria-hidden="true" />
                </div>
                <span className="text-system-gray-600">File</span>
              </div>
              {isTypeActive('file') && (
                <Check className="w-3 h-3 text-stratosort-blue ml-auto" aria-hidden="true" />
              )}
            </Button>

            <Button
              onClick={() => toggleType('query')}
              aria-label="Toggle query node visibility"
              aria-pressed={isTypeActive('query')}
              variant="ghost"
              size="sm"
              className={`w-full justify-start text-left p-1 text-xs rounded-md h-auto ${
                isTypeActive('query')
                  ? 'hover:bg-stratosort-indigo/10'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-md bg-stratosort-indigo/10 border border-stratosort-indigo/30 flex items-center justify-center">
                  <Search className="w-2.5 h-2.5 text-stratosort-indigo" aria-hidden="true" />
                </div>
                <span className="text-system-gray-600">Query</span>
              </div>
              {isTypeActive('query') && (
                <Check className="w-3 h-3 text-stratosort-indigo ml-auto" aria-hidden="true" />
              )}
            </Button>
          </div>

          {/* Connection Logic (New) */}
          <div className="space-y-1 pt-2 border-t border-system-gray-100">
            <div className="text-xs uppercase tracking-wider text-system-gray-400 font-medium">
              Connection Logic
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <div className="w-8 h-0.5 bg-stratosort-blue rounded-full" />
                <span className="text-system-gray-600">Shared Tags</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-8 h-0.5 bg-stratosort-purple rounded-full" />
                <span className="text-system-gray-600">Same Category</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-8 h-0.5 bg-stratosort-success rounded-full" />
                <span className="text-system-gray-600">Content Match</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-8 h-0.5 border-t border-dashed border-system-gray-400" />
                <span className="text-system-gray-600">Vector Similarity</span>
              </div>
            </div>
          </div>

          {/* NEW: File Categories */}
          <div className="space-y-1 pt-2 border-t border-system-gray-100">
            <div className="text-xs uppercase tracking-wider text-system-gray-400 font-medium">
              File Categories
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(CATEGORY_COLORS).map(([cat, style]) => (
                <div key={cat} className="flex items-center gap-2 text-xs">
                  <div className={`w-3 h-3 rounded-md border ${style.bg} ${style.border}`} />
                  <span className="text-system-gray-600">{cat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Confidence levels */}
          <div className="space-y-1 pt-2 border-t border-system-gray-100">
            <div className="text-xs uppercase tracking-wider text-system-gray-400 font-medium">
              Cluster Confidence
            </div>

            <Button
              onClick={() => toggleConfidence('high')}
              aria-label="Toggle high confidence clusters"
              aria-pressed={isConfidenceActive('high')}
              variant="ghost"
              size="sm"
              className={`w-full justify-start text-left p-1 text-xs rounded-md h-auto ${
                isConfidenceActive('high')
                  ? 'hover:bg-stratosort-success/10'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded-md text-xs border min-w-[50px] text-center ${getConfidenceColor('high')}`}
                >
                  <span aria-hidden="true">{CONFIDENCE_COLORS.high.dot}</span>{' '}
                  {CONFIDENCE_COLORS.high.label}
                </span>
                <span className="text-system-gray-500">{CONFIDENCE_COLORS.high.desc}</span>
              </div>
              {isConfidenceActive('high') && (
                <Check className="w-3 h-3 text-stratosort-success ml-auto" aria-hidden="true" />
              )}
            </Button>

            <Button
              onClick={() => toggleConfidence('medium')}
              aria-label="Toggle medium confidence clusters"
              aria-pressed={isConfidenceActive('medium')}
              variant="ghost"
              size="sm"
              className={`w-full justify-start text-left p-1 text-xs rounded-md h-auto ${
                isConfidenceActive('medium')
                  ? 'hover:bg-stratosort-blue/10'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded-md text-xs border min-w-[50px] text-center ${getConfidenceColor('medium')}`}
                >
                  <span aria-hidden="true">{CONFIDENCE_COLORS.medium.dot}</span>{' '}
                  {CONFIDENCE_COLORS.medium.label}
                </span>
                <span className="text-system-gray-500">{CONFIDENCE_COLORS.medium.desc}</span>
              </div>
              {isConfidenceActive('medium') && (
                <Check className="w-3 h-3 text-stratosort-blue ml-auto" aria-hidden="true" />
              )}
            </Button>

            <Button
              onClick={() => toggleConfidence('low')}
              aria-label="Toggle low confidence clusters"
              aria-pressed={isConfidenceActive('low')}
              variant="ghost"
              size="sm"
              className={`w-full justify-start text-left p-1 text-xs rounded-md h-auto ${
                isConfidenceActive('low')
                  ? 'hover:bg-system-gray-50'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded-md text-xs border min-w-[50px] text-center ${getConfidenceColor('low')}`}
                >
                  <span aria-hidden="true">{CONFIDENCE_COLORS.low.dot}</span>{' '}
                  {CONFIDENCE_COLORS.low.label}
                </span>
                <span className="text-system-gray-500">{CONFIDENCE_COLORS.low.desc}</span>
              </div>
              {isConfidenceActive('low') && (
                <Check className="w-3 h-3 text-system-gray-500 ml-auto" aria-hidden="true" />
              )}
            </Button>
          </div>

          {/* Interactions (Static) */}
          <div className="space-y-1 pt-2 border-t border-system-gray-100">
            <div className="text-xs uppercase tracking-wider text-system-gray-400 font-medium">
              Interactions
            </div>
            <div className="text-xs text-system-gray-500 space-y-0.5 px-1">
              <div>Double-click to expand cluster</div>
              <div>Drag to rearrange nodes</div>
              <div>Hover lines for connection info</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ClusterLegend.displayName = 'ClusterLegend';

ClusterLegend.propTypes = {
  className: PropTypes.string,
  compact: PropTypes.bool,
  showHeader: PropTypes.bool,
  activeFilters: PropTypes.shape({
    types: PropTypes.arrayOf(PropTypes.string),
    confidence: PropTypes.arrayOf(PropTypes.string)
  }),
  onToggleFilter: PropTypes.func
};

export default ClusterLegend;
