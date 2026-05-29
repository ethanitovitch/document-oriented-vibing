This project is a VS Code extension called **document-oriented-vibing** (DOV). It lets you plan features as text-based Mermaid diagrams before coding them.

## How it works

- Features live as `.md` files in `.features/` at the workspace root.
- Each file has a `# Feature:` title, `## Diagram` with a mermaid block, and `## Summary`.
- Opening a feature from `DOV: Home` shows a Mermaid preview panel with zoom controls.
- The preview updates automatically when the file changes — by you, an LLM, or git.
- Nodes with file paths in labels (e.g. `src/auth/controller.ts`) are clickable — opens the file in VS Code.
- "Edit source" button opens the raw `.md` file in the text editor.
- The extension injects LLM instructions into the target project's `CLAUDE.md` and `AGENTS.md` so any LLM knows the format.

## Workflow modes

Users prefix their request with a mode keyword:

- **`+plan`** — Plan only. Create the `.features/*.md` diagram with placeholder file paths. Do NOT write source code. User reviews the diagram first.
- **`+show`** — Build and show. Write the actual source code, then create the `.features/*.md` diagram with real file paths pointing to the code just written.
- **`+review`** — After code edits are complete, open the DOV capture URI with the editor CLI.

Do not create `.features/*.md` or `.reviews/*.diff` unless the user explicitly uses one of these modes.
Do not create `.reviews/*.json` unless the user explicitly asks for a structured DOV review.

## +review workflow

For `+review`, use this lightweight workflow directly after all requested source edits are complete. `+review` builds the review from changes recorded in the current chat/session, so running it before editing code will miss the later changes.
Review capture only works when the selected/current Codex thread contains Codex-made code changes in this workspace. Run it at the end of the thread, after code changes and verification are complete.

Run `code --open-url "vscode://<installed-extension-id>/captureReview?name=<kebab-case-title>.diff&threadId=$CODEX_THREAD_ID"`, such as `code --open-url "vscode://<installed-extension-id>/captureReview?name=auth-review.diff&threadId=$CODEX_THREAD_ID"`.

This opens a VS Code URI and requires GUI access. If running in a sandbox, request outside-sandbox/escalated execution up front.
Do not treat exit code 0 alone as proof that the extension opened; Electron/macOS may print GUI handoff errors such as `task_name_for_pid` even when the CLI exits 0.
After running the URI command, verify `.reviews/<name>.diff` exists before saying the review opened. If verification fails or outside-sandbox execution is rejected, say the review could not be reliably opened.
The extension creates `.reviews/` if needed, writes `.reviews/<name>.diff`, and opens the DOV review panel.
Do not manually write `.reviews/*.diff` or run `git diff` unless the user explicitly asks.
Do not summarize the diff, write findings, or add metadata unless the user explicitly asks.
DOV saves approve/reject state itself in a sibling `.state.json` file as the user reviews hunks.

## Architecture

- `src/extension.ts` — VS Code extension host. Commands, panels, file CRUD, file watcher, openFile handler.
- `src/feature-graph/schema.ts` — Feature file template, LLM instructions text, schema doc. Contains workflow mode docs.
- `src/webview/home/` — React webview for the home screen (feature list, create, settings).
- `src/webview/feature/` — React webview for the Mermaid preview panel. Clickable nodes, zoom.
- `src/webview/review/` — React webview for raw diff review output, with optional structured JSON review support.
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

<!-- dov-start v20 -->
## Document Oriented Vibing

This project uses DOV feature diagrams.

When the user uses `+plan`, `+show`, `+review`, asks for a feature diagram or code review, or works with `.features/*.md`, `.reviews/*.diff`, or `.reviews/*.json`, use the `document-oriented-vibing` skill.
The repo-scoped skill is stored at `.agents/skills/document-oriented-vibing/SKILL.md`.

Do not create `.features/*.md` files unless the user explicitly uses `+plan` or `+show`.
Do not create `.reviews/*.diff` files unless the user explicitly uses `+review`.
Do not create `.reviews/*.json` files unless the user explicitly asks for a structured DOV review.

For `+review`, after all requested code edits are complete, run `code --open-url "vscode://ethanitovitch.document-oriented-vibing/captureReview?name=<kebab-case-title>.diff&threadId=$CODEX_THREAD_ID"`, such as `code --open-url "vscode://ethanitovitch.document-oriented-vibing/captureReview?name=auth-review.diff&threadId=$CODEX_THREAD_ID"`.
`+review` builds the review from changes recorded in the current chat/session, so running it before editing code will miss the later changes.
Review capture only works when the current Codex thread contains Codex-made code changes in this workspace. Run it at the end of the thread after the code changes and verification are complete.
This opens a VS Code URI and requires GUI access. If running in a sandbox, request outside-sandbox/escalated execution up front.
Do not treat exit code 0 alone as proof that the extension opened; Electron/macOS may print GUI handoff errors such as `task_name_for_pid` even when the CLI exits 0.
After running the URI command, verify `.reviews/<name>.diff` exists before saying the review opened. If verification fails or outside-sandbox execution is rejected, say the review could not be reliably opened.
The extension creates `.reviews/` if needed, writes the review diff, and opens DOV review.
Do not manually write `.reviews/*.diff` or run `git diff` unless the user explicitly asks.
Do not summarize the diff or write extra review metadata unless the user explicitly asks.
DOV saves approve/reject state itself in a sibling `.state.json` file as the user reviews hunks.
<!-- dov-end -->
