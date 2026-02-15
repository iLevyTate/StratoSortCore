# IPC Contracts

This document describes the IPC payload contracts used between the renderer and main processes.
Schemas are defined in code and should be treated as the source of truth.

## Sources of Truth

- Input validation schemas: `src/main/ipc/validationSchemas.js`
- Event payload schemas: `src/shared/ipcEventSchemas.js`
- IPC handlers and channel registration: `src/main/ipc/*`
- Renderer event validation: `src/renderer/store/middleware/ipcMiddleware.js`

## Input Validation (Renderer -> Main)

Most IPC handlers use `createHandler()` or `withValidation()` to validate inputs. When Zod is
available, `validationSchemas.js` defines the expected shapes for:

- Settings payloads
- File operations (single + batch)
- Analysis inputs (single + batch)
- Suggestions and feedback payloads
- Embeddings search and query inputs

If Zod is not available, a fallback validator performs basic checks for critical fields.

## Event Payloads (Main -> Renderer)

Event payloads are validated in `ipcMiddleware.js` using schemas in `ipcEventSchemas.js`. If a
schema exists for a channel, invalid payloads are logged and passed through to avoid breaking
functionality.

## Adding or Modifying a Contract

1. Add/modify a schema in `src/main/ipc/validationSchemas.js` or `src/shared/ipcEventSchemas.js`.
2. Update handlers to reference the schema (or to normalize inputs).
3. Update tests if the payload shape changes.
4. Ensure new payloads are documented here.

## Conventions

- Use normalized paths and IDs (see `src/shared/pathSanitization.js`).
- Keep query strings trimmed and bounded in length.
- Prefer structured errors with `errorType` and `errorCode`.
