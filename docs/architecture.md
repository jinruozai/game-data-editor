# Architecture

GameDataEditor is organized as a small EditorFrame application. Global modules
are allowed, but each global must keep a narrow responsibility so panels can be
moved with their declared services.

## Layers

### EditorFrame

`vendor/ef.js` and `vendor/ef.css` are the framework layer. This layer owns:

- signals and effects
- dock layout and panel registration
- generic UI controls
- generic component tree rendering
- generic history primitives

EditorFrame must not depend on GameDataEditor state, project files, assets, or
AI behavior.

### GameDataEditor Core

Core modules define the project model and app services:

- `State`: project data signals and domain commands
- `ProjectIO`: codec, workspace backends, assets, save plans, recent workspaces
- `GDE`: app helpers such as cleanup, layout, loading, clipboard, history, and AI
- `I18N`: localization
- `SceneNode`, `SceneSelection`, `SceneDOM`, `SceneAlign`, `CardStyleActions`:
  cardStyle domain utilities

Panels may depend on these services, but they should not duplicate their rules.

### App Shell

`src/app/**` contains application shell UI and bootstrap-adjacent modules that
are not dock panels. The top toolbar lives here because it mounts into
`#gde-topbar` directly and controls project-level actions. App helpers such as
layout routing, loading, clipboard, history, and DOM cleanup also live here.

`GDE.layout` owns EditorFrame dock and panel operations: opening or reusing
center panels, pinning table tabs, activating side panels, and syncing renamed
tables or card styles into already-open editor tabs. `State` exposes thin
delegating methods for existing callers, but it does not own dock traversal.

### Panels

`src/panels/**` contains UI surfaces registered through `EF.registerComponent`.
Panels should focus on view state, user interaction, and calls into core
services.

Project-specific Inspector behavior is split out of the Inspector shell:

- `src/panels/inspector.js`: generic Inspector panel and provider registry
- `src/inspector/renderers/**`: GameDataEditor field renderers
- `src/inspector/providers/**`: GameDataEditor selection providers

### CardStyle Domain

`src/cardstyle/**` contains cardStyle scene-tree utilities and render adapters:
scene nodes, scene selection, scene DOM helpers, alignment, shared actions, and
card rendering.

## Portability Rule

A panel is portable when it can be moved with:

- its panel source file
- its CSS
- the global services it explicitly depends on

It should not require hidden script-order knowledge beyond the services listed
in `index.html`.

## Boundaries

- `ProjectIO.codec` remains pure data conversion between State snapshots and
  disk files.
- `ProjectIO.fsWorkspace` and `zipWorkspace` own physical persistence.
- `ProjectIO.savePlan` owns file-level diffing.
- `State` owns data mutations and emits dirty/history events.
- `GDE.layout` owns dock traversal, panel activation, and tab reuse.
- Panels do not write project files directly.
- Inspector providers register selection-specific behavior instead of growing
  the Inspector shell.
