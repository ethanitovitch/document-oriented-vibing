# Security Policy

## Supported Versions

DOV is currently pre-1.0. Security fixes are made on the latest mainline version only.

| Version | Supported |
|---------|-----------|
| `0.0.x` | Yes |

## Reporting a Vulnerability

Please do not open a public issue for a security vulnerability.

Report security issues privately by emailing the maintainer or using GitHub's private vulnerability reporting if it is enabled for this repository.

Include:

- A clear description of the issue.
- Steps to reproduce.
- The affected version or commit.
- Any relevant workspace setup, operating system, and VS Code version.
- Impact and suggested remediation, if known.

The maintainer will acknowledge the report when possible, investigate, and coordinate a fix before public disclosure.

## Security Scope

DOV is a VS Code extension that can read and write files in the active workspace. Security-sensitive areas include:

- Review capture from Codex session data.
- `.reviews/*.diff` and `.reviews/*.state.json` parsing and updates.
- `.features/*.md` parsing and preview rendering.
- Webview message handling between browser UI and the extension host.
- URI handling through `vscode://.../captureReview`.
- Managed updates to `AGENTS.md`, `CLAUDE.md`, and `.agents/`.

## Security Expectations

Contributions should preserve these rules:

- Treat all workspace files, review files, feature files, and webview messages as untrusted input.
- Validate webview messages in `src/extension.ts` before reading or writing files.
- Keep file operations scoped to the active workspace unless the user explicitly chooses otherwise.
- Do not execute code from `.features/`, `.reviews/`, `AGENTS.md`, `CLAUDE.md`, or Codex session files.
- Do not expose absolute local paths, review contents, or source snippets outside the editor without explicit user action.
- Keep webview content security policy restrictions in place.

## Dependency Security

Use `pnpm-lock.yaml` for reproducible installs. When adding or updating dependencies, prefer small, well-maintained packages and explain why the dependency is needed in the pull request.
