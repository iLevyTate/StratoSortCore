import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { X, FileText, Folder, Plus, FolderInput } from 'lucide-react';
import { Button } from '../ui';
import { Text } from '../ui/Typography';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { useSelector } from 'react-redux';
import { selectRedactPaths } from '../../store/selectors';

function ScopeItem({ item, onRemove }) {
  const redactPaths = useSelector(selectRedactPaths);
  const isFolder = item.type === 'folder';

  return (
    <div className="flex items-center justify-between p-2 rounded-md bg-white border border-system-gray-200 mb-1 group">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isFolder ? (
          <Folder className="w-4 h-4 text-stratosort-blue shrink-0" />
        ) : (
          <FileText className="w-4 h-4 text-system-gray-400 shrink-0" />
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate" title={item.path}>
            {item.name || 'Unknown'}
          </span>
          <span className="text-[10px] text-system-gray-400 truncate">
            {formatDisplayPath(item.path, { redact: redactPaths, segments: 1 })}
          </span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="opacity-0 group-hover:opacity-100 p-1 h-auto text-system-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"
        onClick={() => onRemove(item.id)}
        title="Remove from scope"
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
}

ScopeItem.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    path: PropTypes.string.isRequired,
    name: PropTypes.string,
    type: PropTypes.string
  }).isRequired,
  onRemove: PropTypes.func.isRequired
};

export default function DocumentScopePanel({
  scope,
  onAddToScope,
  onRemoveFromScope,
  onClearScope,
  className = ''
}) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsOver(false);

      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        const files = Array.from(droppedFiles).map((f) => ({
          path: f.path,
          name: f.name,
          type: 'file'
        }));
        onAddToScope(files);
      }
    },
    [onAddToScope]
  );

  const handleAddClick = async () => {
    // Use the existing files.select() API from the preload bridge
    const result = await window.electronAPI?.files?.select?.();

    if (result && Array.isArray(result) && result.length > 0) {
      const files = result.map((p) => ({
        path: p,
        name: p.split(/[/\\]/).pop(),
        type: 'unknown'
      }));
      onAddToScope(files);
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-system-gray-50 border-l border-system-gray-200 ${className}`}
    >
      <div className="p-3 border-b border-system-gray-200 flex items-center justify-between">
        <Text variant="small" className="font-semibold text-system-gray-800">
          Document Scope
        </Text>
        {scope.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onClearScope}
            className="text-xs text-system-gray-500"
          >
            Clear
          </Button>
        )}
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 overflow-y-auto p-2 transition-colors ${
          isOver ? 'bg-stratosort-blue/5 border-2 border-dashed border-stratosort-blue/30' : ''
        }`}
      >
        {scope.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4 text-system-gray-400">
            <FolderInput className="w-8 h-8 mb-2 opacity-20" />
            <Text variant="tiny" className="mb-2">
              Drag files or folders here to limit chat to specific documents.
            </Text>
            <Button variant="secondary" size="sm" onClick={handleAddClick}>
              <Plus className="w-3 h-3 mr-1" /> Add Files
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-end mb-2">
              <Button variant="ghost" size="xs" onClick={handleAddClick}>
                <Plus className="w-3 h-3 mr-1" /> Add More
              </Button>
            </div>
            {scope.map((item) => (
              <ScopeItem key={item.id} item={item} onRemove={onRemoveFromScope} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

DocumentScopePanel.propTypes = {
  scope: PropTypes.arrayOf(PropTypes.object).isRequired,
  onAddToScope: PropTypes.func.isRequired,
  onRemoveFromScope: PropTypes.func.isRequired,
  onClearScope: PropTypes.func.isRequired,
  className: PropTypes.string
};
