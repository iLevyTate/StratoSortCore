# Stratosort Code Examples

This guide provides concrete code snippets for common patterns and tasks within the Stratosort
codebase. It is designed to bridge the gap between the architectural diagrams and the actual
implementation.

## 1. Backend Services (Main Process)

### Defining a Service

Most core logic resides in services. A service is typically a class that handles a specific domain.

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

### Registering with `ServiceContainer`

Services are registered in `src/main/services/ServiceIntegration.js` or `ServiceContainer.js`.

```javascript
// src/main/services/ServiceIntegration.js
const { container, ServiceIds } = require('./ServiceContainer');
const MyNewService = require('./MyNewService');

// Inside _registerCoreServices() or similar setup method:
if (!container.has('myNewService')) {
  container.registerSingleton('myNewService', (c) => {
    // Resolve dependencies from the container
    const depA = c.resolve(ServiceIds.CHROMA_DB);
    const depB = c.resolve(ServiceIds.SETTINGS);

    return new MyNewService(depA, depB);
  });
}
```

### Accessing a Service

Use the `ServiceContainer` to retrieve instances.

```javascript
const { container, ServiceIds } = require('./ServiceContainer');

// 1. Standard Resolution (throws if missing)
const myService = container.resolve('myNewService');
myService.doSomething();

// 2. Safe Resolution (returns null if missing)
const maybeService = container.tryResolve('myNewService');
if (maybeService) {
  maybeService.doSomething();
}
```

---

## 2. IPC (Inter-Process Communication)

### Creating a Handler (Backend)

Handlers in `src/main/ipc/` define how the backend responds to frontend requests.

```javascript
// src/main/ipc/myFeature.js
const { createHandler, withErrorLogging } = require('./ipcWrappers');

function registerMyFeatureIpc({ ipcMain, IPC_CHANNELS, logger }) {
  // Standard Request/Response
  createHandler(ipcMain, 'my-feature:get-data', async (event, params) => {
    logger.info('Received request for data', params);

    // Perform logic
    const result = await someDatabaseCall(params.id);

    return { success: true, data: result };
  });

  // Streaming/Events (Backend -> Frontend)
  createHandler(ipcMain, 'my-feature:start-job', async (event, params) => {
    // Send updates back to the specific window that called this
    event.sender.send('my-feature:progress', { percent: 0 });

    await doLongTask();

    event.sender.send('my-feature:progress', { percent: 100 });
    return { success: true };
  });
}

module.exports = registerMyFeatureIpc;
```

### Exposing to Frontend (Preload)

The preload script (`src/preload/preload.js`) acts as the security bridge.

```javascript
// src/preload/preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing APIs ...

  myFeature: {
    getData: (id) => ipcRenderer.invoke('my-feature:get-data', { id }),
    onProgress: (callback) => {
      // Security: Strip event object, pass only data
      const subscription = (event, data) => callback(data);
      ipcRenderer.on('my-feature:progress', subscription);

      // Return unsubscribe function
      return () => ipcRenderer.removeListener('my-feature:progress', subscription);
    }
  }
});
```

### Using in React (Frontend)

Components interact with the backend via `window.electronAPI`.

```jsx
// src/renderer/components/MyComponent.jsx
import React, { useEffect, useState } from 'react';

export const MyComponent = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    // 1. Call Backend
    const fetchData = async () => {
      try {
        const result = await window.electronAPI.myFeature.getData(123);
        if (result.success) setData(result.data);
      } catch (error) {
        console.error('IPC Failed', error);
      }
    };

    fetchData();

    // 2. Listen for Events
    const unsubscribe = window.electronAPI.myFeature.onProgress((progress) => {
      console.log(`Job is ${progress.percent}% done`);
    });

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, []);

  if (!data) return <div>Loading...</div>;
  return <div>{data.name}</div>;
};
```

---

## 3. AI & Ollama Integration

### Analyzing Text

Use the `OllamaService` to generate completions or analyze content.

```javascript
const { container, ServiceIds } = require('./ServiceContainer');

async function summarizeText(text) {
  const ollamaService = container.resolve(ServiceIds.OLLAMA_SERVICE);

  // Basic Generation
  const response = await ollamaService.generateCompletion({
    model: 'llama3',
    prompt: `Summarize this: ${text}`,
    stream: false
  });

  return response.response; // The generated text
}
```

### Generating Embeddings

Use `ParallelEmbeddingService` for efficient vector generation.

```javascript
const { container, ServiceIds } = require('./ServiceContainer');

async function getVector(text) {
  const embeddingService = container.resolve(ServiceIds.PARALLEL_EMBEDDING);

  // Handles queuing and concurrency automatically
  const vector = await embeddingService.generateEmbedding(text);

  // Returns array: [0.123, -0.456, ...]
  return vector;
}
```

---

## 4. ChromaDB Operations

### Querying Similar Items

```javascript
const { container, ServiceIds } = require('./ServiceContainer');

async function findSimilarFolders(fileContent) {
  const chromaService = container.resolve(ServiceIds.CHROMA_DB);
  const embeddingService = container.resolve(ServiceIds.PARALLEL_EMBEDDING);

  // 1. Convert query to vector
  const queryVector = await embeddingService.generateEmbedding(fileContent);

  // 2. Query Collection
  const collection = await chromaService.getCollection('folders');
  const results = await collection.query({
    queryEmbeddings: [queryVector],
    nResults: 5 // Top 5 matches
  });

  return results;
}
```

---

## 5. Redux State Management

### Creating a Slice

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

### Dispatching from Component

```jsx
import { useDispatch, useSelector } from 'react-redux';
import { setLoading } from '../store/slices/mySlice';

const MyButton = () => {
  const dispatch = useDispatch();
  const isLoading = useSelector((state) => state.myFeature.loading);

  const handleClick = () => {
    dispatch(setLoading(true));
    // ... do async work ...
  };

  return (
    <button disabled={isLoading} onClick={handleClick}>
      Work
    </button>
  );
};
```
