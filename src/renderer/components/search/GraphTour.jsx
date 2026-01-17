import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { X, ChevronRight, ChevronLeft, Search, Layers, Map, EyeOff } from 'lucide-react';
import { Button } from '../ui';

const TOUR_STORAGE_KEY = 'graphTourDismissed';

/**
 * Tour steps for the graph visualization
 */
const TOUR_STEPS = [
  {
    id: 'search',
    icon: Search,
    title: 'Search for files',
    content:
      'Type a query to find files and add them to the graph. Use natural language like "tax documents" or "project notes".',
    position: 'center'
  },
  {
    id: 'clusters',
    icon: Layers,
    title: 'Explore clusters',
    content:
      'Click "Auto-discover clusters" to see how your files naturally group together. AI generates descriptive names for each cluster. High-confidence clusters appear in the inner ring, with related clusters positioned nearby. Double-click any cluster to see its files.',
    position: 'center'
  },
  {
    id: 'navigate',
    icon: Map,
    title: 'Navigate the graph',
    content:
      'Use the minimap in the corner to navigate large graphs. Drag to pan, scroll to zoom, and click nodes to see details.',
    position: 'center'
  }
];

/**
 * GraphTour - A simple tooltip tour for first-time graph users
 *
 * Shows a series of helpful tips when the user first opens the graph tab.
 * Stores dismissal state in localStorage so it won't show again.
 */
const GraphTour = ({ isOpen, onComplete, forceShow = false }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(true); // Default checked

  // Check if user has already dismissed the tour (or force show via help button)
  useEffect(() => {
    if (!isOpen) return;

    // If forceShow is true, always show immediately
    if (forceShow) {
      setCurrentStep(0);
      setIsVisible(true);
      return;
    }

    try {
      const isDismissed = localStorage.getItem(TOUR_STORAGE_KEY);
      if (!isDismissed) {
        // Small delay to let the graph render first
        const timer = setTimeout(() => setIsVisible(true), 500);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage not available, skip tour
    }
  }, [isOpen, forceShow]);

  const handleDismiss = useCallback(
    (rememberChoice = true) => {
      if (rememberChoice) {
        try {
          localStorage.setItem(TOUR_STORAGE_KEY, 'true');
        } catch {
          // localStorage not available
        }
      }
      setIsVisible(false);
      onComplete?.();
    },
    [onComplete]
  );

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Complete tour - always remember
      handleDismiss(true);
    }
  }, [currentStep, handleDismiss]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleClose = useCallback(() => {
    handleDismiss(dontShowAgain);
  }, [handleDismiss, dontShowAgain]);

  if (!isVisible) return null;

  const step = TOUR_STEPS[currentStep];
  const StepIcon = step.icon;
  const isLastStep = currentStep === TOUR_STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-stratosort-blue to-blue-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <StepIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold">{step.title}</h3>
              <p className="text-white/70 text-xs">
                Step {currentStep + 1} of {TOUR_STEPS.length}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/20 text-white/70 hover:text-white transition-colors"
            title="Close tour"
            aria-label="Close tour"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-system-gray-600 leading-relaxed">{step.content}</p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 pb-4">
          {TOUR_STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStep(idx)}
              className={`w-2 h-2 rounded-full transition-all ${
                idx === currentStep
                  ? 'bg-stratosort-blue w-6'
                  : 'bg-system-gray-300 hover:bg-system-gray-400'
              }`}
              aria-label={`Go to step ${idx + 1}`}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-system-gray-100 px-6 py-4 bg-system-gray-50/50">
          {/* Don't show again checkbox */}
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-2 text-sm text-system-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="rounded border-system-gray-300 text-stratosort-blue focus:ring-stratosort-blue"
              />
              <EyeOff className="w-3.5 h-3.5" />
              <span>Don&apos;t show this again</span>
            </label>
          </div>

          {/* Navigation buttons */}
          <div className="flex justify-between items-center">
            <button
              onClick={handleClose}
              className="text-sm text-system-gray-500 hover:text-system-gray-700 transition-colors"
            >
              Close
            </button>
            <div className="flex gap-2">
              {!isFirstStep && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrev}
                  className="text-system-gray-600"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Back</span>
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={handleNext}
                className="bg-stratosort-blue hover:bg-blue-700"
              >
                {isLastStep ? (
                  'Get Started'
                ) : (
                  <>
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

GraphTour.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onComplete: PropTypes.func,
  forceShow: PropTypes.bool
};

GraphTour.defaultProps = {
  onComplete: null,
  forceShow: false
};

export default GraphTour;
