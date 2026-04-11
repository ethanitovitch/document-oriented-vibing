This project is a VS Code extension called **document-oriented-vibing** (DOV). It lets you plan features as text-based Mermaid diagrams before coding them.

## How it works

- Features live as `.md` files in `.features/` at the workspace root.
- Each file has a `# Feature:` title, `## Diagram` with a mermaid block, and `## Summary`.
- Opening a feature from `DOV: Home` shows a Mermaid preview panel with zoom controls.
- The preview updates automatically when the file changes — by you, an LLM, or git.
- Nodes with file paths in labels (e.g. `src/auth/controller.ts`) are clickable — opens the file in VS Code.
- "Edit source" button opens the raw `.md` file in the text editor.
- The extension injects LLM instructions into the target project's `CLAUDE.md` so any LLM knows the format.

## Workflow modes

Users prefix their request with a mode keyword:

- **`+plan`** — Plan only. Create the `.features/*.md` diagram with placeholder file paths. Do NOT write source code. User reviews the diagram first.
- **`+show`** — Build and show. Write the actual source code, then create the `.features/*.md` diagram with real file paths pointing to the code just written.

Default to `+plan` if no mode is specified.

## Architecture

- `src/extension.ts` — VS Code extension host. Commands, panels, file CRUD, file watcher, openFile handler.
- `src/feature-graph/schema.ts` — Feature file template, LLM instructions text, schema doc. Contains workflow mode docs.
- `src/webview/home/` — React webview for the home screen (feature list, create, settings).
- `src/webview/feature/` — React webview for the Mermaid preview panel. Clickable nodes, zoom.
- `src/webview/settings/` — React webview for settings.
- `esbuild.js` — Bundles extension + webviews. Copies `mermaid.min.js` and `purify.min.js` to `dist-webview/`.

## Feature file format

```
# Feature: <title>

## Diagram

` ` `mermaid
flowchart LR
    A([Start]) --> B["doSomething\nsrc/example.ts"]
    B --> C([End])
` ` `

## Summary
<describe intent, constraints, expected behavior>
```

Diagram comes first. Use bare relative paths (like `src/foo/bar.ts`) in node labels to make nodes clickable. **Never prefix paths with `@`** — it conflicts with Mermaid syntax. Any valid Mermaid diagram type works: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, journey, gantt.
