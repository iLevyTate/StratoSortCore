-- layout: single title: "MOTION SYSTEM" sidebar: nav: "docs" --

# Motion System

This project uses a restrained motion language designed to feel premium, clear, and calm.

## Principles

- Motion should clarify state changes, not draw attention to itself.
- Prefer opacity and shadow transitions over aggressive transforms.
- Avoid bouncy or playful scaling on core workflows.
- Keep interaction timing consistent across UI primitives.

## Core Tokens

Defined in `src/renderer/styles.css`:

- `--motion-duration-fast`: `140ms` (hover/press feedback)
- `--motion-duration-standard`: `220ms` (open/enter transitions)
- `--motion-duration-slow`: `320ms` (loading content fades)
- `--motion-ease-standard`: `cubic-bezier(0.2, 0, 0, 1)`
- `--motion-ease-emphasized`: `cubic-bezier(0.22, 1, 0.36, 1)`

Legacy aliases map to this system for compatibility:

- `--duration-fast` -> `--motion-duration-fast`
- `--duration-normal` -> `--motion-duration-standard`
- `--duration-slow` -> `--motion-duration-slow`

## Usage Rules

- **Hover/press micro-interactions**
  - Use `--motion-duration-fast` and `--motion-ease-standard`.
  - Transition only required properties (`color`, `background-color`, `border-color`, `box-shadow`,
    `opacity`).
  - Avoid `transition-all` for frequently used controls.

- **Panels/modals/phase transitions**
  - Use `--motion-duration-standard` for enter.
  - Use `--motion-duration-fast` for exit.
  - Prefer opacity-first transitions; keep translation minimal and subtle.

- **Loading states**
  - Use `animate-loading-fade` and `animate-loading-content`.
  - Keep loading transitions opacity-based to avoid layout jitter.

## Avoid

- Large scale transforms on cards/buttons in main workflows.
- Deep chained transforms during modal + page transition overlap.
- Mixed easing curves for similar UI patterns.

## Accessibility

Respect reduced motion. Motion utility classes are already reduced to near-instant behavior under
`prefers-reduced-motion`.
