# El StratoSort Codebase Learning Guide

Welcome to the El StratoSort codebase! This guide is designed to serve as a comprehensive map for
understanding what you have built. It breaks down the software from multiple engineering
perspectives, ranging from high-level architecture to specific design patterns and critical system
concepts.

---

## Table of Contents

1.  [Architecture View](#1-architecture-view) (The Blueprint)
2.  [Design Pattern View](#2-design-pattern-view) (The Building Blocks)
3.  [Data Engineering View](#3-data-engineering-view) (The Flow)
4.  [AI & ML View](#4-ai--ml-view) (The Brain)
5.  [Resilience Engineering View](#5-resilience-engineering-view) (The Safety Nets)
6.  [Security View](#6-security-view) (The Shields)
7.  [Glossary of Terms](#7-glossary-of-terms)
8.  [Code Examples](#8-code-examples)

---

## 1. Architecture View

**Pattern:** **Multi-Process Architecture (Electron)** This is not a standard web app. It is a
distributed system running locally on one machine.

- **Main Process (Node.js):**
  - **Role:** The "Server" or "Backend". It has full OS access (files, processes).
  - **Responsibility:** It orchestrates everything—launching AI models, reading files, managing the
    database, and creating windows.
  - **Key File:** `src/main/simple-main.js` (The Entry Point).

- **Renderer Process (React/Chrome):**
  - **Role:** The "Client" or "Frontend". It lives in a sandboxed web page.
  - **Responsibility:** Displaying UI, managing user state (Redux), and asking the Main process to
    do heavy lifting.
  - **Key File:** `src/renderer/App.js`.

- **IPC (Inter-Process Communication):**
  - **Role:** The "Network Bridge". Since Main and Renderer are separate processes (with separate
    memory), they cannot share variables. They must send messages to each other.
  - **Mechanism:** Asynchronous message passing (like HTTP requests but internal).

**Diagram:**

```
[Renderer Process (UI)]  <===>  [IPC Bridge (Security)]  <===>  [Main Process (Backend)]
(React, Redux)                  (preload.js)                    (Node.js, Services, DB)
```

---

## 2. Design Pattern View

Your codebase isn't just a script; it uses established "Gang of Four" (GoF) design patterns to solve
common software problems.

### A. Singleton Pattern

**Concept:** Ensure a class has only one instance and provide a global point of access to it.
**Usage:** Essential for managing shared resources like database connections or AI models.
**Examples in Code:**

- **`ServiceContainer.js`**: A massive Registry that holds Singletons. It ensures we don't create 10
  connections to ChromaDB, but reuse the same one everywhere.
- **`OllamaClient.js`**: The AI client is a Singleton (`getInstance`). We only want one client
  talking to the local AI server at a time.

### B. Observer Pattern

**Concept:** An object (Subject) maintains a list of dependents (Observers) and notifies them of
state changes. **Usage:** Decoupling components. The component changing the settings doesn't need to
know _who_ is listening, just that it changed. **Examples in Code:**

- **`ChromaDBServiceCore`**: Extends `EventEmitter`. It emits `'offline'`, `'online'`,
  `'circuitStateChange'`. The UI listens for these events to show the red/green status connection
  badge.
- **`SettingsService`**: When `settings.json` changes on disk, it emits an event so the app updates
  live without a restart.

### C. Strategy Pattern

**Concept:** Define a family of algorithms, encapsulate each one, and make them interchangeable.
**Usage:** Handling different file types without a giant `if/else` block. **Examples in Code:**

- **`documentExtractors.js`**: We have different "strategies" for extracting text.
  - _PDF Strategy_: `extractTextFromPdf`
  - _Word Strategy_: `extractTextFromDocx`
  - _Image Strategy_: `ocrPdfIfNeeded` (OCR) The main analysis service just says "Extract", and the
    correct strategy is chosen based on the file extension.

### D. Factory Pattern

**Concept:** Create objects without specifying the exact class of object that will be created.
**Usage:** Simplifying complex setup logic. **Examples in Code:**

- **`ServiceContainer.js`**: Uses "Factory Functions" (`registerSingleton('name', factoryFn)`) to
  lazy-load services only when they are needed.
- **`createWindow.js`**: A factory that produces a configured Browser Window with all the correct
  security settings and event listeners attached.

---

## 3. Data Engineering View

How does data move and persist?

**A. State Management (Redux)**

- **Concept:** Single Source of Truth.
- **Implementation:** The frontend doesn't store data in random variables. It stores it in a giant
  tree called the **Store**.
- **Flow:** `Action (User Clicks)` -> `Reducer (Updates State)` -> `View (Re-renders)`.

**B. Vector Database (ChromaDB)**

- **Concept:** High-dimensional data storage. Standard databases (SQL) store text. Vector DBs store
  _meaning_.
- **Data:** We store "Embeddings" (arrays of floating-point numbers like `[0.12, -0.98, 0.33...]`).
- **Querying:** We don't search for "keyword matches". We search for "Cosine Similarity"
  (mathematical closeness).
- **Key File:** `src/main/services/chromadb/ChromaDBServiceCore.js`.

**C. Caching Strategy**

- **Concept:** Don't do the same work twice.
- **Implementation:**
  - **File Analysis Cache:** `FileAnalysisService.js` keeps a map of `path + size + mtime`. If a
    file hasn't changed, we return the previous AI result instantly (0ms) instead of re-running the
    LLM (3000ms).
  - **Query Cache:** `ChromaQueryCache.js` caches database results to make the UI snappy.

---

## 4. AI & ML View

This is the "Brain" of the operation.

**A. RAG (Retrieval Augmented Generation)**

- **Concept:** Giving the AI "memory" by retrieving relevant data before asking it a question.
- **Flow:**
  1.  User asks: "Where are my tax documents?"
  2.  App converts question to Vector.
  3.  App queries ChromaDB for files with similar Vectors (Retrieval).
  4.  App sends the _question_ + _file summaries_ to Ollama (Generation).
- **Code:** `FolderMatchingService.js` implements the retrieval part of this flow.

**B. Embeddings**

- **Concept:** Translating human language into machine language (vectors).
- **Implementation:** We use a specific model (like `nomic-embed-text`) via Ollama to turn file
  content into vectors.

**C. Local Inference**

- **Concept:** Running AI on the user's GPU, not in the cloud.
- **Engineering Challenge:** This is resource-intensive.
- **Solution:** `ParallelEmbeddingService.js` manages concurrency. It ensures we don't crash the
  user's computer by trying to process 100 files at once. It uses a semaphore/queue system to limit
  active jobs.

---

## 5. Resilience Engineering View

How does the software handle failure? (This distinguishes "scripts" from "systems").

**A. Circuit Breaker Pattern**

- **Problem:** If ChromaDB crashes, asking it for data 100 times a second will just generate 100
  errors and maybe freeze the app.
- **Solution:** The `CircuitBreaker` (`CircuitBreaker.js`) monitors failures.
  - _Closed (Normal):_ Requests go through.
  - _Open (Broken):_ If 5 errors happen in a row, the breaker "trips". Requests fail _immediately_
    without trying the DB.
  - _Half-Open (Recovery):_ After 30s, it lets one request through to test if the DB is back.

**B. Offline Queue Pattern**

- **Problem:** The user organizes a file while the database is disconnected. We can't just lose that
  data.
- **Solution:** `OfflineQueue.js`. Operations are saved to a persistent queue (on disk). When the
  Circuit Breaker closes (comes back online), the queue automatically flushes (replays) all the
  saved actions.

**C. Dead Letter Handling**

- **Concept:** What happens to items that _never_ succeed?
- **Implementation:** If a file fails analysis repeatedly, it is marked with a specific error state
  rather than crashing the batch processor.

---

## 6. Security View

**A. Context Isolation**

- **Concept:** The "Sandbox".
- **Implementation:** The renderer (web page) **cannot** require Node.js modules. It doesn't know
  `fs` (filesystem) exists. It can only use `window.electronAPI`.

**B. The Preload Bridge**

- **Key File:** `src/preload/preload.js`.
- **Mechanism:**
  - It "Preloads" before the website runs.
  - It has access to both Node.js and the DOM.
  - It creates a safe API (`contextBridge.exposeInMainWorld`).
- **Sanitization:** The `SecureIPCManager` strips dangerous characters from file paths to prevent
  "Path Traversal Attacks" (e.g., trying to read `../../../../etc/passwd`).

---

## 7. Glossary of Terms

### General Software Engineering

- **Async/Await:** Modern JavaScript syntax for handling operations that take time (like reading a
  file or querying a database) without freezing the application. Used extensively in the Main
  Process (e.g., `await fs.readFile()`).

- **Dependency Injection (DI):** A design pattern where a class receives its dependencies from the
  outside rather than creating them itself. Our `ServiceContainer` injects services like
  `ChromaDBService` into `FolderMatchingService`, making testing easier.

- **Memoization:** An optimization technique where the result of a function is cached. If the
  function is called again with the same inputs, the cached result is returned instantly. Used in
  React (`React.memo`) and backend (`FileAnalysisService` caches results).

- **Singleton:** A pattern ensuring a class has only one instance. Used for `OllamaClient` (one AI
  connection) and `SettingsService` (one source of truth).

- **Circuit Breaker:** A resilience pattern that detects failures and prevents cascading errors. If
  ChromaDB fails repeatedly, the breaker "trips" and stops requests for a recovery period.

### Electron & Architecture

- **Main Process:** The entry point of an Electron app running in Node.js with full OS access.
  Handles file I/O, spawning processes, managing windows, and IPC events.

- **Renderer Process:** The web page displayed in the application window running Chromium.
  Responsible for UI (React), user interactions, and local state (Redux). Sandboxed for security.

- **IPC (Inter-Process Communication):** The communication mechanism between Main and Renderer
  processes using named channels (e.g., `files:analyze`). Methods include `invoke` (request/reply)
  and `send` (fire and forget).

- **Preload Script:** A script that runs before the web page loads with access to both Node.js APIs
  and the DOM. Creates a secure bridge (`contextBridge`) to expose safe methods to the Renderer.

- **Context Bridge:** An Electron API that isolates the Renderer from the Main process context,
  preventing security attacks. We expose `window.electronAPI` via the Context Bridge.

### AI & Data Science

- **LLM (Large Language Model):** An AI model trained on vast amounts of text to understand and
  generate human language. We use models like `llama3` via Ollama.

- **Inference:** Running live data through a trained AI model to get a prediction. When you click
  "Analyze", the app performs local inference on your GPU.

- **Embedding (Vector):** A representation of text as a list of numbers (e.g., `[0.1, -0.5, ...]`).
  Similar concepts have mathematically similar vectors, enabling semantic search.

- **RAG (Retrieval-Augmented Generation):** A technique where an AI is given relevant external data
  (retrieved from a database) to help it answer accurately. We retrieve similar folders from
  ChromaDB, then ask the AI where a file belongs.

- **Cosine Similarity:** A metric measuring how similar two vectors are. Used by ChromaDB to rank
  folder matches.

- **Ollama:** A tool for running open-source LLMs locally. Acts as our local AI server at
  `localhost:11434`.

### Frontend & UI (React/Redux)

- **Component:** A reusable, self-contained piece of UI code (e.g., `Button.jsx`, `FileList.jsx`).

- **Hook:** A special React function (starting with `use`) that lets you access React features like
  state. Examples: `useState`, `useEffect`, `useSelector`.

- **Redux Store:** A centralized container for the entire application's state. Holds files,
  settings, and analysis status.

- **Slice:** A portion of the Redux store dedicated to a specific feature (e.g., `filesSlice`,
  `uiSlice`).

- **Tailwind CSS:** A utility-first CSS framework using pre-defined classes like `flex`, `p-4`,
  `text-red-500`.

### Project-Specific

- **Smart Folder:** A folder configuration that includes a Vector Embedding, acting as a "magnet"
  for semantically similar files.

- **ServiceContainer:** Our custom Dependency Injection system in
  `src/main/services/ServiceContainer.js` managing service lifecycle.

- **ChromaDBService:** The service wrapper for the ChromaDB vector database, handling Circuit
  Breaker logic and health checks.

- **File Signature:** A unique string (`path + size + lastModifiedTime`) used as a cache key to
  detect file changes.

- **Zod Schema:** A data validation definition ensuring IPC data is correct before use.

### Infrastructure & Tools

- **Webpack:** A module bundler that takes JS, CSS, and images and bundles them into optimized
  files.

- **Jest:** JavaScript testing framework for unit tests.

- **Playwright:** End-to-end testing tool that launches the app and simulates user interactions.

- **ESLint / Prettier:** Code quality tools. ESLint finds bugs; Prettier formats code consistently.

---

## 8. Code Examples

This section provides concrete code snippets for common patterns in the codebase.

### 8.1 Backend Services (Main Process)

#### Defining a Service

```javascript
// src/main/services/MyNewService.js
const { logger } = require('../../shared/logger');

class MyNewService {
  constructor(dependencyA, dependencyB) {
    this.depA = dependencyA;
    this.depB = dependencyB;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    logger.info('[MyNewService] Initializing...');
    // ... setup logic ...
    this.initialized = true;
  }

  doSomething(data) {
    if (!this.initialized) throw new Error('Service not initialized');
    return this.depA.process(data);
  }
}

module.exports = MyNewService;
```

#### Registering with ServiceContainer

```javascript
// src/main/services/ServiceIntegration.js
const { container, ServiceIds } = require('./ServiceContainer');
const MyNewService = require('./MyNewService');

// Inside _registerCoreServices():
if (!container.has('myNewService')) {
  container.registerSingleton('myNewService', (c) => {
    const depA = c.resolve(ServiceIds.CHROMA_DB);
    const depB = c.resolve(ServiceIds.SETTINGS);
    return new MyNewService(depA, depB);
  });
}
```

#### Accessing a Service

```javascript
const { container, ServiceIds } = require('./ServiceContainer');

// Standard Resolution (throws if missing)
const myService = container.resolve('myNewService');

// Safe Resolution (returns null if missing)
const maybeService = container.tryResolve('myNewService');
if (maybeService) {
  maybeService.doSomething();
}
```

### 8.2 IPC (Inter-Process Communication)

#### Creating a Handler (Backend)

```javascript
// src/main/ipc/myFeature.js
const { createHandler } = require('./ipcWrappers');

function registerMyFeatureIpc({ ipcMain, IPC_CHANNELS, logger }) {
  // Standard Request/Response
  createHandler(ipcMain, 'my-feature:get-data', async (event, params) => {
    logger.info('Received request for data', params);
    const result = await someDatabaseCall(params.id);
    return { success: true, data: result };
  });

  // Streaming/Events (Backend -> Frontend)
  createHandler(ipcMain, 'my-feature:start-job', async (event, params) => {
    event.sender.send('my-feature:progress', { percent: 0 });
    await doLongTask();
    event.sender.send('my-feature:progress', { percent: 100 });
    return { success: true };
  });
}

module.exports = registerMyFeatureIpc;
```

#### Exposing to Frontend (Preload)

```javascript
// src/preload/preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  myFeature: {
    getData: (id) => ipcRenderer.invoke('my-feature:get-data', { id }),
    onProgress: (callback) => {
      const subscription = (event, data) => callback(data);
      ipcRenderer.on('my-feature:progress', subscription);
      return () => ipcRenderer.removeListener('my-feature:progress', subscription);
    }
  }
});
```

#### Using in React (Frontend)

```jsx
// src/renderer/components/MyComponent.jsx
import React, { useEffect, useState } from 'react';

export const MyComponent = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      const result = await window.electronAPI.myFeature.getData(123);
      if (result.success) setData(result.data);
    };
    fetchData();

    const unsubscribe = window.electronAPI.myFeature.onProgress((progress) => {
      console.log(`Job is ${progress.percent}% done`);
    });
    return () => unsubscribe();
  }, []);

  if (!data) return <div>Loading...</div>;
  return <div>{data.name}</div>;
};
```

### 8.3 AI & Ollama Integration

```javascript
const { container, ServiceIds } = require('./ServiceContainer');

async function summarizeText(text) {
  const ollamaService = container.resolve(ServiceIds.OLLAMA_SERVICE);
  const response = await ollamaService.generateCompletion({
    model: 'llama3',
    prompt: `Summarize this: ${text}`,
    stream: false
  });
  return response.response;
}

async function getVector(text) {
  const embeddingService = container.resolve(ServiceIds.PARALLEL_EMBEDDING);
  return await embeddingService.generateEmbedding(text);
}
```

### 8.4 ChromaDB Operations

```javascript
const { container, ServiceIds } = require('./ServiceContainer');

async function findSimilarFolders(fileContent) {
  const chromaService = container.resolve(ServiceIds.CHROMA_DB);
  const embeddingService = container.resolve(ServiceIds.PARALLEL_EMBEDDING);

  const queryVector = await embeddingService.generateEmbedding(fileContent);
  const collection = await chromaService.getCollection('folders');

  return await collection.query({
    queryEmbeddings: [queryVector],
    nResults: 5
  });
}
```

### 8.5 Redux State Management

#### Creating a Slice

```javascript
// src/renderer/store/slices/mySlice.js
import { createSlice } from '@reduxjs/toolkit';

const mySlice = createSlice({
  name: 'myFeature',
  initialState: { items: [], loading: false },
  reducers: {
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
    addItems: (state, action) => {
      state.items.push(...action.payload);
    }
  }
});

export const { setLoading, addItems } = mySlice.actions;
export default mySlice.reducer;
```

#### Using in Components

```jsx
import { useDispatch, useSelector } from 'react-redux';
import { setLoading } from '../store/slices/mySlice';

const MyButton = () => {
  const dispatch = useDispatch();
  const isLoading = useSelector((state) => state.myFeature.loading);

  return (
    <button disabled={isLoading} onClick={() => dispatch(setLoading(true))}>
      Work
    </button>
  );
};
```

---

_This document acts as the engineering manual for El StratoSort. It covers the "Why" and "How"
behind the code architecture._
