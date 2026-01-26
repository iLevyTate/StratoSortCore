import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Trash2 } from 'lucide-react';
import { Card, Button } from '../ui';
import { Text } from '../ui/Typography';

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
        <h3 className="text-sm font-medium text-system-gray-900">Memory & Rules</h3>
        <Button size="sm" variant="ghost" onClick={loadMemories} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="space-y-2 mb-4">
        <textarea
          value={newText}
          onChange={(event) => setNewText(event.target.value)}
          placeholder='e.g., "All .stl files go to 3D Prints"'
          className="w-full rounded-md border border-system-gray-200 bg-white p-2 text-sm text-system-gray-800 focus:outline-none focus:ring-2 focus:ring-stratosort-blue/30"
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
        <Text variant="tiny" className="text-system-gray-500">
          No saved memories yet.
        </Text>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto modern-scrollbar">
          {memories.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-md border border-system-gray-100 bg-system-gray-50 px-3 py-2"
            >
              {editingId === entry.id ? (
                <div className="flex-1 space-y-2">
                  <textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    className="w-full rounded-md border border-system-gray-200 bg-white p-2 text-sm text-system-gray-800 focus:outline-none focus:ring-2 focus:ring-stratosort-blue/30"
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
                    <button
                      type="button"
                      className="p-1 rounded-md text-system-gray-400 hover:text-stratosort-blue hover:bg-stratosort-blue/10"
                      onClick={() => startEditing(entry)}
                      aria-label="Edit memory"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded-md text-system-gray-400 hover:text-stratosort-danger hover:bg-stratosort-danger/10"
                      onClick={() => handleDelete(entry.id)}
                      aria-label="Delete memory"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
