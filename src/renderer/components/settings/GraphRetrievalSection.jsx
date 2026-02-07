import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import SettingRow from './SettingRow';
import { Text } from '../ui/Typography';
import { Stack } from '../layout';
import { logger } from '../../../shared/logger';

const DEFAULT_WEIGHT = 0.2;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 1;

const DEFAULT_NEIGHBORS = 120;
const NEIGHBORS_MIN = 10;
const NEIGHBORS_MAX = 500;

const DEFAULT_CONTEXT_NEIGHBORS = 1;
const CONTEXT_NEIGHBORS_MIN = 0;
const CONTEXT_NEIGHBORS_MAX = 3;

function clampNumber(value, min, max, fallback) {
  const safe = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, safe));
}

function GraphRetrievalSection({ settings, setSettings }) {
  const [stats, setStats] = useState(null);
  const [historyStats, setHistoryStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateSetting = useCallback(
    (key, value) => {
      setSettings((prev) => ({
        ...prev,
        [key]: value
      }));
    },
    [setSettings]
  );

  const weight = clampNumber(settings.graphExpansionWeight, WEIGHT_MIN, WEIGHT_MAX, DEFAULT_WEIGHT);
  const weightPercent = Math.round(weight * 100);

  const neighbors = clampNumber(
    settings.graphExpansionMaxNeighbors,
    NEIGHBORS_MIN,
    NEIGHBORS_MAX,
    DEFAULT_NEIGHBORS
  );

  const contextNeighbors = clampNumber(
    settings.chunkContextMaxNeighbors,
    CONTEXT_NEIGHBORS_MIN,
    CONTEXT_NEIGHBORS_MAX,
    DEFAULT_CONTEXT_NEIGHBORS
  );

  const formattedUpdatedAt = useMemo(() => {
    if (!stats?.updatedAt) return 'Not built yet';
    try {
      return new Date(stats.updatedAt).toLocaleString();
    } catch {
      return stats.updatedAt;
    }
  }, [stats?.updatedAt]);

  const formattedSourceUpdatedAt = useMemo(() => {
    if (!stats?.sourceUpdatedAt) return 'Unknown';
    try {
      return new Date(stats.sourceUpdatedAt).toLocaleString();
    } catch {
      return stats.sourceUpdatedAt;
    }
  }, [stats?.sourceUpdatedAt]);

  const formattedHistoryUpdatedAt = useMemo(() => {
    if (!historyStats?.lastUpdated) return 'Unknown';
    try {
      return new Date(historyStats.lastUpdated).toLocaleString();
    } catch {
      return historyStats.lastUpdated;
    }
  }, [historyStats?.lastUpdated]);

  const refreshStats = useCallback(async () => {
    const getRelationshipStats = window?.electronAPI?.knowledge?.getRelationshipStats;
    const getHistoryStats = window?.electronAPI?.analysisHistory?.getStatistics;
    if (typeof getRelationshipStats !== 'function') return;
    if (isMountedRef.current) setIsLoading(true);
    try {
      const [response, historyResponse] = await Promise.all([
        getRelationshipStats(),
        typeof getHistoryStats === 'function' ? getHistoryStats() : Promise.resolve(null)
      ]);
      if (isMountedRef.current) {
        if (response?.success) {
          setStats(response);
        } else {
          setStats(null);
        }
        if (historyResponse && !historyResponse?.success) {
          setHistoryStats(null);
        } else if (historyResponse) {
          setHistoryStats(historyResponse);
        }
      }
    } catch (error) {
      logger.debug('[GraphRetrievalSection] Failed to fetch graph stats', {
        error: error?.message
      });
      if (isMountedRef.current) setStats(null);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load stats on mount so UI is always up to date.
    refreshStats();
  }, [refreshStats]);

  return (
    <Card variant="default" className="space-y-5">
      <div>
        <Text variant="tiny" className="font-semibold uppercase tracking-wide text-system-gray-500">
          Graph retrieval
        </Text>
        <Text variant="small" className="text-system-gray-600">
          Configure GraphRAG-lite expansion and contextual chunk retrieval.
        </Text>
      </div>

      <Stack gap="relaxed">
        <SettingRow
          label="Enable graph expansion"
          description="Use relationship edges to pull related files into search results."
        >
          <Switch
            checked={settings.graphExpansionEnabled !== false}
            onChange={(checked) => updateSetting('graphExpansionEnabled', checked)}
          />
        </SettingRow>

        <SettingRow
          label="Graph expansion weight"
          description="How much graph neighbors can influence ranking."
        >
          <div className="w-full space-y-2">
            <div className="flex items-center justify-between">
              <Text variant="tiny" className="text-system-gray-500">
                Weight
              </Text>
              <Text variant="tiny" className="font-medium text-stratosort-blue">
                {weightPercent}%
              </Text>
            </div>
            <input
              type="range"
              min={Math.round(WEIGHT_MIN * 100)}
              max={Math.round(WEIGHT_MAX * 100)}
              step="1"
              value={weightPercent}
              onChange={(e) => {
                const next = clampNumber(
                  Number(e.target.value) / 100,
                  WEIGHT_MIN,
                  WEIGHT_MAX,
                  weight
                );
                updateSetting('graphExpansionWeight', next);
              }}
              aria-label="Graph expansion weight"
              className="w-full accent-stratosort-blue"
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Graph neighbors limit"
          description="Maximum number of neighbor files added per query."
          layout="col"
        >
          <Input
            type="number"
            min={NEIGHBORS_MIN}
            max={NEIGHBORS_MAX}
            value={neighbors}
            onChange={(e) => {
              const next = clampNumber(
                Number(e.target.value),
                NEIGHBORS_MIN,
                NEIGHBORS_MAX,
                neighbors
              );
              updateSetting('graphExpansionMaxNeighbors', Math.round(next));
            }}
          />
        </SettingRow>

        <SettingRow
          label="Contextual chunk expansion"
          description="Include adjacent chunks around the best chunk match."
        >
          <Switch
            checked={settings.chunkContextEnabled !== false}
            onChange={(checked) => updateSetting('chunkContextEnabled', checked)}
          />
        </SettingRow>

        <SettingRow
          label="Adjacent chunks"
          description="How many neighboring chunks to include on each side."
          layout="col"
        >
          <Input
            type="number"
            min={CONTEXT_NEIGHBORS_MIN}
            max={CONTEXT_NEIGHBORS_MAX}
            value={contextNeighbors}
            onChange={(e) => {
              const next = clampNumber(
                Number(e.target.value),
                CONTEXT_NEIGHBORS_MIN,
                CONTEXT_NEIGHBORS_MAX,
                contextNeighbors
              );
              updateSetting('chunkContextMaxNeighbors', Math.round(next));
            }}
          />
        </SettingRow>

        <SettingRow
          label="Knowledge graph status"
          description="Shows the local relationship index status built from analysis history."
          layout="col"
        >
          <div className="rounded-lg border border-system-gray-100 bg-system-gray-50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Text variant="small" className="text-system-gray-700">
                {stats?.edgeCount != null ? `${stats.edgeCount} edges (max 2000)` : 'No index yet'}
              </Text>
              <Button
                variant="ghost"
                size="xs"
                onClick={refreshStats}
                disabled={isLoading || !window?.electronAPI?.knowledge?.getRelationshipStats}
              >
                {isLoading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            <Text variant="tiny" className="text-system-gray-500">
              Concepts: {stats?.conceptCount ?? '—'} • Documents: {stats?.docCount ?? '—'}
            </Text>
            <Text variant="tiny" className="text-system-gray-500">
              Analysis history files: {historyStats?.totalFiles ?? '—'} • History updated:{' '}
              {formattedHistoryUpdatedAt}
            </Text>
            <Text variant="tiny" className="text-system-gray-500">
              Graph documents count includes only files with extracted concepts (may be lower than
              total analyzed files).
            </Text>
            <Text variant="tiny" className="text-system-gray-500">
              Last built: {formattedUpdatedAt}
            </Text>
            <Text variant="tiny" className="text-system-gray-500">
              Source data: Analysis history updated {formattedSourceUpdatedAt}
            </Text>
          </div>
        </SettingRow>
      </Stack>
    </Card>
  );
}

GraphRetrievalSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default GraphRetrievalSection;
