This project is a VS Code extension called **document-oriented-vibing** (DOV). It lets you plan features as text-based Mermaid diagrams before coding them.

## How it works

- Features live as `.md` files in `.features/` at the workspace root.
- Each file has a `# Feature:` title, `## Diagram` with a mermaid block, and `## Summary`.
- Opening a feature from `DOV: Home` shows a Mermaid preview panel with zoom controls.
- The preview updates automatically when the file changes — by you, an LLM, or git.
- Nodes with file paths in labels (e.g. `src/auth/controller.ts`) are clickable — opens the file in VS Code.
- "Edit source" button opens the raw `.md` file in the text editor.
- Reviews live as raw `.diff` files in `.reviews/` at the workspace root.
- Opening a review shows the captured git diff in a webview.
- The extension injects LLM instructions into the target project's `CLAUDE.md`, adds a small Codex `AGENTS.md` pointer, and installs a repo-scoped DOV skill under `.agents/skills/`.

## Workflow modes

Users prefix their request with a mode keyword:

- **`+plan`** — Plan only. Create the `.features/*.md` diagram with placeholder file paths. Do NOT write source code. User reviews the diagram first.
- **`+show`** — Build and show. Write the actual source code, then create the `.features/*.md` diagram with real file paths pointing to the code just written.
- **`+review`** — Open the DOV capture URI with the editor CLI.

Do not create `.features/*.md` or `.reviews/*.diff` unless the user explicitly uses one of these modes.
Do not create `.reviews/*.json` unless the user explicitly asks for a structured DOV review.

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
## Feature Diagrams (document-oriented-vibing)

This project uses a VS Code extension to plan features as diagrams.
Features are `.md` files in `.features/` at the workspace root.
The extension auto-opens the diagram when a new file is created.

Reviews are raw `.diff` files in `.reviews/` at the workspace root.
The extension auto-opens diagrams and reviews when new files are created.

**IMPORTANT: Only create `.features/*.md` files when the user says `+plan` or `+show`.**
Only create `.reviews/*.diff` files when the user says `+review`.
If none of those modes are specified, do NOT create a feature or review file.

### Modes

- **`+plan`** — Diagram only. Placeholder file paths. No source code.
- **`+show`** — Write code first, then diagram with real paths.
- **`+review`** — After code edits are complete, open the DOV capture URI with the editor CLI.

### File format

Use the compact DOV diagram syntax (NOT mermaid). The extension translates it automatically.

```
# Feature: <title>

## Diagram

```dov
<DOV diagram>
```

## Summary
<intent, constraints, behavior>

## Details
- **NodeName**: hover tooltip text
```

### Review file format

When the user says `+review`, open the DOV capture URI only after all requested code edits are complete.
`+review` builds the review from changes recorded in the current chat/session, so running it before editing code will miss the later changes.
Review capture only works for a Codex thread that contains Codex-made code changes in this workspace. It should be the final step at the end of the thread, after code changes and verification.

Run `code --open-url "vscode://ethanitovitch.document-oriented-vibing/captureReview?name=<kebab-case-title>.diff&threadId=$CODEX_THREAD_ID"`.
This opens a VS Code URI and requires GUI access. If running in a sandbox, request outside-sandbox/escalated execution up front.
Do not treat exit code 0 alone as proof that the extension opened; Electron/macOS may print GUI handoff errors such as `task_name_for_pid` even when the CLI exits 0.
After running the URI command, verify `.reviews/<name>.diff` exists before saying the review opened.

The extension creates `.reviews/` if needed, writes `.reviews/<name>.diff`, and opens the DOV review panel.
Do not write review summaries, JSON, findings, status fields, or other metadata unless the user explicitly asks for a structured review.

### DOV syntax

Header: `flow LR` (or TD/RL/BT). Also: `seq`, `class`, `state`, `er`.

Nodes (defined inline on first use):
- `Name[Label|path/to/file.ts:line]` — rectangle
- `Name{Label|path/to/file.ts}` — diamond (decision)
- `Name(Label)` — rounded/stadium
- `Name:Label text` — plain rounded

`|` separates label lines. Include file paths to make nodes clickable.
Append `:lineNumber` to jump to a specific line.

**CRITICAL: File paths MUST be the full relative path from the workspace root.**
Use `src/auth/controller.ts`, NOT `controller.ts` or `auth/controller.ts`.
The extension resolves paths from the workspace root — partial paths will not open.

Edges:
- `A >label> B` — edge with label
- `A > B` — edge without label

Sequence diagrams:
- `A ->label-> B` — solid arrow
- `A --label--> B` — dashed arrow

### Example

```
# Feature: user login

## Diagram

```dov
flow LR
Client(Browser) >POST /login> Auth[AuthController|src/auth/controller.ts:15]
Auth >credentials> Validate{validateCredentials|src/auth/validate.ts:8}
Validate >valid user> Token[issueJWT|src/auth/token.ts:22]
Validate >invalid> Err:401 Unauthorized
Token >JWT string> Auth
Auth >audit event> Log[logAttempt|src/auth/audit.ts:5]
```

## Summary
Authenticate with email/password, return a JWT, and log the attempt.

## Details
- **Auth**: Express POST handler, validates body, delegates to services.
- **Validate**: bcrypt comparison, returns User or null.
- **Token**: Signs RS256 token, 24h expiry, userId + role claims.
- **Log**: Writes to audit_log for success and failure.
```

<!-- dov-end -->
