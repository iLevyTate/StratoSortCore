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

- **IPC:** Inter-Process Communication. The phone line between backend and frontend.
- **Singleton:** A class with only one instance (e.g., Database Connection).
- **Context Isolation:** Security feature separating the website from the computer internals.
- **Embedding:** A list of numbers representing the meaning of text.
- **Vector DB:** A database optimized for searching embeddings (similarity search).
- **Circuit Breaker:** A pattern to stop cascading failures when a service is down.
- **RAG:** Retrieval Augmented Generation. AI that looks up info before answering.
- **Ollama:** The local server that runs the AI models.
- **Daemon:** A background process (like ChromaDB or Ollama) that runs independently of the main
  app.
- **State (Redux):** The snapshot of data at any given moment in time.
- **Memoization:** Caching the result of a function so you don't have to calculate it again.

---

_This document acts as the engineering manual for El StratoSort. It covers the "Why" and "How"
behind the code architecture._
