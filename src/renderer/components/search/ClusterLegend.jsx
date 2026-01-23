/**
 * ClusterLegend - Interactive legend for cluster visualization
 *
 * Shows the meaning of different confidence levels, colors, and sizes
 * in the cluster graph visualization. Allows filtering by clicking items.
 */

import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { Layers, FileText, HelpCircle, Check, Search } from 'lucide-react';
import { CONFIDENCE_COLORS, getConfidenceColor } from '../../utils/confidenceColors';

const CATEGORY_COLORS = {
  Documents: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  Spreadsheets: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
  Images: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
  Code: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
  Audio: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700' },
  Videos: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700' }
};

const ClusterLegend = memo(
  ({
    className = '',
    compact = false,
    activeFilters = { types: ['cluster', 'file'], confidence: ['high', 'medium', 'low'] },
    onToggleFilter
  }) => {
    const isTypeActive = (type) => activeFilters?.types?.includes(type);
    const isConfidenceActive = (conf) => activeFilters?.confidence?.includes(conf);

    const toggleType = (type) => onToggleFilter?.('types', type);
    const toggleConfidence = (conf) => onToggleFilter?.('confidence', conf);

    if (compact) {
      // Compact inline legend (non-interactive for now, or minimal)
      return (
        <div className={`flex items-center gap-3 text-[10px] text-system-gray-500 ${className}`}>
          <div className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${CONFIDENCE_COLORS.high.bg.replace('100', '500')}`}
            />
            <span>High</span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${CONFIDENCE_COLORS.medium.bg.replace('100', '500')}`}
            />
            <span>Medium</span>
          </div>
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full bg-system-gray-400`} />
            <span>Low</span>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`bg-white/95 backdrop-blur-sm border border-system-gray-200 rounded-lg p-3 shadow-sm ${className}`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-system-gray-700">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Legend & Filters</span>
          </div>
        </div>

        <div className="space-y-3">
          {/* Node types */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium flex justify-between">
              <span>Node Types</span>
              <span className="text-[9px] text-system-gray-400 font-normal">Click to filter</span>
            </div>

            <button
              onClick={() => toggleType('cluster')}
              aria-label="Toggle cluster nodes visibility"
              aria-pressed={isTypeActive('cluster')}
              className={`w-full flex items-center justify-between gap-2 text-[11px] p-1 rounded transition-colors ${
                isTypeActive('cluster')
                  ? 'hover:bg-amber-50'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-300 flex items-center justify-center">
                  <Layers className="w-2.5 h-2.5 text-amber-600" aria-hidden="true" />
                </div>
                <span className="text-system-gray-600">Cluster</span>
              </div>
              {isTypeActive('cluster') && (
                <Check className="w-3 h-3 text-amber-600" aria-hidden="true" />
              )}
            </button>

            <button
              onClick={() => toggleType('file')}
              aria-label="Toggle file nodes visibility"
              aria-pressed={isTypeActive('file')}
              className={`w-full flex items-center justify-between gap-2 text-[11px] p-1 rounded transition-colors ${
                isTypeActive('file') ? 'hover:bg-blue-50' : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-white border border-system-gray-200 flex items-center justify-center">
                  <FileText className="w-2.5 h-2.5 text-stratosort-blue" aria-hidden="true" />
                </div>
                <span className="text-system-gray-600">File</span>
              </div>
              {isTypeActive('file') && (
                <Check className="w-3 h-3 text-stratosort-blue" aria-hidden="true" />
              )}
            </button>

            <button
              onClick={() => toggleType('query')}
              aria-label="Toggle query node visibility"
              aria-pressed={isTypeActive('query')}
              className={`w-full flex items-center justify-between gap-2 text-[11px] p-1 rounded transition-colors ${
                isTypeActive('query')
                  ? 'hover:bg-indigo-50'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-300 flex items-center justify-center">
                  <Search className="w-2.5 h-2.5 text-indigo-600" aria-hidden="true" />
                </div>
                <span className="text-system-gray-600">Query</span>
              </div>
              {isTypeActive('query') && (
                <Check className="w-3 h-3 text-indigo-600" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* NEW: File Categories */}
          <div className="space-y-1 pt-2 border-t border-system-gray-100">
            <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium">
              File Categories
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(CATEGORY_COLORS).map(([cat, style]) => (
                <div key={cat} className="flex items-center gap-2 text-[10px]">
                  <div className={`w-3 h-3 rounded border ${style.bg} ${style.border}`} />
                  <span className="text-system-gray-600">{cat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Confidence levels */}
          <div className="space-y-1 pt-2 border-t border-system-gray-100">
            <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium">
              Cluster Confidence
            </div>

            <button
              onClick={() => toggleConfidence('high')}
              aria-label="Toggle high confidence clusters"
              aria-pressed={isConfidenceActive('high')}
              className={`w-full flex items-center justify-between gap-2 text-[11px] p-1 rounded transition-colors ${
                isConfidenceActive('high')
                  ? 'hover:bg-emerald-50'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] border min-w-[50px] text-center ${getConfidenceColor('high')}`}
                >
                  <span aria-hidden="true">{CONFIDENCE_COLORS.high.dot}</span>{' '}
                  {CONFIDENCE_COLORS.high.label}
                </span>
                <span className="text-system-gray-500">{CONFIDENCE_COLORS.high.desc}</span>
              </div>
              {isConfidenceActive('high') && (
                <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
              )}
            </button>

            <button
              onClick={() => toggleConfidence('medium')}
              aria-label="Toggle medium confidence clusters"
              aria-pressed={isConfidenceActive('medium')}
              className={`w-full flex items-center justify-between gap-2 text-[11px] p-1 rounded transition-colors ${
                isConfidenceActive('medium')
                  ? 'hover:bg-blue-50'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] border min-w-[50px] text-center ${getConfidenceColor('medium')}`}
                >
                  <span aria-hidden="true">{CONFIDENCE_COLORS.medium.dot}</span>{' '}
                  {CONFIDENCE_COLORS.medium.label}
                </span>
                <span className="text-system-gray-500">{CONFIDENCE_COLORS.medium.desc}</span>
              </div>
              {isConfidenceActive('medium') && (
                <Check className="w-3 h-3 text-blue-600" aria-hidden="true" />
              )}
            </button>

            <button
              onClick={() => toggleConfidence('low')}
              aria-label="Toggle low confidence clusters"
              aria-pressed={isConfidenceActive('low')}
              className={`w-full flex items-center justify-between gap-2 text-[11px] p-1 rounded transition-colors ${
                isConfidenceActive('low')
                  ? 'hover:bg-system-gray-50'
                  : 'opacity-50 grayscale hover:opacity-75'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] border min-w-[50px] text-center ${getConfidenceColor('low')}`}
                >
                  <span aria-hidden="true">{CONFIDENCE_COLORS.low.dot}</span>{' '}
                  {CONFIDENCE_COLORS.low.label}
                </span>
                <span className="text-system-gray-500">{CONFIDENCE_COLORS.low.desc}</span>
              </div>
              {isConfidenceActive('low') && (
                <Check className="w-3 h-3 text-system-gray-500" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Interactions (Static) */}
          <div className="space-y-1 pt-2 border-t border-system-gray-100">
            <div className="text-[10px] uppercase tracking-wider text-system-gray-400 font-medium">
              Interactions
            </div>
            <div className="text-[10px] text-system-gray-500 space-y-0.5 px-1">
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
  activeFilters: PropTypes.shape({
    types: PropTypes.arrayOf(PropTypes.string),
    confidence: PropTypes.arrayOf(PropTypes.string)
  }),
  onToggleFilter: PropTypes.func
};

export default ClusterLegend;
