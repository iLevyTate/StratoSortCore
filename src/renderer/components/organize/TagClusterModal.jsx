import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Tag, Plus, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Text } from '../ui/Typography';
import { createLogger } from '../../../shared/logger';

const logger = createLogger('TagClusterModal');

/**
 * TagClusterModal
 *
 * A modal for applying tags to all files in a cluster.
 */
export default function TagClusterModal({
  isOpen,
  onClose,
  clusterName,
  onApplyTags // (tags) => Promise<void>
}) {
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [isApplying, setIsApplying] = useState(false);

  const handleAddTag = () => {
    if (tagInput.trim()) {
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleApply = async () => {
    if (tags.length === 0) return;
    setIsApplying(true);
    try {
      await onApplyTags(tags);
      onClose();
      setTags([]);
    } catch (error) {
      logger.error('Failed to apply tags', {
        error: error?.message,
        stack: error?.stack
      });
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Tag Cluster: ${clusterName}`}
      description="Add tags to all files in this cluster."
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isApplying}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApply}
            disabled={isApplying || tags.length === 0}
            isLoading={isApplying}
            leftIcon={<Tag className="w-4 h-4" />}
          >
            Apply {tags.length} Tag{tags.length !== 1 ? 's' : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-system-gray-700 mb-1">Add Tags</label>
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a tag and press Enter..."
              className="flex-1"
              disabled={isApplying}
            />
            <Button
              variant="secondary"
              onClick={handleAddTag}
              disabled={!tagInput.trim() || isApplying}
              icon={<Plus className="w-4 h-4" />}
            />
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 bg-system-gray-50 rounded-lg border border-system-gray-100">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-system-gray-200 text-sm text-system-gray-700 shadow-sm"
              >
                <Tag className="w-3 h-3 text-system-gray-400" />
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-1 p-0.5 rounded-full hover:bg-system-gray-100 text-system-gray-400 hover:text-system-gray-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <Text variant="small" className="text-system-gray-500">
          Note: This will update metadata for all files in the cluster.
        </Text>
      </div>
    </Modal>
  );
}

TagClusterModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  clusterName: PropTypes.string,
  onApplyTags: PropTypes.func.isRequired
};
