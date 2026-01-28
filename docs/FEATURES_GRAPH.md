# Knowledge Graph Features

## Overview

The **Knowledge Graph** in El StratoSort provides an interactive visualization of your document
organization. It moves beyond simple file lists to show you how your documents are connected
semantically.

## Core Features

### 🕸️ Interactive Visualization

- **React Flow Integration**: Smooth, zoomable canvas interface.
- **Auto-Layout**: Uses ELK algorithms to organize nodes intelligently.
- **Context Menus**: Right-click on any node for quick actions (Open, Reveal in Explorer, Organize).

### 🧠 Semantic Clustering

The graph doesn't just show files; it shows _meaning_.

- **Similarity Edges**: Lines connect files that are semantically similar, with thickness indicating
  strength of relationship.
- **Clusters**: Files are automatically grouped into color-coded clusters based on topic.
- **Query Nodes**: When you search, your query appears as a central node, showing exactly which
  files match your intent.

### 🔍 Exploration Tools

- **Focus Mode**: Double-click any node to center the graph on it and reveal its specific
  connections.
- **Expansion**: Dynamically load more connections as you explore "hops" away from your starting
  point.
- **Filtering**: Use the legend to toggle visibility of clusters, file types, or confidence levels.

## Technical Implementation

### Frontend (`Renderer`)

- `GraphView.jsx`: Main container component.
- `useGraphState.js`: Manages the complex state of nodes and edges.
- `UnifiedSearchModal.jsx`: Bridges the search experience with graph visualization.

### Backend (`Main Process`)

- `GraphService.js`: Handles the heavy lifting of graph construction.
- `ChromaDB`: Provides the raw vector data and similarity scores.
- `ReRankerService`: Refines connections to ensure high-quality edges.

## Usage Guide

1.  **Search**: Start by typing a query in the search bar.
2.  **Visual Results**: Switch to the "Graph" tab to see your results visualized.
3.  **Explore**:
    - **Click** a node to select it.
    - **Double-click** to focus and expand.
    - **Drag** nodes to rearrange your view.
4.  **Action**: Right-click to open files or apply organization suggestions.
