# Refactoring Candidates - Long Functions and Complex Files

## Overview

This document identifies files and functions that exceed recommended complexity thresholds and provides refactoring recommendations.

## Files Requiring Refactoring

### Critical Priority (>1000 lines)

#### 1. src/renderer/phases/DiscoverPhase.jsx (1880 lines)

**Complexity**: Very High
**Issues**:

- Monolithic component with too many responsibilities
- State management spread across multiple useState hooks
- 30+ console.log statements
- Complex useEffect dependencies
- Long event handler functions

**Recommended Refactoring**:

1. **Extract Custom Hooks**

   ```javascript
   // Create focused hooks
   useFileAnalysis() - Handle analysis state and logic
   useProgressTracking() - Handle progress state
   useFileSelection() - Handle file selection state
   useBatchProcessing() - Handle batch operations
   ```

2. **Component Decomposition**

   ```javascript
   <DiscoverPhase>
     <FileSelectionPanel />
     <AnalysisProgressPanel />
     <ResultsDisplayPanel />
     <ActionButtonsPanel />
   </DiscoverPhase>
   ```

3. **Extract Utility Functions**
   - Move analysis logic to separate service
   - Extract validation into utility functions
   - Create dedicated progress calculator

**Estimated Effort**: 2-3 days
**Risk**: Medium (requires careful state management)

#### 2. src/main/services/OrganizationSuggestionService.js (1731 lines)

**Complexity**: Very High
**Issues**:

- Multiple large functions (>100 lines each)
- Complex LLM interaction logic
- Deep nesting in suggestion generation
- Retry logic mixed with business logic

**Recommended Refactoring**:

1. **Split into Multiple Services**

   ```
   OrganizationSuggestionService (coordinator)
   ├── LLMPromptBuilder (prompt construction)
   ├── SuggestionParser (response parsing)
   ├── ConfidenceCalculator (scoring logic)
   └── SuggestionValidator (validation)
   ```

2. **Extract Long Functions**
   - `generateSuggestions()` - Split into smaller steps
   - `analyzeFolderStructure()` - Extract sub-analyzers
   - `matchFileToFolder()` - Simplify matching logic

3. **Use Strategy Pattern for LLM Interactions**

   ```javascript
   class LLMStrategy {
     buildPrompt(context) {}
     parseResponse(response) {}
     calculateConfidence(result) {}
   }

   class DocumentLLMStrategy extends LLMStrategy {}
   class ImageLLMStrategy extends LLMStrategy {}
   ```

**Estimated Effort**: 3-4 days
**Risk**: High (core functionality, needs extensive testing)

#### 3. src/main/simple-main.js (1697 lines)

**Complexity**: Very High
**Issues**:

- Main process file doing too much
- IPC handlers mixed with initialization
- Window management mixed with business logic
- Global state management

**Recommended Refactoring**:

1. **Modularize Initialization**

   ```javascript
   // Create separate initialization modules
   initializeApp() {
     setupLogging();
     registerIPCHandlers();
     createMainWindow();
     setupAutoUpdater();
     initializeServices();
   }
   ```

2. **Move IPC Handlers to Dedicated Files**
   - Already partially done with src/main/ipc/\*
   - Move remaining handlers from simple-main.js
   - Use consistent registration pattern

3. **Extract Window Management**
   ```javascript
   // src/main/core/WindowManager.js
   class WindowManager {
     createMainWindow() {}
     handleWindowEvents() {}
     manageWindowState() {}
   }
   ```

**Estimated Effort**: 2-3 days
**Risk**: Medium (well-structured main process needed)

#### 4. src/main/services/ChromaDBService.js (1095 lines)

**Complexity**: High
**Issues**:

- Large class with many responsibilities
- Complex error handling
- Mixed synchronous and asynchronous operations
- Spawn process management intertwined

**Recommended Refactoring**:

1. **Separate Concerns**

   ```
   ChromaDBService (high-level operations)
   ├── ChromaProcessManager (spawn/kill/health)
   ├── ChromaCollectionManager (CRUD operations)
   └── ChromaQueryBuilder (query construction)
   ```

2. **Extract Process Management**
   - Move spawn logic to dedicated class
   - Health checking as separate module
   - Installation/setup in separate file

3. **Simplify Error Handling**
   - Use withErrorHandling wrapper
   - Standardize retry logic
   - Centralize error codes

**Estimated Effort**: 2-3 days
**Risk**: Medium (external process management is tricky)

### High Priority (500-1000 lines)

#### 5. src/renderer/phases/OrganizePhase.jsx (922 lines)

**Recommended Actions**:

- Extract custom hooks for state management
- Split into smaller components
- Move business logic to services

**Estimated Effort**: 1-2 days

#### 6. src/main/services/SettingsService.js (761 lines)

**Recommended Actions**:

- Separate validation logic into dedicated module
- Extract import/export into utility functions
- Split cache management into separate service

**Estimated Effort**: 1-2 days

#### 7. src/main/services/AutoOrganizeService.js (703 lines)

**Recommended Actions**:

- Extract file watcher logic
- Separate organization queue management
- Move file matching to dedicated matcher

**Estimated Effort**: 1-2 days

### Medium Priority (200-500 lines)

These files are approaching complexity limits but are generally well-structured:

- `src/main/services/ModelManager.js` (455 lines) - Consider splitting model discovery from management
- `src/main/services/AnalysisHistoryService.js` (518 lines) - Extract query builders
- `src/main/services/ModelVerifier.js` (340 lines) - Split verification strategies

