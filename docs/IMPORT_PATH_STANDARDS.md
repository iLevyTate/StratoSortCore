# Import Path Standards

## Overview

This document defines the standard import path patterns for the StratoSort codebase to ensure consistency and maintainability.

## Standard Patterns

### Main Process (CommonJS)

#### From `src/main/` (root level)

```javascript
const { logger } = require('../shared/logger');
const { ERROR_CODES } = require('../shared/errorHandlingUtils');
```

**Files:** `simple-main.js`, `folderScanner.js`, `llmService.js`, `ollamaUtils.js`

#### From `src/main/services/`, `src/main/utils/`, `src/main/analysis/`, `src/main/ipc/`

```javascript
const { logger } = require('../../shared/logger');
const { ERROR_CODES } = require('../../shared/errorHandlingUtils');
```

**Files:** All files in subdirectories of `src/main/`

#### From `src/main/core/`, `src/main/errors/`

```javascript
const { logger } = require('../../shared/logger');
```

**Files:** Files in `src/main/core/`, `src/main/errors/`

### Renderer Process (ES6 Modules)

#### From `src/renderer/` (root level)

```javascript
import { logger } from '../shared/logger';
```

**Files:** `src/renderer/index.js`

#### From `src/renderer/components/`, `src/renderer/phases/`, `src/renderer/hooks/`

```javascript
import { logger } from '../../shared/logger';
```

**Files:** Most renderer components and phases

#### From `src/renderer/utils/`, `src/renderer/contexts/`

```javascript
import { logger } from '../shared/logger';
```

**Files:** `reactEdgeCaseUtils.js`, `NotificationContext.jsx`, `PhaseContext.jsx`

#### From `src/renderer/components/ui/`, `src/renderer/components/organize/`

```javascript
import { logger } from '../../../shared/logger';
```

**Files:** Deeply nested components

## Rules

1. **Always use relative paths** - No absolute imports (webpack aliases not configured)
2. **Count directory levels** - Ensure correct number of `../` based on file location
3. **Be consistent** - Use the same pattern for all imports from `shared/`
4. **Group imports** - Node.js built-ins first, then external deps, then shared, then local

## Import Order

```javascript
// 1. Node.js built-ins
const fs = require('fs');
const path = require('path');

// 2. External dependencies
const { ChromaClient } = require('chromadb');
const React = require('react');

// 3. Shared utilities
const { logger } = require('../../shared/logger');
const { ERROR_CODES } = require('../../shared/errorHandlingUtils');

// 4. Local/sibling modules
const { extractText } = require('./documentExtractors');
const ChromaDBService = require('../services/ChromaDBService');
```

## Examples

### Main Process Service

```javascript
// File: src/main/services/ChromaDBService.js
const { app } = require('electron');
const { ChromaClient } = require('chromadb');
const { logger } = require('../../shared/logger'); // ✅ Correct
logger.setContext('ChromaDBService');
```

### Main Process Root

```javascript
// File: src/main/simple-main.js
const { app } = require('electron');
const { logger } = require('../shared/logger'); // ✅ Correct
logger.setContext('Main');
```

### Renderer Component

```javascript
// File: src/renderer/components/NavigationBar.jsx
import React from 'react';
import { logger } from '../../shared/logger'; // ✅ Correct
logger.setContext('NavigationBar');
```

### Renderer Utility

```javascript
// File: src/renderer/utils/reactEdgeCaseUtils.js
import { useEffect } from 'react';
import { logger } from '../shared/logger'; // ✅ Correct
logger.setContext('ReactEdgeCaseUtils');
```

### Deeply Nested Component

```javascript
// File: src/renderer/components/ui/Collapsible.jsx
import React from 'react';
import { logger } from '../../../shared/logger'; // ✅ Correct
logger.setContext('Collapsible');
```

## Verification

To verify import paths are correct:

1. Count directory levels from file to `src/shared/`
2. Use that many `../` in the path
3. Ensure all imports from `shared/` use the same pattern

## Migration Checklist

- [x] Document standard patterns
- [ ] Verify all main process files use correct paths
- [ ] Verify all renderer files use correct paths
- [ ] Add ESLint rule to enforce patterns
- [ ] Update CODE_QUALITY_STANDARDS.md

## Future Considerations

If webpack aliases are configured, we could use:

```javascript
import { logger } from '@shared/logger';
```

But for now, relative paths are the standard.
