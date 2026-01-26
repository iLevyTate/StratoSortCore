import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  Search,
  Eye,
  ClipboardList,
  CheckCircle,
  Target,
  Zap,
  Lightbulb,
  BarChart3,
  Folder,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  X
} from 'lucide-react';
import { logger } from '../../../shared/logger';
import { useNotification } from '../../contexts/NotificationContext';
import { Card, Button, IconButton } from '../ui';
import { Text } from '../ui/Typography';
import OrganizationSuggestions from './OrganizationSuggestions';
import FeedbackMemoryPanel from './FeedbackMemoryPanel';
import BatchOrganizationSuggestions from './BatchOrganizationSuggestions';
import OrganizationPreview from './OrganizationPreview';
// Use unified ErrorBoundary for better error handling and reporting
import { GlobalErrorBoundary } from '../ErrorBoundary';

// Set logger context for this component
logger.setContext('SmartOrganizer');

// FIX: Move steps array outside component to prevent recreation on every render
const ORGANIZATION_STEPS = [
  { id: 'analyze', label: 'Analyze', Icon: Search },
  { id: 'review', label: 'Review', Icon: Eye },
  { id: 'preview', label: 'Preview', Icon: ClipboardList },
  { id: 'organize', label: 'Organize', Icon: CheckCircle }
];

/**
 * SmartOrganizer - Simplified, intuitive interface for file organization
 * Guides users through the organization process with clear steps
 */
