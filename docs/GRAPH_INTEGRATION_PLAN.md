# Graph Integration Plan: End-to-End Implementation

## Executive Summary

The graph visualization feature is **substantially complete** with all feature flags enabled. This
plan focuses on **Pareto-principle improvements** (20% effort → 80% value) to make the UI more
intuitive and ensure all features work seamlessly together.

**Goal**: When a user looks at the graph, they should say _"Oh okay, this makes sense."_

---

## Current State Analysis

### Implementation Status: ✅ Phase 1-6 Complete

| Phase | Component                                                | Status      |
| ----- | -------------------------------------------------------- | ----------- |
| 1     | Feature Flags (`featureFlags.js`)                        | ✅ Complete |
| 2     | State Management (`useGraphState.js`)                    | ✅ Complete |
| 3     | Layout Engine (`elkLayout.js`)                           | ✅ Complete |
| 4     | Node Components (`FileNode`, `QueryNode`, `ClusterNode`) | ✅ Complete |
| 5     | Edge Components (`SimilarityEdge`, `QueryMatchEdge`)     | ✅ Complete |
| 6     | Legend & Filtering (`ClusterLegend`)                     | ✅ Complete |

### What's Working

- Search to graph conversion
- Cluster loading and expansion
- Multi-hop exploration
- Similarity edges
- Keyboard navigation
- Context menus
- Layout algorithms (ELK, radial, progressive)

---

## Phase 7: Intuitive Integration (THE NEXT STAGE)

### Shneiderman's Mantra

> **"Overview first, zoom and filter, then details on demand."**

This should guide all UI decisions.

---

## UI Section Improvements

### LEFT PANEL: "Add to Graph" Controls

**Current Issues:**

1. Too many controls visible at once (cognitive overload)
2. "Add to existing" toggle unclear without context
3. Expansion controls (hops, decay) are technical jargon
4. No visual hierarchy showing primary vs secondary actions

**Pareto Improvements:**

#### 7.1 Control Grouping with Progressive Disclosure

```
┌─────────────────────────────────┐
│ 🔍 Search Files                 │  ← Primary action (always visible)
│ ┌─────────────────────────────┐ │
│ │ Search query...             │ │
│ └─────────────────────────────┘ │
│ ☑ Add to existing graph         │
│ [Search]                        │
├─────────────────────────────────┤
│ ▼ More Options                  │  ← Collapsed by default
│   ┌─ Layout ─────────────────┐  │
│   │ ☑ Auto-arrange  [Layout] │  │
│   └──────────────────────────┘  │
│   ┌─ Explore ────────────────┐  │
│   │ Depth: [1▼]  [Expand]    │  │
│   │ "Find related files"     │  │ ← Friendly label
│   └──────────────────────────┘  │
│   ┌─ Organize ───────────────┐  │
│   │ [Clusters] [Duplicates]  │  │
│   └──────────────────────────┘  │
├─────────────────────────────────┤
│ 📊 12 files • 3 clusters        │  ← Status always visible
└─────────────────────────────────┘
```

**Implementation:**

- File: `UnifiedSearchModal.jsx`
- Add collapsible sections using existing UI components
- Replace "Hops" with "Depth: [1-3] files away"
- Replace "Decay" with dropdown: "Relevance: High/Medium/Low"
- Estimated effort: 2-3 hours

#### 7.2 Quick Action Buttons

Add prominent actions based on common workflows:

```jsx
// After search results shown on graph
<div className="quick-actions">
  <Button onClick={handleExpandAll}>Explore Related</Button>
  <Button onClick={handleOrganize}>Suggest Folders</Button>
</div>
```

---

### MIDDLE PANEL: Graph Canvas

**Current Issues:**

1. Empty state just says "Start Exploring" - not actionable
2. No zoom level indicator
3. Minimap is small and easy to miss
4. No visual guide for interactions

**Pareto Improvements:**

#### 7.3 Improved Empty State

```
┌─────────────────────────────────────────────┐
│                                             │
│         ┌─────────────────────┐             │
│         │   📁 → 🔗 → 📁     │             │
│         └─────────────────────┘             │
│                                             │
│    Explore how your files are connected     │
│                                             │
│    ┌─────────────────────────────────────┐  │
│    │ 🔍 Search for files to start        │  │  ← Actionable
│    └─────────────────────────────────────┘  │
│                                             │
│    or drag files here from the file list    │
│                                             │
│    Keyboard: ← → navigate • Enter open      │  ← Hints
│                                             │
└─────────────────────────────────────────────┘
```

**Implementation:**

- File: `UnifiedSearchModal.jsx` (empty state section)
- Add inline keyboard hints
- Estimated effort: 1 hour