## Specific Function Refactoring

### Long Functions (>100 lines)

#### DiscoverPhase.analyzeFiles()

**Current**: ~400 lines
**Issues**: Does validation, progress tracking, batch processing, error handling
**Refactoring**:

```javascript
// Before: One massive function
async analyzeFiles(files) {
  // 400 lines of everything
}

// After: Orchestrator with helpers
async analyzeFiles(files) {
  this.validateAnalysisRequest(files);
  const batchConfig = this.prepareBatchConfiguration(files);
  const results = await this.executeBatchAnalysis(batchConfig);
  this.updateAnalysisState(results);
  return results;
}
```

#### OrganizationSuggestionService.generateSuggestions()

**Current**: ~200 lines
**Issues**: Mixed prompting, API calls, parsing, scoring
**Refactoring**:

```javascript
// Split into pipeline
async generateSuggestions(file) {
  const prompt = this.promptBuilder.build(file);
  const response = await this.llmClient.generate(prompt);
  const parsed = this.responseParser.parse(response);
  const scored = this.confidenceCalculator.score(parsed);
  return this.suggestionValidator.validate(scored);
}
```

#### ChromaDBService.spawn()

**Current**: ~150 lines
**Issues**: Process management, error handling, health checking mixed
**Refactoring**:

```javascript
// Extract to ProcessManager
class ChromaProcessManager {
  async spawn() {
    this.validateEnvironment();
    const process = await this.startProcess();
    await this.waitForHealthy(process);
    return process;
  }
}
```

## Deep Nesting Issues

### Files with Excessive Nesting (>4 levels)

#### src/renderer/phases/DiscoverPhase.jsx

**Problem Areas**:

- Event handlers with nested conditionals
- useEffect with multiple nested if statements
- Callback functions with deep nesting

**Refactoring Strategy**:

```javascript
// Before: Deep nesting
useEffect(() => {
  if (condition1) {
    if (condition2) {
      if (condition3) {
        if (condition4) {
          // Deep nested logic
        }
      }
    }
  }
}, [deps]);

// After: Early returns
useEffect(() => {
  if (!condition1) return;
  if (!condition2) return;
  if (!condition3) return;
  if (!condition4) return;

  // Flat logic
}, [deps]);
```

## Cyclomatic Complexity

### High Complexity Functions

Functions with many conditional branches that should be simplified:

1. **File type detection logic** - Use lookup tables
2. **Error code mapping** - Use error code maps
3. **Configuration builders** - Use builder pattern
4. **State transitions** - Use state machine

## Refactoring Priority Matrix

```
High Impact, Low Effort:
- Extract utility functions from long files
- Move IPC handlers to dedicated files
- Create focused custom hooks in React

High Impact, High Effort:
- Refactor DiscoverPhase component
- Split OrganizationSuggestionService
- Modularize simple-main.js

Low Impact, Low Effort:
- Add JSDoc to existing functions
- Rename ambiguous variables
- Extract magic numbers

Low Impact, High Effort:
- Complete rewrite of complex algorithms
- Architecture changes
```

## Refactoring Guidelines

### Before Refactoring

1. **Write Tests First**
   - Ensure existing functionality is tested
   - Create regression tests
   - Document expected behavior

2. **Identify Dependencies**
   - Map function calls
   - Track state dependencies
   - Note side effects

3. **Create Baseline Metrics**
   - Measure current performance
   - Note memory usage
   - Track error rates

### During Refactoring

1. **Small Steps**
   - Make incremental changes
   - Test after each change
   - Commit frequently

2. **Preserve Behavior**
   - Don't add features while refactoring
   - Keep the same public API
   - Maintain backwards compatibility

3. **Document Changes**
   - Update JSDoc
   - Note breaking changes
   - Update related docs

### After Refactoring

1. **Verify Tests Pass**
   - Run full test suite
   - Check coverage didn't decrease
   - Verify no regressions

2. **Measure Improvements**
   - Compare performance
   - Check memory usage
   - Verify error rates

3. **Update Documentation**
   - Update architecture docs
   - Refresh API documentation
   - Note any changes in behavior

## Refactoring Schedule

### Phase 1 (Week 1-2): Foundation

- Extract utility functions
- Move IPC handlers
- Add missing tests

### Phase 2 (Week 3-4): Core Refactoring

- Refactor DiscoverPhase
- Split OrganizationSuggestionService
- Modularize simple-main.js

### Phase 3 (Week 5-6): Service Improvements

- Refactor ChromaDBService
- Split SettingsService
- Improve AutoOrganizeService

### Phase 4 (Week 7-8): Polish

- Add comprehensive JSDoc
- Performance optimization
- Final testing and validation

## Success Metrics

### Code Quality

- [ ] No files > 1000 lines
- [ ] No functions > 100 lines
- [ ] No nesting depth > 4 levels
- [ ] Cyclomatic complexity < 15

### Maintainability

- [ ] All public functions have JSDoc
- [ ] Test coverage > 70%
- [ ] No code duplication > 10 lines

### Performance

- [ ] No performance regressions
- [ ] Memory usage within bounds
- [ ] No new bottlenecks introduced

## Notes

- Refactoring is an ongoing process
- Don't refactor everything at once
- Focus on areas that cause the most pain
- Get code review for major refactorings
- Keep the application working throughout
