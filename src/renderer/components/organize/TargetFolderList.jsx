import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { List } from 'react-window';
import { Folder } from 'lucide-react';
import { UI_VIRTUALIZATION } from '../../../shared/constants';
import { formatDisplayPath } from '../../utils/pathDisplay';
import Card from '../ui/Card';
import { Text } from '../ui/Typography';

const ITEM_HEIGHT = UI_VIRTUALIZATION.TARGET_FOLDER_ITEM_HEIGHT;
const VIRTUALIZATION_THRESHOLD = 20;

const getListHeight = (folderCount, viewportHeight) => {
  const maxFraction = folderCount <= 10 ? 0.35 : 0.45;
  const contentHeight = folderCount * ITEM_HEIGHT;
  const maxHeight = Math.round(viewportHeight * maxFraction);
  return Math.max(ITEM_HEIGHT * 2, Math.min(contentHeight, maxHeight));
};

const FolderItem = memo(function FolderItem({ folder, defaultLocation, style }) {
  const fullPath = folder.path || `${defaultLocation}/${folder.name}`;
  const redactPaths = useSelector((state) => Boolean(state?.system?.redactPaths));
  const displayPath = formatDisplayPath(fullPath, { redact: redactPaths, segments: 2 });

  return (
    <div style={style} className="p-2">
      <Card variant="default" className="h-full p-4 flex flex-col gap-2">
        <Text variant="body" className="font-semibold text-system-gray-900 break-words">
          {folder.name}
        </Text>
        <div className="flex items-center gap-2 text-system-gray-700">
          <Folder className="w-4 h-4 text-stratosort-blue flex-shrink-0" />
          <Text variant="small" className="break-words">
            {displayPath}
          </Text>
        </div>
        {folder.description && (
          <Text
            as="div"
            variant="tiny"
            className="text-system-gray-600 bg-stratosort-blue/5 p-2 rounded-lg italic leading-relaxed break-words mt-auto"
          >
            &ldquo;{folder.description}&rdquo;
          </Text>
        )}
      </Card>
    </div>
  );
});

FolderItem.propTypes = {
  folder: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    name: PropTypes.string.isRequired,
    path: PropTypes.string,
    description: PropTypes.string
  }).isRequired,
  defaultLocation: PropTypes.string.isRequired,
  style: PropTypes.object
};

const VirtualizedFolderRow = memo(function VirtualizedFolderRow({ index, style, data }) {
  const { folders, defaultLocation } = data || {};
  const folder = folders && folders[index];

  if (!folder) return null;

  return <FolderItem folder={folder} defaultLocation={defaultLocation} style={style} />;
});

VirtualizedFolderRow.propTypes = {
  index: PropTypes.number.isRequired,
  style: PropTypes.object.isRequired,
  data: PropTypes.shape({
    folders: PropTypes.array.isRequired,
    defaultLocation: PropTypes.string.isRequired
  }).isRequired
};

const TargetFolderList = memo(function TargetFolderList({
  folders = [],
  defaultLocation = 'Documents',
  isLoading = false
}) {
  const shouldVirtualize = folders.length > VIRTUALIZATION_THRESHOLD;

  const rowProps = useMemo(
    () => ({
      data: {
        folders,
        defaultLocation
      }
    }),
    [folders, defaultLocation]
  );

  const listHeight = useMemo(() => {
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
    return getListHeight(folders.length, viewportHeight);
  }, [folders.length]);

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading folders">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-xl border border-border-soft bg-system-gray-100 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (shouldVirtualize) {
    return (
      <div className="w-full">
        <Text variant="tiny" className="text-system-gray-500 mb-3">
          Showing {folders.length} folders
        </Text>
        <List
          rowCount={folders.length}
          rowHeight={ITEM_HEIGHT}
          rowComponent={VirtualizedFolderRow}
          rowProps={rowProps}
          overscanCount={4}
          style={{ height: listHeight, width: '100%' }}
          className="scrollbar-thin scrollbar-thumb-system-gray-300 scrollbar-track-transparent"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-auto-fit-md gap-4">
      {folders.map((folder) => (
        <FolderItem key={folder.id} folder={folder} defaultLocation={defaultLocation} />
      ))}
    </div>
  );
});

TargetFolderList.propTypes = {
  folders: PropTypes.array,
  defaultLocation: PropTypes.string,
  isLoading: PropTypes.bool
};

export default TargetFolderList;
