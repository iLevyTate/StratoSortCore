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
import { createLogger } from '../../../shared/logger';
import { useNotification } from '../../contexts/NotificationContext';
import { Card, Button, IconButton, Input } from '../ui';
import { Heading, Text } from '../ui/Typography';
import OrganizationSuggestions from './OrganizationSuggestions';
import FeedbackMemoryPanel from './FeedbackMemoryPanel';
import BatchOrganizationSuggestions from './BatchOrganizationSuggestions';
import OrganizationPreview from './OrganizationPreview';
// Use unified ErrorBoundary for better error handling and reporting
import { GlobalErrorBoundary } from '../ErrorBoundary';

// Set logger context for this component
const logger = createLogger('SmartOrganizer');
// FIX: Move steps array outside component to prevent recreation on every render
const ORGANIZATION_STEPS = [
  { id: 'analyze', label: 'Analyze', Icon: Search },
  { id: 'review', label: 'Review', Icon: Eye },
  { id: 'preview', label: 'Preview', Icon: ClipboardList },
  { id: 'organize', label: 'Organize', Icon: CheckCircle }
];

/** Normalize confidence from 0-1 or 0-100 to a 0-100 integer. */
const normalizeConfidencePercent = (value) => {
  if (!Number.isFinite(value)) return 0;
  const normalized = value > 1 ? value : value * 100;
  return Math.round(Math.min(100, Math.max(0, normalized)));
};

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
  const analyzeRunIdRef = useRef(0);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // FIX: Wrap analyzeFiles in useCallback to prevent stale closure issues
  const analyzeFiles = useCallback(async () => {
    if (files.length === 0) return;

    const runId = ++analyzeRunIdRef.current;
    const isLatestRun = () => isMountedRef.current && runId === analyzeRunIdRef.current;

    setIsAnalyzing(true);
    try {
      // Get suggestions for all files
      if (files.length === 1) {
        // Single file mode
        const result = await window.electronAPI?.suggestions?.getFileSuggestions?.(files[0], {
          includeAlternatives: true
        });
        if (!isLatestRun()) return;
        if (isMountedRef.current) {
          setSuggestions({ [files[0].path]: result });
          setBatchSuggestions(null);
        }
      } else {
        // Batch mode
        const batchResult = await window.electronAPI?.suggestions?.getBatchSuggestions?.(files, {
          analyzePatterns: true
        });
        if (!isLatestRun()) return;
        if (isMountedRef.current) {
          setBatchSuggestions(batchResult);
          setSuggestions({});
        }
      }

      // Get folder improvement suggestions
      const improvements = await window.electronAPI?.suggestions?.analyzeFolderStructure?.(files);
      if (!isLatestRun()) return;
      if (isMountedRef.current) {
        setFolderImprovements(improvements?.improvements || []);
      }
    } catch (error) {
      logger.error('Failed to analyze files', {
        error: error.message,
        stack: error.stack
      });
      // FIX: Notify user about the failure so they're aware analysis didn't work
      if (isLatestRun()) {
        addNotification(
          'Failed to analyze files. Please try again or check your connection.',
          'error'
        );
      }
    } finally {
      if (isLatestRun()) {
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
      if (normalizeConfidencePercent(suggestion?.confidence) >= 80) {
        highConfidenceSuggestions[files[0].path] = suggestion.primary;
      }
    } else if (Array.isArray(batchSuggestions?.groups)) {
      batchSuggestions.groups.forEach((group) => {
        if (normalizeConfidencePercent(group.confidence) >= 80) {
          group.files.forEach((file) => {
            highConfidenceSuggestions[file.path] = {
              folder: group.folder,
              path: group.folder,
              confidence: group.confidence
            };
          });
        }
      });
    }

    if (Object.keys(highConfidenceSuggestions).length === 0) {
      addNotification('No high-confidence suggestions available yet.', 'info');
      return;
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
      await window.electronAPI?.suggestions?.recordFeedback?.(
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
      await window.electronAPI?.suggestions?.recordFeedback?.(
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

  const averageConfidence = useMemo(() => {
    if (files.length === 1) {
      const suggestion = suggestions[files[0]?.path];
      return suggestion ? normalizeConfidencePercent(suggestion.confidence) : 0;
    }
    if (Array.isArray(batchSuggestions?.groups) && batchSuggestions.groups.length > 0) {
      const avg =
        batchSuggestions.groups.reduce((sum, group) => sum + (group.confidence || 0), 0) /
        batchSuggestions.groups.length;
      return normalizeConfidencePercent(avg);
    }
    return 0;
  }, [files, suggestions, batchSuggestions]);

  const hasSuggestions =
    Object.keys(suggestions || {}).length > 0 ||
    (Array.isArray(batchSuggestions?.groups) && batchSuggestions.groups.length > 0);

  return (
    <div className="space-y-6">
      {/* Header with Mode Toggle */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <Heading as="h2" variant="h3">
            Smart File Organizer
          </Heading>
          <Text variant="small" className="text-system-gray-600 mt-1">
            {files.length} file{files.length !== 1 ? 's' : ''} ready to organize
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text as="span" variant="small" className="text-system-gray-600">
            Mode:
          </Text>
          <div className="flex bg-system-gray-100 rounded-lg p-1">
            <Button
              variant={mode === 'quick' ? 'secondary' : 'ghost'}
              size="sm"
              leftIcon={<Zap className="w-3.5 h-3.5" />}
              className={`rounded-md px-3 py-1 text-sm h-auto ${
                mode === 'quick'
                  ? 'bg-white text-stratosort-blue font-medium shadow-sm'
                  : 'text-system-gray-600'
              }`}
              onClick={() => setMode('quick')}
            >
              Quick
            </Button>
            <Button
              variant={mode === 'detailed' ? 'secondary' : 'ghost'}
              size="sm"
              leftIcon={<Search className="w-3.5 h-3.5" />}
              className={`rounded-md px-3 py-1 text-sm h-auto ${
                mode === 'detailed'
                  ? 'bg-white text-stratosort-blue font-medium shadow-sm'
                  : 'text-system-gray-600'
              }`}
              onClick={() => setMode('detailed')}
            >
              Detailed
            </Button>
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
              <Text variant="small" className="text-system-gray-600">
                Analyzing your files...
              </Text>
              <Text variant="tiny" className="text-system-gray-500 mt-2">
                Finding the best organization strategy
              </Text>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="mb-4 flex justify-center">
                <Target className="w-16 h-16 text-stratosort-blue" />
              </div>
              <Heading as="h3" variant="h4" className="mb-2">
                Ready to Organize!
              </Heading>
              <Text variant="small" className="text-system-gray-600 mb-6">
                {mode === 'quick'
                  ? "We'll automatically organize files with high confidence matches"
                  : "You'll review each suggestion before organizing"}
              </Text>

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
                      <Heading as="h4" variant="h6" className="text-system-gray-900">
                        Folder Structure Improvements Available
                      </Heading>
                      <Text variant="small" className="text-system-gray-600 mt-1">
                        We found {folderImprovements.length} way
                        {folderImprovements.length !== 1 ? 's' : ''} to improve your organization
                      </Text>
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
                              <Heading as="h5" variant="h6" className="text-system-gray-900">
                                {improvement.title ||
                                  improvement.type ||
                                  `Improvement ${index + 1}`}
                              </Heading>
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
                  // Apply strategy to all files - populate acceptedSuggestions from batch groups
                  const batchAccepted = {};
                  if (Array.isArray(batchSuggestions?.groups)) {
                    batchSuggestions.groups.forEach((group) => {
                      if (Array.isArray(group.files)) {
                        group.files.forEach((file) => {
                          batchAccepted[file.path] = {
                            folder: group.folder,
                            path: group.folder,
                            confidence: group.confidence
                          };
                        });
                      }
                    });
                  }
                  setAcceptedSuggestions(batchAccepted);
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
            <Button variant="ghost" size="sm" onClick={() => setCurrentStep('analyze')}>
              ← Back
            </Button>
            <Button
              variant="primary"
              size="sm"
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
              <Heading as="h4" variant="h6" className="text-stratosort-blue">
                Pro Tip
              </Heading>
              <Text variant="small" className="text-stratosort-blue/80 mt-1">
                {mode === 'quick'
                  ? 'Quick mode automatically organizes files with confidence scores above 80%. Perfect for routine cleanup!'
                  : 'Detailed mode lets you review every suggestion. Great for important files or learning the system.'}
              </Text>
            </div>
          </div>
        </Card>
      )}

      {/* Stats Bar */}
      {hasSuggestions && (
        <Text
          as="div"
          variant="small"
          className="flex items-center justify-between text-system-gray-600 pt-4 border-t"
        >
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
        </Text>
      )}

      {/* Group Customization Modal */}
      {customizingGroup && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-md p-6 m-4">
            <div className="flex items-center justify-between mb-4">
              <Heading as="h3" variant="h5">
                Customize Group
              </Heading>
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
                <Text variant="small" className="text-system-gray-600 mb-2">
                  {customizingGroup.group.files?.length || 0} file
                  {(customizingGroup.group.files?.length || 0) !== 1 ? 's' : ''} in this group
                </Text>
              </div>

              <div>
                <Text
                  as="label"
                  variant="small"
                  className="block font-medium text-system-gray-700 mb-2"
                >
                  Destination Folder
                </Text>
                <Input
                  type="text"
                  value={customGroupFolder}
                  onChange={(e) => setCustomGroupFolder(e.target.value)}
                  className="w-full"
                  placeholder="Enter folder name..."
                />
              </div>

              {/* Alternative folders from smart folders */}
              {smartFolders.length > 0 && (
                <div>
                  <Text
                    as="label"
                    variant="small"
                    className="block font-medium text-system-gray-700 mb-2"
                  >
                    Or choose from Smart Folders:
                  </Text>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {smartFolders.slice(0, 10).map((folder) => (
                      <Button
                        key={folder.id || folder.name}
                        onClick={() => setCustomGroupFolder(folder.name)}
                        size="sm"
                        variant={customGroupFolder === folder.name ? 'primary' : 'ghost'}
                        className={`px-3 py-1.5 rounded-lg border transition-colors ${
                          customGroupFolder === folder.name
                            ? 'bg-stratosort-blue text-white border-stratosort-blue hover:bg-stratosort-blue/90'
                            : 'bg-white border-system-gray-300 hover:border-stratosort-blue'
                        }`}
                      >
                        {folder.name}
                      </Button>
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