function SmartOrganizer({ files = [], smartFolders = [], onOrganize, onCancel }) {
  const { addNotification } = useNotification();
  const [currentStep, setCurrentStep] = useState('analyze');
  const [suggestions, setSuggestions] = useState({});
  const [batchSuggestions, setBatchSuggestions] = useState(null);
  const [folderImprovements, setFolderImprovements] = useState([]);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [mode, setMode] = useState('quick'); // 'quick' or 'detailed'
  const [showImprovements, setShowImprovements] = useState(false);
  const [customizingGroup, setCustomizingGroup] = useState(null); // { index, group }
  const [customGroupFolder, setCustomGroupFolder] = useState('');
  const [memoryRefreshToken, setMemoryRefreshToken] = useState(0);

  // FIX: Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // FIX: Wrap analyzeFiles in useCallback to prevent stale closure issues
  const analyzeFiles = useCallback(async () => {
    if (files.length === 0) return;

    setIsAnalyzing(true);
    try {
      // Get suggestions for all files
      if (files.length === 1) {
        // Single file mode
        const result = await window.electronAPI.suggestions.getFileSuggestions(files[0], {
          includeAlternatives: true
        });
        // FIX: Check mounted state before updating
        if (isMountedRef.current) {
          setSuggestions({ [files[0].path]: result });
        }
      } else {
        // Batch mode
        const batchResult = await window.electronAPI.suggestions.getBatchSuggestions(files, {
          analyzePatterns: true
        });
        // FIX: Check mounted state before updating
        if (isMountedRef.current) {
          setBatchSuggestions(batchResult);
        }
      }

      // Get folder improvement suggestions
      const improvements = await window.electronAPI.suggestions.analyzeFolderStructure(files);
      // FIX: Check mounted state before updating
      if (isMountedRef.current) {
        setFolderImprovements(improvements?.improvements || []);
      }
    } catch (error) {
      logger.error('Failed to analyze files', {
        error: error.message,
        stack: error.stack
      });
      // FIX: Notify user about the failure so they're aware analysis didn't work
      if (isMountedRef.current) {
        addNotification(
          'Failed to analyze files. Please try again or check your connection.',
          'error'
        );
      }
    } finally {
      // FIX: Check mounted state before updating
      if (isMountedRef.current) {
        setIsAnalyzing(false);
      }
    }
  }, [files, addNotification]);

  // FIX: Include analyzeFiles in dependency array
  useEffect(() => {
    if (files.length > 0) {
      analyzeFiles();
    }
  }, [files, analyzeFiles]);

  const handleQuickOrganize = () => {
    // Apply all high-confidence suggestions
    const highConfidenceSuggestions = {};

    if (files.length === 1) {
      const suggestion = suggestions[files[0].path];
      if (suggestion?.confidence >= 0.8) {
        highConfidenceSuggestions[files[0].path] = suggestion.primary;
      }
    } else if (batchSuggestions) {
      batchSuggestions.groups.forEach((group) => {
        if (group.confidence >= 0.8) {
          group.files.forEach((file) => {
            highConfidenceSuggestions[file.path] = group.folder;
          });
        }
      });
    }

    setAcceptedSuggestions(highConfidenceSuggestions);
    setCurrentStep('preview');
  };

  // Track feedback recording state - use ref since value isn't used for rendering
  const isRecordingFeedbackRef = useRef(false);

  const triggerMemoryRefresh = () => {
    setMemoryRefreshToken(Date.now());
  };

  const handleAcceptSuggestion = async (file, suggestion, options = {}) => {
    // Await feedback recording before finalizing UI state
    isRecordingFeedbackRef.current = true;
    try {
      await window.electronAPI.suggestions.recordFeedback(
        file,
        suggestion,
        true,
        options?.feedbackNote
      );
      // Only update UI state after successful feedback recording
      setAcceptedSuggestions((prev) => ({
        ...prev,
        [file.path]: suggestion
      }));
    } catch (error) {
      logger.error('Failed to record accept feedback', {
        error: error.message,
        stack: error.stack,
        filePath: file.path
      });
      // Still update UI but notify user of the failure
      addNotification('Suggestion saved locally (sync failed)', 'warning');
      setAcceptedSuggestions((prev) => ({
        ...prev,
        [file.path]: suggestion
      }));
    } finally {
      isRecordingFeedbackRef.current = false;
      if (options?.feedbackNote) {
        triggerMemoryRefresh();
      }
    }
  };

  // Track rejected suggestions - use ref since value isn't used for rendering
  const rejectedSuggestionsRef = useRef({});

  const handleRejectSuggestion = async (file, suggestion, options = {}) => {
    // Await feedback recording and update ref on completion
    isRecordingFeedbackRef.current = true;
    try {
      await window.electronAPI.suggestions.recordFeedback(
        file,
        suggestion,
        false,
        options?.feedbackNote
      );
      // Update rejected ref
      rejectedSuggestionsRef.current = {
        ...rejectedSuggestionsRef.current,
        [file.path]: suggestion
      };
    } catch (error) {
      logger.error('Failed to record reject feedback', {
        error: error.message,
        stack: error.stack,
        filePath: file.path
      });
      // Notify user of failure
      addNotification('Rejection saved locally (sync failed)', 'warning');
    } finally {
      isRecordingFeedbackRef.current = false;
      if (options?.feedbackNote) {
        triggerMemoryRefresh();
      }
    }
  };

  const handleConfirmOrganization = () => {
    if (onOrganize) {
      onOrganize(acceptedSuggestions);
    }
  };

  // Handle group customization
  const handleCustomizeGroup = (groupIndex, group) => {
    setCustomizingGroup({ index: groupIndex, group });
    setCustomGroupFolder(group.folder || '');
  };

  const handleApplyGroupCustomization = () => {
    if (!customizingGroup || !customGroupFolder.trim()) return;

    // Update batch suggestions with new folder
    setBatchSuggestions((prev) => {
      if (!prev || !prev.groups) return prev;
      const newGroups = [...prev.groups];
      newGroups[customizingGroup.index] = {
        ...newGroups[customizingGroup.index],
        folder: customGroupFolder.trim()
      };
      return { ...prev, groups: newGroups };
    });

    addNotification(`Group updated to "${customGroupFolder.trim()}"`, 'success');
    setCustomizingGroup(null);
    setCustomGroupFolder('');
  };

  const handleCancelGroupCustomization = () => {
    setCustomizingGroup(null);
    setCustomGroupFolder('');
  };

  // FIX: Memoize step indicator to prevent recreation on every render
  const stepIndicator = useMemo(
    () => (
      <div className="flex items-center justify-center mb-6">
        {ORGANIZATION_STEPS.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex items-center justify-center w-10 h-10 rounded-full ${
                currentStep === step.id
                  ? 'bg-stratosort-blue text-white'
                  : 'bg-system-gray-200 text-system-gray-600'
              }`}
            >
              <step.Icon className="w-5 h-5" />
            </div>
            <div className="ml-2 mr-4">
              <span className={`text-sm ${currentStep === step.id ? 'font-bold' : ''}`}>
                {step.label}
              </span>
            </div>
            {index < ORGANIZATION_STEPS.length - 1 && (
              <div className="w-8 h-0.5 bg-system-gray-300 mr-4" />
            )}
          </div>
        ))}
      </div>
    ),
    [currentStep]
  );

  // FIX: Memoize average confidence calculation to prevent recalculation on every render
  const normalizeConfidencePercent = (value) => {
    if (!Number.isFinite(value)) return 0;
    const normalized = value > 1 ? value : value * 100;
    return Math.round(Math.min(100, Math.max(0, normalized)));
  };

  const averageConfidence = useMemo(() => {
    if (files.length === 1) {
      const suggestion = suggestions[files[0]?.path];
      return suggestion ? normalizeConfidencePercent(suggestion.confidence) : 0;
    }
    if (batchSuggestions?.groups?.length > 0) {
      const avg =
        batchSuggestions.groups.reduce((sum, group) => sum + (group.confidence || 0), 0) /
        batchSuggestions.groups.length;
      return normalizeConfidencePercent(avg);
    }
    return 0;
  }, [files, suggestions, batchSuggestions]);

  return (
    <div className="space-y-6">
      {/* Header with Mode Toggle */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-system-gray-900">Smart File Organizer</h2>
          <p className="text-sm text-system-gray-600 mt-1">
            {files.length} file{files.length !== 1 ? 's' : ''} ready to organize
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-system-gray-600">Mode:</span>
          <div className="flex bg-system-gray-100 rounded-lg p-1">
            <button
              className={`px-3 py-1 text-sm rounded-md flex items-center gap-1.5 ${
                mode === 'quick'
                  ? 'bg-white text-stratosort-blue font-medium shadow-sm'
                  : 'text-system-gray-600'
              }`}
              onClick={() => setMode('quick')}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Quick</span>
            </button>
            <button
              className={`px-3 py-1 text-sm rounded-md flex items-center gap-1.5 ${
                mode === 'detailed'
                  ? 'bg-white text-stratosort-blue font-medium shadow-sm'
                  : 'text-system-gray-600'
              }`}
              onClick={() => setMode('detailed')}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Detailed</span>
            </button>
          </div>
        </div>
      </div>

      {/* Step Indicator */}
      {stepIndicator}

      {/* Content based on current step */}
      {currentStep === 'analyze' && (
        <Card className="p-6">
          {isAnalyzing ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stratosort-blue mx-auto mb-4" />
              <p className="text-system-gray-600">Analyzing your files...</p>
              <p className="text-sm text-system-gray-500 mt-2">
                Finding the best organization strategy
              </p>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="mb-4 flex justify-center">
                <Target className="w-16 h-16 text-stratosort-blue" />
              </div>
              <h3 className="heading-secondary mb-2">Ready to Organize!</h3>
              <p className="text-system-gray-600 mb-6">
                {mode === 'quick'
                  ? "We'll automatically organize files with high confidence matches"
                  : "You'll review each suggestion before organizing"}
              </p>

              <div className="flex gap-4 justify-center">
                {mode === 'quick' ? (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleQuickOrganize}
                    className="bg-stratosort-blue hover:bg-stratosort-blue/90"
                  >
                    <Zap className="w-4 h-4" />
                    <span>Quick Organize</span>
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => setCurrentStep('review')}
                    className="bg-stratosort-blue hover:bg-stratosort-blue/90"
                  >
                    Review Suggestions
                  </Button>
                )}
                <Button variant="secondary" size="md" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {currentStep === 'review' && (
        <div className="space-y-4">
          {/* Folder Health Check */}
          {folderImprovements.length > 0 && (
            <Card className="p-4 bg-stratosort-warning/5 border-stratosort-warning/20">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-6 h-6 text-stratosort-warning flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-system-gray-900">
                        Folder Structure Improvements Available
                      </h4>
                      <p className="text-sm text-system-gray-600 mt-1">
                        We found {folderImprovements.length} way
                        {folderImprovements.length !== 1 ? 's' : ''} to improve your organization
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowImprovements(!showImprovements)}
                      className="flex items-center gap-1"
                    >
                      {showImprovements ? (
                        <>
                          <ChevronUp className="w-4 h-4" />
                          <span>Hide</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          <span>View</span>
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Improvements List */}
                  {showImprovements && (
                    <div className="mt-4 space-y-3">
                      {folderImprovements.map((improvement, index) => (
                        <div
                          key={improvement.id || improvement.type || `improvement-${index}`}
                          className="p-3 bg-white rounded-lg border border-system-gray-200 shadow-sm"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <h5 className="font-medium text-sm text-system-gray-900">
                                {improvement.title ||
                                  improvement.type ||
                                  `Improvement ${index + 1}`}
                              </h5>
                              <Text variant="tiny" className="text-system-gray-600 mt-1">
                                {improvement.description ||
                                  improvement.reason ||
                                  'Suggested folder structure improvement'}
                              </Text>
                              {improvement.from && improvement.to && (
                                <Text
                                  as="div"
                                  variant="tiny"
                                  className="flex items-center gap-2 mt-2 text-system-gray-500"
                                >
                                  <span className="font-mono bg-system-gray-100 px-1.5 py-0.5 rounded">
                                    {improvement.from}
                                  </span>
                                  <ArrowRight className="w-3 h-3" />
                                  <span className="font-mono bg-stratosort-blue/10 text-stratosort-blue px-1.5 py-0.5 rounded">
                                    {improvement.to}
                                  </span>
                                </Text>
                              )}
                              {improvement.affectedFiles && (
                                <Text variant="tiny" className="text-system-gray-500 mt-1">
                                  Affects {improvement.affectedFiles} file
                                  {improvement.affectedFiles !== 1 ? 's' : ''}
                                </Text>
                              )}
                            </div>
                            {improvement.priority && (
                              <Text
                                as="span"
                                variant="tiny"
                                className={`px-2 py-0.5 rounded-full ${
                                  improvement.priority === 'high'
                                    ? 'bg-stratosort-danger/15 text-stratosort-danger'
                                    : improvement.priority === 'medium'
                                      ? 'bg-stratosort-warning/15 text-stratosort-warning'
                                      : 'bg-stratosort-blue/10 text-stratosort-blue'
                                }`}
                              >
                                {improvement.priority}
                              </Text>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* HIGH PRIORITY FIX #8: Wrap OrganizationSuggestions with GlobalErrorBoundary */}
          {/* This provides comprehensive error handling with better error reporting and auto-recovery */}
          {/* File Suggestions */}
          {files.length === 1 ? (
            <GlobalErrorBoundary>
              <OrganizationSuggestions
                file={files[0]}
                suggestions={suggestions[files[0].path]}
                onAccept={handleAcceptSuggestion}
                onReject={handleRejectSuggestion}
                onMemorySaved={triggerMemoryRefresh}
              />
            </GlobalErrorBoundary>
          ) : (
            <GlobalErrorBoundary>
              <BatchOrganizationSuggestions
                batchSuggestions={batchSuggestions}
                onAcceptStrategy={() => {
                  // Apply strategy to all files
                  setCurrentStep('preview');
                }}
                onCustomizeGroup={handleCustomizeGroup}
                onRejectAll={onCancel}
                onMemorySaved={triggerMemoryRefresh}
              />
            </GlobalErrorBoundary>
          )}

          <FeedbackMemoryPanel className="mt-4" refreshToken={memoryRefreshToken} />

          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={() => setCurrentStep('analyze')}>
              ← Back
            </Button>
            <Button
              variant="primary"
              onClick={() => setCurrentStep('preview')}
              className="bg-stratosort-blue hover:bg-stratosort-blue/90"
            >
              Preview Organization →
            </Button>
          </div>
        </div>
      )}

      {currentStep === 'preview' && (
        <div>
          <OrganizationPreview
            files={files}
            strategy={batchSuggestions?.suggestedStrategy}
            suggestions={acceptedSuggestions}
            onConfirm={handleConfirmOrganization}
            onCancel={() => setCurrentStep('review')}
          />
        </div>
      )}

      {/* Quick Tips */}
      {currentStep === 'analyze' && !isAnalyzing && (
        <Card className="p-4 bg-stratosort-blue/5 border-stratosort-blue/20">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-stratosort-blue flex-shrink-0" />
            <div>
              <h4 className="font-medium text-stratosort-blue">Pro Tip</h4>
              <p className="text-sm text-stratosort-blue/80 mt-1">
                {mode === 'quick'
                  ? 'Quick mode automatically organizes files with confidence scores above 80%. Perfect for routine cleanup!'
                  : 'Detailed mode lets you review every suggestion. Great for important files or learning the system.'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Stats Bar */}
      {(suggestions || batchSuggestions) && (
        <div className="flex items-center justify-between text-sm text-system-gray-600 pt-4 border-t">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <BarChart3 className="w-4 h-4" />
              <span>Accuracy: {averageConfidence}%</span>
            </span>
            <span className="flex items-center gap-1">
              <Folder className="w-4 h-4" />
              <span>{smartFolders.length} Smart Folders</span>
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="w-4 h-4 text-stratosort-success" />
              <span>{Object.keys(acceptedSuggestions).length} Accepted</span>
            </span>
          </div>
          <Text variant="tiny" className="text-system-gray-500">
            The system learns from your choices
          </Text>
        </div>
      )}

      {/* Group Customization Modal */}
      {customizingGroup && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-md p-6 m-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="heading-secondary">Customize Group</h3>
              <IconButton
                onClick={handleCancelGroupCustomization}
                variant="ghost"
                size="sm"
                aria-label="Close customization"
                icon={<X className="w-5 h-5" />}
              />
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-system-gray-600 mb-2">
                  {customizingGroup.group.files?.length || 0} file
                  {(customizingGroup.group.files?.length || 0) !== 1 ? 's' : ''} in this group
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-system-gray-700 mb-2">
                  Destination Folder
                </label>
                <input
                  type="text"
                  value={customGroupFolder}
                  onChange={(e) => setCustomGroupFolder(e.target.value)}
                  className="w-full px-3 py-2 border border-system-gray-300 rounded-lg focus:ring-2 focus:ring-stratosort-blue focus:border-transparent"
                  placeholder="Enter folder name..."
                />
              </div>

              {/* Alternative folders from smart folders */}
              {smartFolders.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-system-gray-700 mb-2">
                    Or choose from Smart Folders:
                  </label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {smartFolders.slice(0, 10).map((folder) => (
                      <button
                        key={folder.id || folder.name}
                        onClick={() => setCustomGroupFolder(folder.name)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                          customGroupFolder === folder.name
                            ? 'bg-stratosort-blue text-white border-stratosort-blue'
                            : 'bg-white border-system-gray-300 hover:border-stratosort-blue'
                        }`}
                      >
                        {folder.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-4 mt-6 pt-4 border-t">
              <Button variant="secondary" size="sm" onClick={handleCancelGroupCustomization}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApplyGroupCustomization}
                disabled={!customGroupFolder.trim()}
                className="bg-stratosort-blue hover:bg-stratosort-blue/90"
              >
                Apply Changes
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

const fileShape = PropTypes.shape({
  path: PropTypes.string.isRequired,
  name: PropTypes.string,
  analysis: PropTypes.object
});

const smartFolderShape = PropTypes.shape({
  id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  name: PropTypes.string,
  description: PropTypes.string
});

SmartOrganizer.propTypes = {
  files: PropTypes.arrayOf(fileShape),
  smartFolders: PropTypes.arrayOf(smartFolderShape),
  onOrganize: PropTypes.func,
  onCancel: PropTypes.func
};

export default SmartOrganizer;