#### 7.4 Zoom Level Indicator

When zoomed out, labels become unreadable. Show indicator:

```jsx
{
  zoomLevel < 0.5 && (
    <div className="zoom-hint">Labels hidden at this zoom • Scroll to zoom in</div>
  );
}
```

**Implementation:**

- Use ReactFlow's `useViewport()` hook
- File: `UnifiedSearchModal.jsx`
- Estimated effort: 30 minutes

#### 7.5 First-Time User Tooltip Tour

For users who have never used the graph:

```jsx
// Show on first graph tab visit (store in localStorage)
const steps = [
  { target: '.search-input', content: 'Search for files to add' },
  { target: '.cluster-node', content: 'Double-click clusters to expand' },
  { target: '.minimap', content: 'Navigate large graphs here' }
];
```

**Implementation:**

- Use a lightweight tooltip library or custom component
- Store `hasSeenGraphTour` in localStorage
- Estimated effort: 2 hours (optional, lower priority)

---

### RIGHT PANEL: Node Details & Legend

**Current Issues:**

1. Details panel is sparse - just name, path, and buttons
2. Legend is overlay on graph - competes for attention
3. No visual connection between selected node and details

**Pareto Improvements:**

#### 7.6 Enhanced Node Details Panel

```
┌─────────────────────────────────────────────────────────────┐
│ 📄 Selected File                                            │
│ ─────────────────────────────────────────────────────────── │
│ quarterly-report-2024.pdf                                   │
│ C:\Users\...\Documents\Reports                              │
│                                                             │
│ [Open] [Show in Folder]                                     │
├─────────────────────────────────────────────────────────────┤
│ ▼ Properties                                                │
│   Category: Finance                                         │
│   Tags: quarterly, financial, 2024                          │
│   Confidence: 87%                                           │
│   Indexed: Jan 5, 2025                                      │
├─────────────────────────────────────────────────────────────┤
│ ▼ Connections (5)                                           │
│   ├─ 92% similar: annual-report-2023.pdf                    │
│   ├─ 85% similar: budget-2024.xlsx                          │
│   └─ + 3 more                                               │
├─────────────────────────────────────────────────────────────┤
│ ▼ Actions                                                   │
│   [Find Similar] [Organize...] [Remove from Graph]          │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

- Extend the existing `selectedNode` rendering in `UnifiedSearchModal.jsx`
- Fetch connections data when node selected
- Show metadata from node.data
- Estimated effort: 2-3 hours

#### 7.7 Move Legend to Right Panel

Move `ClusterLegend` from graph overlay to right panel (below details):

```
┌─────────────────────────────────────────────────────────────┐
│ 📖 Legend                                                   │
│ ─────────────────────────────────────────────────────────── │
│ ◯ File node        ▬ Similarity (strong)                   │
│ ◆ Cluster          ┄ Similarity (weak)                     │
│ ◇ Query            ─ Query match                           │
│                                                             │
│ ▼ Filters                                                   │
│   ☑ Show clusters  ☑ High confidence                       │
│   ☑ Show files     ☑ Medium confidence                     │
│                    ☐ Low confidence                         │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**

- Move `ClusterLegend` render from graph overlay to right panel
- Condense it to be less prominent
- Estimated effort: 1-2 hours

---

## Keyboard & Accessibility Improvements

#### 7.8 Tab Navigation Between Panels

```jsx
// useGraphKeyboardNav.js additions
case 'Tab':
  if (e.shiftKey) {
    // Move focus: Graph → Left Panel → Right Panel → Graph
    cyclePanelFocus('backward');
  } else {
    cyclePanelFocus('forward');
  }
  break;

case ' ': // Space
  if (selectedNode?.type === 'clusterNode') {
    toggleClusterExpansion(selectedNode.id);
  }
  break;
```

**Implementation:**

- File: `useGraphKeyboardNav.js`
- Add `tabIndex` to panel containers
- Estimated effort: 1-2 hours

#### 7.9 Screen Reader Announcements

```jsx
// Add ARIA live region
<div aria-live="polite" className="sr-only">
  {selectedNode ? `Selected: ${selectedNode.data.label}` : 'No file selected'}
</div>

// Add instructions
<div id="graph-instructions" className="sr-only">
  Use arrow keys to navigate between connected files.
  Press Enter to open the selected file.
  Press Space to expand clusters.
  Press Escape to clear selection.
</div>
```

**Implementation:**

- File: `UnifiedSearchModal.jsx`
- Estimated effort: 1 hour

---

## Integration Fixes

#### 7.10 Real-Time Graph Updates After File Operations

**Problem**: After moving/deleting files, graph shows stale data.

**Solution**:

```jsx
// In UnifiedSearchModal.jsx
useEffect(() => {
  const handleFileOperation = async (event) => {
    const { operationType, filePath } = event.detail;

    if (operationType === 'delete') {
      // Remove node from graph
      graphActions.setNodes((prev) => prev.filter((n) => n.data.path !== filePath));
    } else if (operationType === 'move') {
      // Update node path
      const freshMetadata = await window.electronAPI.embeddings.getFileMetadata([filePath]);
      // Update node.data.path
    }
  };

  window.addEventListener('file-operation-complete', handleFileOperation);
  return () => window.removeEventListener('file-operation-complete', handleFileOperation);
}, []);
```

**Implementation:**

- File: `UnifiedSearchModal.jsx`
- Emit events from file operation handlers
- Estimated effort: 2 hours

#### 7.11 Drag-and-Drop Files to Graph

Allow dragging files from file list to graph canvas:

```jsx
<ReactFlow
  onDrop={handleFileDrop}
  onDragOver={(e) => e.preventDefault()}
>
```

**Implementation:**

- Add drop handler to ReactFlow
- Convert dropped file to node
- Estimated effort: 2-3 hours (lower priority)

---

## Implementation Priority Matrix (Pareto)

### Phase 7A: Quick Wins (Do First) - ~6 hours total

| Task                      | Impact | Effort | File                   | Status      |
| ------------------------- | ------ | ------ | ---------------------- | ----------- |
| 7.3 Improved empty state  | High   | 1hr    | UnifiedSearchModal.jsx | ✅ Complete |
| 7.4 Zoom level indicator  | Medium | 30min  | UnifiedSearchModal.jsx | ✅ Complete |
| 7.6 Enhanced node details | High   | 2-3hr  | UnifiedSearchModal.jsx | ✅ Complete |
| 7.9 Screen reader basics  | Medium | 1hr    | UnifiedSearchModal.jsx | ✅ Complete |

### Phase 7B: Structural Improvements - ~5 hours total

| Task                     | Impact | Effort | File                                      | Status      |
| ------------------------ | ------ | ------ | ----------------------------------------- | ----------- |
| 7.1 Control grouping     | High   | 2-3hr  | UnifiedSearchModal.jsx                    | ✅ Complete |
| 7.7 Move legend to panel | Medium | 1-2hr  | UnifiedSearchModal.jsx, ClusterLegend.jsx | ✅ Complete |

### Phase 7C: Polish & Advanced - ~6 hours total

| Task                    | Impact | Effort | File                   | Status      |
| ----------------------- | ------ | ------ | ---------------------- | ----------- |
| 7.8 Tab navigation      | Medium | 1-2hr  | useGraphKeyboardNav.js | ✅ Complete |
| 7.10 Real-time updates  | High   | 2hr    | UnifiedSearchModal.jsx | ✅ Complete |
| 7.11 Drag-drop to graph | Low    | 2-3hr  | UnifiedSearchModal.jsx | ✅ Complete |
| 7.5 Tooltip tour        | Low    | 2hr    | GraphTour.jsx          | ✅ Complete |

---

## Testing Checklist

### Functional Tests

- [ ] Search adds nodes to empty graph
- [ ] Search with "Add to existing" merges nodes
- [ ] Double-click cluster expands members
- [ ] Keyboard navigation works (arrows, enter, escape)
- [ ] Context menus work on all node types
- [ ] Legend filters actually filter nodes
- [ ] Layout buttons arrange nodes correctly

### UX Validation

- [ ] New user can understand graph without documentation
- [ ] Primary actions (search, expand) are obvious
- [ ] Secondary actions are accessible but not distracting
- [ ] Zoom/pan is intuitive
- [ ] Node details provide useful information

### Accessibility

- [ ] Tab navigates between panels
- [ ] Screen reader announces selections
- [ ] Color is not the only differentiator
- [ ] Keyboard shortcuts work

---

## Files to Modify

| File                                                    | Changes                                                |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `src/renderer/components/search/UnifiedSearchModal.jsx` | Empty state, details panel, collapsible controls, ARIA |
| `src/renderer/components/search/ClusterLegend.jsx`      | Move to panel, condense                                |
| `src/renderer/hooks/useGraphKeyboardNav.js`             | Tab navigation, space for expand                       |
| `src/renderer/hooks/index.js`                           | Export new hooks if needed                             |

---

## Success Metrics

1. **First-time users** can add files to graph and explore within 30 seconds
2. **Power users** can access advanced features without clutter
3. **Accessibility** passes basic screen reader testing
4. **No breaking changes** to existing functionality

---

## Next Steps

1. Review this plan
2. Start with **Phase 7A Quick Wins**
3. Gather user feedback after each phase
4. Iterate based on actual usage patterns
