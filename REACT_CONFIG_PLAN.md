# React Configuration Review Plan

## Overview

This plan outlines the steps to review and fix React configuration issues in the StratoSort application. The codebase uses React 19.2.0 with Redux Toolkit, and several configuration issues have been identified.

---

## Issues Identified

### 1. ESLint React Hooks Plugin Not Configured (HIGH PRIORITY)

**Location:** `.eslintrc.js`

**Problem:** The `eslint-plugin-react-hooks` package is installed (`devDependencies`) but not enabled in the ESLint configuration. This means critical hooks rules are not being enforced:

- `react-hooks/rules-of-hooks` - Ensures hooks are called in valid places
- `react-hooks/exhaustive-deps` - Warns about missing useEffect dependencies

**Impact:** Bugs from hooks misuse (stale closures, infinite loops, conditional hooks) go undetected.

**Fix:**

```js
// In .eslintrc.js, add to plugins array:
plugins: ['react', 'jest', 'react-hooks'],

// Add to rules:
rules: {
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
  // ... existing rules
}
```

---

### 2. Prop-Types Validation Error (MEDIUM PRIORITY)

**Location:** `src/renderer/components/discover/AnalysisResultsList.jsx:193`

**Problem:** The `ListContainer` component is missing 'children' prop validation.

**Fix:** Add PropTypes for the internal component or convert to proper component structure.

---

### 3. Component Defined Inside useCallback (MEDIUM PRIORITY)

**Location:** `src/renderer/hooks/useConfirmDialog.js:66-81`

**Problem:** `ConfirmDialog` is defined as a component inside `useCallback`. This is an anti-pattern because:

- Components lose their identity on each render
- React treats it as a new component, causing unmount/remount
- Can cause focus loss, animation issues, and state reset

**Fix:** Extract `ConfirmDialog` to be returned as a render prop or create a proper component that receives state via props.

---

### 4. React 19 Compatibility Audit (LOW PRIORITY)

**Location:** Various files

**Problem:** React 19 introduced changes that may affect existing code:

- New JSX transform (already handled via `react/react-in-jsx-scope: off`)
- Concurrent features
- Strict Mode double-rendering behavior changes

**Action:** Run the app in development with StrictMode and check console for warnings.

---

### 5. Memory Leak Patterns Review (LOW PRIORITY)

**Locations to check:**

- `src/renderer/phases/discover/useAnalysis.js` - Has cleanup, looks good
- `src/renderer/contexts/NotificationContext.jsx` - Has cleanup
- `src/renderer/hooks/useKeyboardShortcuts.js`
- `src/renderer/hooks/useSettingsSubscription.js`

**Action:** Verify all useEffect hooks with subscriptions have proper cleanup functions.

---

### 6. Missing Key Props in Lists (LOW PRIORITY)

**Action:** Search for `.map(` patterns and verify all have proper `key` props that are:

- Stable (not using array index when list can reorder)
- Unique within the list

---

## Implementation Steps

### Step 1: Enable React Hooks ESLint Rules

1. Edit `.eslintrc.js` to add `react-hooks` plugin
2. Add `rules-of-hooks` and `exhaustive-deps` rules
3. Run `npm run lint` to identify any violations
4. Fix any violations found

### Step 2: Fix Prop-Types Error

1. Fix `AnalysisResultsList.jsx` children prop validation
2. Run `npm run lint` to verify fix

### Step 3: Refactor useConfirmDialog

1. Extract ConfirmDialog from useCallback
2. Use a render prop pattern or return JSX element
3. Test modal behavior after changes

### Step 4: Run Full Lint Check

1. Run `npm run lint` after all changes
2. Fix any remaining React-specific warnings/errors
3. Run `npm run test` to verify no regressions

### Step 5: Test in Development Mode

1. Run `npm run dev`
2. Check browser console for React warnings
3. Test all major features (discover, organize, setup phases)
4. Verify no unexpected behavior

---

## Files to Modify

| File                                                       | Change Type            | Priority |
| ---------------------------------------------------------- | ---------------------- | -------- |
| `.eslintrc.js`                                             | Add react-hooks config | High     |
| `src/renderer/components/discover/AnalysisResultsList.jsx` | Fix prop-types         | Medium   |
| `src/renderer/hooks/useConfirmDialog.js`                   | Refactor component     | Medium   |

---

## Verification Checklist

- [ ] ESLint passes with no React errors
- [ ] All prop-types validated
- [ ] No components defined inside hooks/callbacks
- [ ] All useEffect hooks have cleanup where needed
- [ ] No console warnings in development mode
- [ ] All tests pass
