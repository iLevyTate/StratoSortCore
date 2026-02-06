import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle, XCircle } from 'lucide-react';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { Text } from '../ui/Typography';

/**
 * Backend API test section for debugging connectivity
 */
function APITestSection({ addNotification }) {
  const [testResults, setTestResults] = useState({});
  const [isTestingApi, setIsTestingApi] = useState(false);

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
      await window.electronAPI.files.getDocumentsPath();
      results.fileOperations = { success: true, message: 'Working' };
    } catch (error) {
      results.fileOperations = { success: false, message: error.message };
    }

    try {
      await window.electronAPI.smartFolders.get();
      results.smartFolders = { success: true, message: 'Working' };
    } catch (error) {
      results.smartFolders = { success: false, message: error.message };
    }

    try {
      await window.electronAPI.analysisHistory.getStatistics();
      results.analysisHistory = { success: true, message: 'Working' };
    } catch (error) {
      results.analysisHistory = { success: false, message: error.message };
    }

    try {
      await window.electronAPI.undoRedo.canUndo();
      results.undoRedo = { success: true, message: 'Working' };
    } catch (error) {
      results.undoRedo = { success: false, message: error.message };
    }

    try {
      await window.electronAPI.system.getApplicationStatistics();
      results.systemMonitoring = { success: true, message: 'Working' };
    } catch (error) {
      results.systemMonitoring = { success: false, message: error.message };
    }

    try {
      await window.electronAPI.llama.getModels();
      results.llama = { success: true, message: 'Working' };
    } catch (error) {
      results.llama = { success: false, message: error.message };
    }

    setTestResults(results);
    setIsTestingApi(false);
    addNotification('API tests completed', 'info');
  }, [addNotification]);

  return (
    <Card variant="default" className="space-y-5">
      <div>
        <Text variant="tiny" className="font-semibold uppercase tracking-wide text-system-gray-500">
          Backend API test
        </Text>
        <Text variant="small" className="text-system-gray-600">
          Run a quick connectivity check against all core services.
        </Text>
      </div>

      <Button
        onClick={runAPITests}
        disabled={isTestingApi}
        variant="primary"
        size="sm"
        className="w-full sm:w-auto"
      >
        {isTestingApi ? 'Testing APIs...' : 'Test All APIs'}
      </Button>

      {Object.keys(testResults).length > 0 && (
        <div className="rounded-lg border border-system-gray-100 bg-system-gray-50 divide-y divide-system-gray-100">
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
    </Card>
  );
}

APITestSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default APITestSection;
