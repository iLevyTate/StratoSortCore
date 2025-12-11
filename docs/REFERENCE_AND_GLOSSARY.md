# El StratoSort Reference & Glossary

This document serves as a comprehensive dictionary and conceptual reference for the codebase. It
covers general software engineering terms, specific technologies used, and project-specific
vocabulary.

---

## 1. General Software Engineering Concepts

### **Async/Await**

- **Definition:** Modern JavaScript syntax for handling operations that take time (like reading a
  file or querying a database) without freezing the application.
- **In Context:** Used extensively in the **Main Process** (e.g., `await fs.readFile()`). The
  keyword `await` pauses the function execution until the task is done, but lets other parts of the
  app continue running.

### **Dependency Injection (DI)**

- **Definition:** A design pattern where a class receives its dependencies (tools it needs) from the
  outside rather than creating them itself.
- **In Context:** Our `ServiceContainer` injects the `ChromaDBService` into the
  `FolderMatchingService`. This makes testing easier because we can swap in a "fake" database during
  tests.

### **Memoization**

- **Definition:** An optimization technique where the result of a function is cached. If the
  function is called again with the same inputs, the cached result is returned instantly.
- **In Context:**
  - **React:** `React.memo` prevents UI components from re-rendering if their props haven't changed.
  - **Backend:** `FileAnalysisService` caches analysis results based on file size and modification
    time.

### **Singleton Pattern**

- **Definition:** A pattern ensuring a class has only one instance and provides a global point of
  access to it.
- **In Context:** Used for `OllamaClient` (we only want one connection to the AI server) and
  `SettingsService` (we want one source of truth for settings).

### **Circuit Breaker**

- **Definition:** A resilience pattern that detects failures and encapsulates the logic of
  preventing a failure from constantly recurring.
- **In Context:** If ChromaDB fails repeatedly, the `CircuitBreaker` "trips" (opens), stopping
  further requests for a set time to allow the system to recover.

---

## 2. Electron & Architecture Terms

### **Main Process**

- **Definition:** The entry point of an Electron app. It runs in a Node.js environment and has full
  access to the operating system.
- **Responsibilities:** File I/O, spawning child processes (like Python scripts or ChromaDB),
  managing windows, and handling IPC events.

### **Renderer Process**

- **Definition:** The web page displayed in the application window. It runs Chromium (the engine
  behind Chrome).
- **Responsibilities:** Rendering the UI (React), handling user interactions, and managing local
  state (Redux). It is "sandboxed" for security.

### **IPC (Inter-Process Communication)**

- **Definition:** The communication mechanism between the Main and Renderer processes.
- **Channels:** Named pipes for messages (e.g., `files:analyze`).
- **Methods:**
  - `ipcRenderer.invoke(channel, data)`: Send a message and wait for a reply (Promise).
  - `ipcRenderer.send(channel, data)`: Send a message without waiting ("fire and forget").

### **Preload Script**

- **Definition:** A script that runs before the web page loads. It has access to both Node.js APIs
  and the DOM.
- **Purpose:** It creates a secure bridge (`contextBridge`) to expose specific, safe methods to the
  Renderer, preventing the website from having full OS access.

### **Context Bridge**

- **Definition:** An Electron API that isolates the Renderer from the Main process context,
  preventing "prototype pollution" attacks.
- **In Context:** We expose `window.electronAPI` via the Context Bridge.

---

## 3. AI & Data Science Terms

### **LLM (Large Language Model)**

- **Definition:** An AI model trained on vast amounts of text to understand and generate human
  language.
- **In Context:** We use models like `llama3` or `gemma` via **Ollama** to read documents and
  categorize them.

### **Inference**

- **Definition:** The process of running live data through a trained AI model to get a prediction or
  output.
- **In Context:** When you click "Analyze", the app performs "Local Inference" on your GPU.

### **Embedding (Vector)**

- **Definition:** A representation of text as a list of numbers (e.g., `[0.1, -0.5, ...]`). Similar
  concepts have mathematically similar vectors.
- **In Context:** We convert file contents into embeddings to perform "Semantic Search" (finding
  files by meaning, not just keywords).

### **RAG (Retrieval-Augmented Generation)**

- **Definition:** A technique where an AI is given relevant external data (retrieved from a
  database) to help it answer a question accurately.
- **In Context:** When classifying a file, we first _retrieve_ similar folders from ChromaDB, then
  ask the AI: "Given these folders, where does this file belong?"

### **Cosine Similarity**

- **Definition:** A metric used to measure how similar two vectors are.
- **In Context:** Used by ChromaDB to rank which smart folder is the "closest match" to a document.

### **Ollama**

- **Definition:** A tool that allows users to run open-source LLMs locally.
- **In Context:** It acts as our local AI server. The app talks to it via HTTP (`localhost:11434`).

---

## 4. Frontend & UI Terms (React/Redux)

### **Component**

- **Definition:** A reusable, self-contained piece of UI code (e.g., `Button.jsx`, `fileList.jsx`).

### **Hook**

- **Definition:** A special function in React (starting with `use`) that lets you "hook into" React
  features like state.
- **Examples:**
  - `useState`: Remembers data.
  - `useEffect`: Runs code when the component loads or updates.
  - `useSelector`: Reads data from the Redux store.

### **Redux Store**

- **Definition:** A centralized container for the entire application's state.
- **In Context:** It holds the list of files, current settings, and analysis status. Using a store
  ensures that if you update a file's name in one place, it updates everywhere.

### **Slice**

- **Definition:** A portion of the Redux store dedicated to a specific feature.
- **In Context:** `filesSlice` manages file data; `uiSlice` manages layout state (like modals
  open/closed).

### **Tailwind CSS**

- **Definition:** A utility-first CSS framework. Instead of writing custom CSS classes, we use
  pre-defined classes like `flex`, `p-4` (padding 4), `text-red-500`.

---

## 5. Project-Specific Vocabulary

### **Smart Folder**

- **Definition:** A virtual or physical folder configuration that includes a Vector Embedding.
- **Function:** It acts as a "magnet" for files with similar semantic meaning.

### **ServiceContainer**

- **Definition:** Our custom Dependency Injection system located in
  `src/main/services/ServiceContainer.js`. It manages the lifecycle of all backend services.

### **ChromaDBService**

- **Definition:** The specific service wrapper that talks to the ChromaDB vector database. It
  handles the **Circuit Breaker** logic and connection health checks.

### **File Signature**

- **Definition:** A unique string (`path + size + lastModifiedTime`) used to identify if a file has
  changed.
- **Use:** Used as a cache key. If the signature matches, we skip AI analysis.

### **Zod Schema**

- **Definition:** A definition of what data should look like.
- **Use:** We use `zod` to validate that data coming from the IPC bridge is correct (e.g., ensuring
  a file path is actually a string) before using it.

---

## 6. Infrastructure & Tools

### **Webpack**

- **Definition:** A module bundler. It takes all our disparate JS, CSS, and image files and bundles
  them into optimized files that Electron can run.

### **Jest**

- **Definition:** A JavaScript testing framework.
- **Use:** Running unit tests to ensure individual functions work correctly.

### **Playwright**

- **Definition:** An end-to-end (E2E) testing tool.
- **Use:** It actually launches the app and clicks buttons like a real user to verify the whole
  system works.

### **ESLint / Prettier**

- **Definition:** Tools for code quality.
- **ESLint:** Finds bugs and coding errors.
- **Prettier:** Formats code (indentation, spacing) so it looks consistent.

---

_This reference guide works alongside the `LEARNING_GUIDE.md` to provide deep definitions for the
concepts encountered in the codebase._
