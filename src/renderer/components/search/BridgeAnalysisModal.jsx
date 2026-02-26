import React, { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import { Network, ArrowRight, FileText } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Heading, Text } from '../ui/Typography';
import FileIcon from '../ui/FileIcon';
import { useFileActions } from '../../hooks/useFileActions';
import { safeBasename } from '../../utils/pathUtils';

const resolveBridgePath = (file) => {
  if (!file || typeof file !== 'object') return '';
  const directPath =
    typeof file.path === 'string' && file.path.trim()
      ? file.path.trim()
      : typeof file.filePath === 'string' && file.filePath.trim()
        ? file.filePath.trim()
        : '';
  if (directPath) return directPath;

  const id = typeof file.id === 'string' ? file.id.trim() : '';
  if (!id) return '';
  const stripped = id.replace(/^(file|image):/i, '').trim();
  if (!stripped) return '';
  return /^[A-Za-z]:[\\/]/.test(stripped) || stripped.startsWith('/') || /[\\/]/.test(stripped)
    ? stripped
    : '';
};

const resolveBridgeName = (file, resolvedPath) =>
  (typeof file?.name === 'string' && file.name.trim()) ||
  (typeof file?.fileName === 'string' && file.fileName.trim()) ||
  safeBasename(resolvedPath || '') ||
  safeBasename(String(file?.id || '')) ||
  'Indexed file';

/**
 * BridgeAnalysisModal
 *
 * A modal for analyzing bridge connections between clusters.
 * Shows a list of bridges and the files that create them.
 */
export default function BridgeAnalysisModal({
  isOpen,
  onClose,
  bridges = [], // Array of edges with data.kind === 'cross_cluster'
  clusters = [] // Array of cluster nodes
}) {
  const { openFile, revealFile } = useFileActions();
  const [selectedBridgeId, setSelectedBridgeId] = useState(null);

  // Map cluster ID to cluster node for quick lookup
  const clusterMap = useMemo(() => {
    return new Map(clusters.map((c) => [c.id, c]));
  }, [clusters]);

  // Enrich bridges with cluster names
  const enrichedBridges = useMemo(() => {
    return bridges
      .map((bridge) => {
        const source = clusterMap.get(bridge.source);
        const target = clusterMap.get(bridge.target);
        return {
          ...bridge,
          sourceLabel: source?.data?.label || 'Unknown Cluster',
          targetLabel: target?.data?.label || 'Unknown Cluster',
          bridgeFiles: bridge.data?.bridgeFiles || []
        };
      })
      .filter((b) => b.bridgeFiles.length > 0);
  }, [bridges, clusterMap]);

  const selectedBridge = useMemo(() => {
    return enrichedBridges.find((b) => b.id === selectedBridgeId) || enrichedBridges[0];
  }, [enrichedBridges, selectedBridgeId]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Bridge Analysis"
      description="Explore how your topic clusters are connected."
      size="xl"
    >
      <div className="flex h-[60vh] gap-6">
        {/* Sidebar: List of Bridges */}
        <div className="w-1/3 border-r border-system-gray-100 pr-4 overflow-y-auto">
          <Heading as="h4" variant="h6" className="mb-3 text-system-gray-700">
            Connections ({enrichedBridges.length})
          </Heading>
          <div className="space-y-2">
            {enrichedBridges.map((bridge) => (
              <div
                key={bridge.id}
                className={`
                  p-3 rounded-lg cursor-pointer transition-colors border
                  ${
                    selectedBridge?.id === bridge.id
                      ? 'bg-stratosort-blue/5 border-stratosort-blue/20'
                      : 'bg-white border-transparent hover:bg-system-gray-50'
                  }
                `}
                onClick={() => setSelectedBridgeId(bridge.id)}
              >
                <div className="flex items-center gap-2">
                  <Text
                    as="span"
                    variant="small"
                    className="font-medium text-system-gray-900 truncate max-w-[45%]"
                  >
                    {bridge.sourceLabel}
                  </Text>
                  <ArrowRight className="w-3 h-3 text-system-gray-400 shrink-0" />
                  <Text
                    as="span"
                    variant="small"
                    className="font-medium text-system-gray-900 truncate max-w-[45%]"
                  >
                    {bridge.targetLabel}
                  </Text>
                </div>
                <Text variant="tiny" className="mt-1">
                  {bridge.bridgeFiles.length} connecting file
                  {bridge.bridgeFiles.length !== 1 ? 's' : ''}
                </Text>
              </div>
            ))}
            {enrichedBridges.length === 0 && (
              <div className="text-center py-8 text-system-gray-400">
                <Network className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <Text variant="small">No bridges found.</Text>
              </div>
            )}
          </div>
        </div>

        {/* Main Content: Selected Bridge Details */}
        <div className="flex-1 overflow-y-auto pl-2">
          {selectedBridge ? (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Text
                    as="span"
                    variant="small"
                    className="px-3 py-1 bg-stratosort-indigo/10 text-stratosort-indigo rounded-full font-medium"
                  >
                    {selectedBridge.sourceLabel}
                  </Text>
                  <ArrowRight className="w-5 h-5 text-system-gray-400" />
                  <Text
                    as="span"
                    variant="small"
                    className="px-3 py-1 bg-stratosort-purple/10 text-stratosort-purple rounded-full font-medium"
                  >
                    {selectedBridge.targetLabel}
                  </Text>
                </div>
              </div>

              {/* Narrative */}
              <div className="bg-system-gray-50 p-4 rounded-xl border border-system-gray-100">
                <Heading as="h5" variant="h6" className="mb-2 text-system-gray-900">
                  Why are they connected?
                </Heading>
                <Text className="text-system-gray-600">
                  {selectedBridge.bridgeFiles.length} bridge file
                  {selectedBridge.bridgeFiles.length !== 1 ? 's' : ''} indicate
                  {selectedBridge.bridgeFiles.length === 1 ? 's' : ''} semantic overlap between{' '}
                  <strong>{selectedBridge.sourceLabel}</strong> and{' '}
                  <strong>{selectedBridge.targetLabel}</strong>.
                </Text>
              </div>

              {/* Bridge Files */}
              <div>
                <Heading
                  as="h5"
                  variant="h6"
                  className="mb-3 text-system-gray-900 flex items-center gap-2"
                >
                  <FileText className="w-4 h-4 text-system-gray-500" />
                  Connecting Documents
                </Heading>
                <div className="space-y-2">
                  {selectedBridge.bridgeFiles.map((file, index) => {
                    const path = resolveBridgePath(file);
                    const name = resolveBridgeName(file, path);
                    const key = file?.id || path || `bridge-file-${index}`;
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-3 p-3 rounded-lg border border-system-gray-200 bg-white hover:border-system-gray-300 transition-colors group"
                      >
                        <FileIcon fileName={name} className="w-8 h-8 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <Text
                            variant="small"
                            className="font-medium text-system-gray-900 truncate"
                          >
                            {name}
                          </Text>
                          <Text variant="tiny" className="truncate">
                            {path || 'Indexed in knowledge base (path unavailable)'}
                          </Text>
                        </div>
                        {path && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="xs" variant="ghost" onClick={() => openFile(path)}>
                              Open
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => revealFile(path)}>
                              Reveal
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-system-gray-400">
              <Text>Select a connection to view details.</Text>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

BridgeAnalysisModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  bridges: PropTypes.array,
  clusters: PropTypes.array
};
