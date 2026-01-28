import React, { useEffect, useState, memo } from 'react';
import { useSelector } from 'react-redux';
import {
  Folder,
  FolderOpen,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Sparkles
} from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Card from '../ui/Card';
import { Heading, Text, Caption } from '../ui/Typography';
import { formatDisplayPath } from '../../utils/pathDisplay';

const SmartFolderItem = memo(function SmartFolderItem({
  folder,
  index = 0,
  editingFolder,
  setEditingFolder,
  isSavingEdit,
  isDeleting,
  onSaveEdit,
  onCancelEdit,
  onEditStart,
  onDeleteFolder,
  onCreateDirectory,
  onOpenFolder,
  addNotification,
  compact = false,
  isExpanded = true,
  onToggleExpand
}) {
  const isEditing = editingFolder?.id === folder.id;
  const [hasMounted, setHasMounted] = useState(false);
  const redactPaths = useSelector((state) => Boolean(state?.system?.redactPaths));
  const displayPath = formatDisplayPath(folder.path || '', { redact: redactPaths, segments: 2 });

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const shouldAnimateEntrance = !hasMounted;
  const cardAnimationClass = shouldAnimateEntrance ? 'animate-slide-in-right' : '';
  const cardAnimationDelay = shouldAnimateEntrance ? `${index * 0.05}s` : undefined;

  // Compact view
  if (compact && !isExpanded && !isEditing) {
    return (
      <Card
        variant="interactive"
        className="flex items-center gap-4 p-4"
        onClick={() => onToggleExpand?.(folder.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand?.(folder.id);
          }
        }}
      >
        <div className="h-10 w-10 rounded-xl bg-stratosort-blue/10 text-stratosort-blue flex items-center justify-center shrink-0">
          <Folder className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <Text variant="body" className="font-medium truncate">
            {folder.name}
          </Text>
          <Text variant="tiny" className="truncate">
            {displayPath}
          </Text>
        </div>
        <ChevronDown className="w-4 h-4 text-system-gray-400 shrink-0" />
      </Card>
    );
  }

  // Edit mode
  if (isEditing) {
    return (
      <Card
        variant="elevated"
        className={`flex flex-col gap-4 ${cardAnimationClass}`}
        style={{ animationDelay: cardAnimationDelay }}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-stratosort-blue/10 text-stratosort-blue flex items-center justify-center">
            <Edit2 className="w-5 h-5" />
          </div>
          <div>
            <Heading as="h4" variant="h6">
              Editing Smart Folder
            </Heading>
            <Text variant="tiny">Press Enter to save, Escape to cancel</Text>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <Input
            value={editingFolder.name || ''}
            onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
            className="flex-1"
            placeholder="Folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
          />
          <Input
            type={redactPaths ? 'password' : 'text'}
            value={editingFolder.path || ''}
            onChange={(e) => setEditingFolder({ ...editingFolder, path: e.target.value })}
            className="flex-1"
            placeholder="Folder path"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
          />
        </div>

        <div className="relative">
          <Textarea
            value={editingFolder.description || ''}
            onChange={(e) => setEditingFolder({ ...editingFolder, description: e.target.value })}
            className="w-full pr-10"
            placeholder="Describe what types of files should go in this folder..."
            rows={2}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const result = await window.electronAPI?.smartFolders?.generateDescription?.(
                  editingFolder.name
                );
                if (result?.success && result.description) {
                  setEditingFolder({ ...editingFolder, description: result.description });
                  addNotification?.('Description generated', 'success');
                } else {
                  addNotification?.(result?.error || 'Failed to generate description', 'error');
                }
              } catch {
                addNotification?.('Failed to generate description', 'error');
              }
            }}
            className="absolute right-2 top-2 p-1.5 text-system-gray-400 hover:text-stratosort-blue hover:bg-stratosort-blue/10 rounded-lg transition-colors"
            title="Generate description with AI"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onCancelEdit} disabled={isSavingEdit} variant="secondary" size="sm">
            Cancel
          </Button>
          <Button onClick={onSaveEdit} disabled={isSavingEdit} variant="primary" size="sm">
            {isSavingEdit ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </Card>
    );
  }

  // Expanded view
  return (
    <Card
      variant="default"
      className={`flex flex-col gap-4 h-full ${cardAnimationClass}`}
      style={{ animationDelay: cardAnimationDelay }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-stratosort-blue/10 text-stratosort-blue flex items-center justify-center shrink-0">
            <Folder className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {compact && onToggleExpand && (
                <button
                  onClick={() => onToggleExpand(folder.id)}
                  className="p-1 -ml-1 text-system-gray-400 hover:text-system-gray-600 rounded"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              )}
              <Heading as="h3" variant="h6" className="truncate">
                {folder.name}
              </Heading>
            </div>
            <Text variant="tiny" className="truncate" title={displayPath}>
              {displayPath}
            </Text>
          </div>
        </div>

        {folder.physicallyExists ? (
          <div className="flex items-center rounded-full border px-2.5 py-1 bg-stratosort-success/10 border-stratosort-success/20 shrink-0 gap-1.5">
            <div className="w-2 h-2 rounded-full bg-stratosort-success" />
            <Text as="span" variant="tiny" className="font-medium text-stratosort-success">
              Ready
            </Text>
          </div>
        ) : (
          <div className="flex items-center rounded-full border px-2.5 py-1 bg-stratosort-warning/10 border-stratosort-warning/20 shrink-0 gap-1.5">
            <div className="w-2 h-2 rounded-full bg-stratosort-warning" />
            <Text as="span" variant="tiny" className="font-medium text-stratosort-warning">
              Missing
            </Text>
          </div>
        )}
      </div>

      {folder.description && (
        <div className="text-sm text-system-gray-600 bg-stratosort-blue/5 rounded-xl border border-stratosort-blue/10 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-stratosort-blue" />
            <Caption className="text-stratosort-blue">AI Context</Caption>
          </div>
          <Text variant="small">{folder.description}</Text>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border-soft/50 mt-auto pt-3">
        <div className="flex items-center gap-1">
          {!folder.physicallyExists && (
            <IconButton
              onClick={async () => {
                const result = await onCreateDirectory(folder.path);
                if (result.success)
                  addNotification?.(`Created directory: ${folder.name}`, 'success');
                else addNotification?.(`Failed to create: ${result.error}`, 'error');
              }}
              title="Create directory"
              variant="ghost"
              size="sm"
              icon={<FolderPlus className="w-4 h-4" />}
              className="text-stratosort-blue hover:bg-stratosort-blue/10"
            />
          )}
          <IconButton
            onClick={() => onOpenFolder(folder.path)}
            disabled={!folder.physicallyExists}
            title="Open in explorer"
            variant="ghost"
            size="sm"
            icon={<FolderOpen className="w-4 h-4" />}
            className={
              folder.physicallyExists
                ? 'text-stratosort-success hover:bg-stratosort-success/10'
                : 'text-system-gray-300'
            }
          />
          <IconButton
            onClick={() => onEditStart(folder)}
            title="Edit folder"
            variant="ghost"
            size="sm"
            icon={<Edit2 className="w-4 h-4" />}
            className="text-stratosort-blue hover:bg-stratosort-blue/10"
          />
        </div>
        <IconButton
          onClick={() => onDeleteFolder(folder.id)}
          disabled={isDeleting}
          title="Remove folder"
          variant="ghost"
          size="sm"
          icon={
            isDeleting ? (
              <span className="inline-block w-4 h-4 border-2 border-stratosort-danger border-t-transparent rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )
          }
          className="text-stratosort-danger hover:bg-stratosort-danger/10 disabled:opacity-50"
        />
      </div>
    </Card>
  );
});

export default SmartFolderItem;
