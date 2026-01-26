import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle, XCircle } from 'lucide-react';
import Button from '../ui/Button';
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
      await window.electronAPI.ollama.getModels();
      results.ollama = { success: true, message: 'Working' };
    } catch (error) {
      results.ollama = { success: false, message: error.message };
    }

    setTestResults(results);
    setIsTestingApi(false);
    addNotification('API tests completed', 'info');
  }, [addNotification]);

  return (
    <div className="p-4 bg-system-gray-50 rounded-lg">
      <Button
        onClick={runAPITests}
        disabled={isTestingApi}
        variant="primary"
        className="text-sm mb-4 w-full"
      >
        {isTestingApi ? 'Testing APIs...' : 'Test All APIs'}
      </Button>
      {Object.keys(testResults).length > 0 && (
        <div className="space-y-3 text-sm">
          {Object.entries(testResults).map(([service, result]) => (
            <div key={service} className="flex justify-between items-center">
              <span className="capitalize">{service.replace(/([A-Z])/g, ' $1').trim()}:</span>
              <Text as="span" variant="tiny" className="font-mono flex items-center gap-1">
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
  );
}

APITestSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default APITestSection;
