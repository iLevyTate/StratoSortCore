# Dangling Pointer Crash Fix

## Problem Description

The StratoSort Electron application was experiencing a critical crash with the error:

```
[34204:1117/164927.496:FATAL:base\allocator\partition_alloc_support.cc:761]
Detected dangling raw_ptr in unretained with id=0x00002e4c2331113c
```

This crash occurred specifically when:

1. Application window was minimized
2. Window was then restored
3. Chromium's memory safety layer detected a dangling pointer and terminated the process

## Root Cause Analysis

The crash was caused by dangling pointers in the renderer process during window state transitions. When a window is minimized and restored, Chromium's internal state management can leave dangling references if event listeners and DOM elements aren't properly cleaned up.

Key issues identified:

1. **TooltipManager Component**: Had event listeners that weren't cleaned up during window state changes
2. **Window State Transitions**: The restore operation was happening too quickly without proper deferrals
3. **Event Handler Lifecycle**: Window event handlers weren't being properly tracked and cleaned up
4. **Animation Frame Callbacks**: Pending animation frames could create dangling references

## Implemented Fixes

### 1. TooltipManager Component (`src/renderer/components/TooltipManager.jsx`)

- Added `visibilitychange` event listener to clean up tooltip state when window is hidden
- Enhanced cleanup in useEffect return to clear all refs before DOM removal
- Properly remove all event listeners including the new visibility change handler

### 2. Window State Management (`src/main/simple-main.js`)

- Wrapped window state restoration in `setImmediate` to ensure Chromium's message loop is ready
- Added proper deferrals with `setTimeout` for minimize/restore operations
- Implemented proper event handler tracking with a Map for cleanup
- Added try-catch error handling for window state operations

### 3. Window Creation (`src/main/core/createWindow.js`)

- Added cleanup for window state keeper on window close
- Ensures `mainWindowState.unmanage()` is called to prevent memory leaks

### 4. Renderer Process (`src/renderer/index.js`)

- Added proper cleanup for click event handlers
- Implemented `beforeunload` listener to remove event listeners
- Added `visibilitychange` handler to cancel pending animation frames when window is hidden

## Technical Details

### Chromium's Dangling Pointer Detection

Chromium uses PartitionAlloc with dangling pointer detection to identify use-after-free bugs. When enabled, it tracks raw pointers and crashes immediately when it detects a pointer to freed memory is being used.

### Window State Transition Safety

The fix ensures that:

1. All state transitions are deferred to avoid Chromium message pump conflicts
2. Event listeners are properly tracked and cleaned up
3. DOM references are cleared before elements are removed
4. Animation frames are cancelled when window is hidden

## Verification Steps

1. Build the application: `npm run build`
2. Start the application: `npm start`
3. Test the minimize/restore sequence:
   - Open the application
   - Minimize the window
   - Restore the window
   - Verify no crash occurs

## Prevention Guidelines

To prevent similar issues in the future:

1. **Always clean up event listeners** in component unmount or cleanup functions
2. **Use WeakMap/WeakRef** for DOM element references when possible
3. **Defer window state changes** to avoid Chromium message pump conflicts
4. **Track all event handlers** for proper cleanup
5. **Cancel animation frames** when components unmount or window is hidden
6. **Test window state transitions** thoroughly, especially minimize/restore cycles

## Related Electron Issues

- [#21813](https://github.com/electron/electron/pull/21813) - Fix crash when restoring minimized hidden window
- [#42929](https://github.com/electron/electron/pull/42929) - Fix dangling raw_ptr in api::View
- [#39370](https://github.com/electron/electron/issues/39370) - Dangling pointers on Linux

## Testing Performed

- Code changes pass ESLint validation
- Application builds successfully
- Window minimize/restore cycle tested without crashes
- Event listener cleanup verified in DevTools

## Impact

This fix prevents application crashes during window state transitions, significantly improving stability and user experience. The changes are backward compatible and don't affect any existing functionality.
