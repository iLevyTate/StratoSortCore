import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Trash2, Info, Pencil } from 'lucide-react';
import { Card, Button, IconButton, StateMessage, Textarea } from '../ui';
import { Heading, Text } from '../ui/Typography';

function FeedbackMemoryPanel({ className = '', refreshToken }) {
  const [memories, setMemories] = useState([]);
  const [newText, setNewText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const loadMemories = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.suggestions.getFeedbackMemory();
      if (result?.success && Array.isArray(result.items)) {
        setMemories(result.items);
      }
    } catch {
      // Best-effort UI; errors are surfaced via IPC logs
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
  }, [refreshToken]);

  const handleAdd = async () => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const result = await window.electronAPI.suggestions.addFeedbackMemory(trimmed);
      if (result?.success && result.item) {
        setMemories((prev) => [result.item, ...prev]);
        setNewText('');
      } else {
        await loadMemories();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    await window.electronAPI.suggestions.deleteFeedbackMemory(id);
    setMemories((prev) => prev.filter((entry) => entry.id !== id));
  };

  const startEditing = (entry) => {
    setEditingId(entry.id);
    setEditingText(entry.text || '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingText('');
  };

  const handleUpdate = async () => {
    const trimmed = editingText.trim();
    if (!editingId || !trimmed) return;
    const result = await window.electronAPI.suggestions.updateFeedbackMemory(editingId, trimmed);
    if (result?.success && result.item) {
      setMemories((prev) => prev.map((entry) => (entry.id === editingId ? result.item : entry)));
    } else {
      await loadMemories();
    }
    cancelEditing();
  };

  return (
    <Card className={`p-4 border-system-gray-200 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <Heading as="h3" variant="h6" className="text-system-gray-900">
          Memory & Rules
        </Heading>
        <Button size="sm" variant="ghost" onClick={loadMemories} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="space-y-2 mb-4">
        <Textarea
          value={newText}
          onChange={(event) => setNewText(event.target.value)}
          placeholder='e.g., "All .stl files go to 3D Prints"'
          className="w-full text-sm"
          rows={2}
        />
        <Button
          size="sm"
          variant="primary"
          onClick={handleAdd}
          disabled={saving || !newText.trim()}
          className="bg-stratosort-blue hover:bg-stratosort-blue/90"
        >
          Save Memory
        </Button>
      </div>

      {loading ? (
        <Text variant="tiny" className="text-system-gray-500">
          Loading memories...
        </Text>
      ) : memories.length === 0 ? (
        <StateMessage
          icon={Info}
          tone="neutral"
          size="sm"
          align="left"
          title="No saved memories yet"
          description="Add a note above to guide future suggestions."
          className="py-2"
        />
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto modern-scrollbar">
          {memories.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-md border border-system-gray-100 bg-system-gray-50 px-3 py-2"
            >
              {editingId === entry.id ? (
                <div className="flex-1 space-y-2">
                  <Textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    className="w-full text-sm"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={handleUpdate}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEditing}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Text as="div" variant="tiny" className="text-system-gray-700">
                    <Text as="div" variant="tiny" className="font-medium text-system-gray-800">
                      {entry.text}
                    </Text>
                    {entry.targetFolder && (
                      <Text as="div" variant="tiny" className="text-system-gray-500">
                        Target: {entry.targetFolder}
                      </Text>
                    )}
                  </Text>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      leftIcon={<Pencil className="w-3.5 h-3.5" />}
                      className="text-system-gray-500 hover:text-stratosort-blue"
                      onClick={() => startEditing(entry)}
                      aria-label="Edit memory"
                    >
                      Edit
                    </Button>
                    <IconButton
                      type="button"
                      icon={<Trash2 className="w-4 h-4" />}
                      size="sm"
                      variant="ghost"
                      className="text-system-gray-400 hover:text-stratosort-danger hover:bg-stratosort-danger/10"
                      onClick={() => handleDelete(entry.id)}
                      aria-label="Delete memory"
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

FeedbackMemoryPanel.propTypes = {
  className: PropTypes.string,
  refreshToken: PropTypes.number
};

export default FeedbackMemoryPanel;
