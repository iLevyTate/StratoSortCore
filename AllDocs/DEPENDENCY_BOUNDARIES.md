# Dependency Boundaries

This document defines main/renderer/shared boundaries to prevent cross-layer coupling.

## Rules

1. **Renderer must not import main-only modules** (e.g., `src/main/*`).
2. **Main must not import renderer-only modules** (e.g., `src/renderer/*`).
3. **Shared modules** (`src/shared/*`) must avoid Node APIs that are not available in the renderer.
4. **IPC is the only bridge** between main and renderer. Use typed IPC contracts.

## Allowed Imports

- Renderer: `src/shared/*`, `src/renderer/*`
- Main: `src/shared/*`, `src/main/*`
- Shared: `src/shared/*` only

## Enforcement

- Prefer IPC channels and payload schemas for cross-process data.
- Add lint rules for import boundaries when feasible.
