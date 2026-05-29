# Contributing

Thanks for helping improve Document Oriented Vibing. DOV is becoming a review-first VS Code extension, so contributions should make AI-written code easier to inspect, understand, approve, reject, or iterate on.

## Project Priorities

Prioritize changes that improve the review workflow:

- Better `.reviews/*.diff` capture and display.
- Clearer hunk-level approve, reject, undo, and status behavior.
- Better navigation from review hunks to source files.
- Safer review state persistence in `.reviews/*.state.json`.
- Better LLM context copying for follow-up prompts.
- Clearer setup for Codex and other coding agents.

Feature diagrams are still supported, but they are secondary to review quality.

## Development Setup

```bash
pnpm install
pnpm run compile
```

To develop interactively:

```bash
pnpm run watch
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Useful Commands

```bash
pnpm run check-types
pnpm run lint
pnpm run compile
pnpm run test
```

Run the narrowest relevant command while developing, then run `pnpm run compile` before opening a pull request. Run `pnpm run test` when changing extension activation, command behavior, review parsing, file IO, or anything with meaningful regression risk.

## Repo Structure

- `src/extension.ts` — extension host, commands, webviews, file watchers, review capture, review state, and LLM setup.
- `src/webview/review/` — review UI for raw diff and structured JSON review artifacts.
- `src/webview/home/` — home screen for features, reviews, Codex threads, and setup.
- `src/webview/feature/` — Mermaid feature preview UI.
- `src/webview/settings/` — settings webview.
- `src/feature-graph/schema.ts` — feature templates, DOV schema text, injected instructions, and repo-scoped skill content.
- `esbuild.js` — bundles extension and webview code.

## Coding Guidelines

- Keep review behavior predictable. A reviewer should always know whether a hunk is pending, approved, or rejected.
- Preserve user work. Do not delete or rewrite `.reviews/`, `.features/`, `AGENTS.md`, or `CLAUDE.md` content outside the managed DOV blocks.
- Keep webview messages explicit and small. Validate message shape in the extension host before acting.
- Prefer focused changes over broad refactors, especially in `src/extension.ts`.
- Match the existing TypeScript and React style before adding new abstractions.
- Avoid adding dependencies unless they clearly reduce risk or complexity.

## Review Workflow Expectations

When changing review behavior, manually verify the basic loop:

1. Make a small code change in a test workspace.
2. Run `DOV: Capture Codex Review` or trigger the `captureReview` URI.
3. Confirm a `.reviews/*.diff` file is created.
4. Open the review panel.
5. Approve, reject, and undo at least one hunk.
6. Confirm the sibling `.state.json` file reflects the expected statuses.
7. Confirm source-file navigation opens the correct file and line.

For UI changes, include screenshots or a short screen recording in the pull request when practical.

## Pull Requests

Include:

- What changed and why.
- How you tested it.
- Any known limitations or follow-up work.
- Screenshots for visible UI changes.

Keep pull requests focused. Separate review workflow changes, feature diagram changes, and documentation-only changes when possible.

## Documentation

Update `README.md` when user-facing behavior changes. Update `AGENTS.md`, `CLAUDE.md`, or generated DOV skill/schema text only when the agent workflow itself changes.

## Release Notes

For notable user-facing changes, add a concise entry to `CHANGELOG.md`.
