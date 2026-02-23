import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle, XCircle } from 'lucide-react';
import Button from '../ui/Button';
import SettingsCard from './SettingsCard';
import { Text } from '../ui/Typography';

/**
 * Backend API test section for debugging connectivity
 */
function APITestSection({ addNotification }) {
  const [testResults, setTestResults] = useState({});
  const [isTestingApi, setIsTestingApi] = useState(false);
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runAPITests = useCallback(async () => {
    setIsTestingApi(true);
    const results = {};

    if (!window?.electronAPI) {
      const message = 'Electron API not available';
      setTestResults({
        fileOperations: { success: false, message },
        smartFolders: { success: false, message },
        analysisHistory: { success: false, message },
        undoRedo: { success: false, message },
        systemMonitoring: { success: false, message },
        llama: { success: false, message }
      });
      setIsTestingApi(false);
      addNotification('API tests failed: Electron API not available', 'error');
      return;
    }

    try {
      if (window.electronAPI.files?.getDocumentsPath) {
        await window.electronAPI.files.getDocumentsPath();
        results.fileOperations = { success: true, message: 'Working' };
      } else {
        results.fileOperations = { success: false, message: 'API missing' };
      }
    } catch (error) {
      results.fileOperations = { success: false, message: error.message };
    }

    try {
      if (window.electronAPI.smartFolders?.get) {
        await window.electronAPI.smartFolders.get();
        results.smartFolders = { success: true, message: 'Working' };
      } else {
        results.smartFolders = { success: false, message: 'API missing' };
      }
    } catch (error) {
      results.smartFolders = { success: false, message: error.message };
    }

    try {
      if (window.electronAPI.analysisHistory?.getStatistics) {
        await window.electronAPI.analysisHistory.getStatistics();
        results.analysisHistory = { success: true, message: 'Working' };
      } else {
        results.analysisHistory = { success: false, message: 'API missing' };
      }
    } catch (error) {
      results.analysisHistory = { success: false, message: error.message };
    }

    try {
      if (window.electronAPI.undoRedo?.canUndo) {
        await window.electronAPI.undoRedo.canUndo();
        results.undoRedo = { success: true, message: 'Working' };
      } else {
        results.undoRedo = { success: false, message: 'API missing' };
      }
    } catch (error) {
      results.undoRedo = { success: false, message: error.message };
    }

    try {
      if (window.electronAPI.system?.getApplicationStatistics) {
        await window.electronAPI.system.getApplicationStatistics();
        results.systemMonitoring = { success: true, message: 'Working' };
      } else {
        results.systemMonitoring = { success: false, message: 'API missing' };
      }
    } catch (error) {
      results.systemMonitoring = { success: false, message: error.message };
    }

    try {
      if (window.electronAPI.llama?.getModels) {
        await window.electronAPI.llama.getModels();
        results.llama = { success: true, message: 'Working' };
      } else {
        results.llama = { success: false, message: 'API missing' };
      }
    } catch (error) {
      results.llama = { success: false, message: error.message };
    }

    if (isMountedRef.current) {
      setTestResults(results);
      setIsTestingApi(false);
      addNotification('API tests completed', 'info');
    }
  }, [addNotification]);

  return (
    <SettingsCard
      title="Backend API test"
      description="Run a quick connectivity check against all core services."
    >
      <div className="space-y-6">
        <Button
          onClick={runAPITests}
          disabled={isTestingApi}
          variant="primary"
          size="sm"
          className="w-full sm:w-auto"
        >
          {isTestingApi ? 'Testing APIs\u2026' : 'Test All APIs'}
        </Button>

        {Object.keys(testResults).length > 0 && (
          <div className="rounded-xl border border-border-soft bg-surface-muted divide-y divide-border-soft overflow-hidden">
            {Object.entries(testResults).map(([service, result]) => (
              <div key={service} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3">
                <Text variant="small" className="font-medium text-system-gray-700 capitalize">
                  {service.replace(/([A-Z])/g, ' $1').trim()}
                </Text>
                <Text
                  as="span"
                  variant="tiny"
                  className="font-mono flex items-center gap-1 text-system-gray-600"
                >
                  {result.success ? (
                    <CheckCircle className="w-4 h-4 text-stratosort-success" />
                  ) : (
                    <XCircle className="w-4 h-4 text-stratosort-danger" />
                  )}
                  {result.success ? result.message : `Error: ${result.message}`}
                </Text>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

APITestSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default APITestSection;
