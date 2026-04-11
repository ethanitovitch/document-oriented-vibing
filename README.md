# Document Oriented Vibing (DOV)

A VS Code extension that lets you plan features as Mermaid diagrams before writing code. Tell your AI assistant what to build, see the architecture as a live diagram, iterate on it, then generate the code.

Stop vibing blindly. See what you're building first.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)
![Mermaid](https://img.shields.io/badge/Diagrams-Mermaid-ff69b4)

## Why?

When you vibe-code with an LLM, you have no idea what it's actually building. DOV fixes that:

1. Tell your LLM `+plan auth system` — it creates a Mermaid diagram of the planned architecture. No code yet.
2. Review the diagram — see every component, file path, and data flow. Iterate until you're happy.
3. Tell your LLM `+show auth system` — it builds the feature, then shows you the diagram with real file paths.
4. Click any node to jump to the code. Hover for details.

## Install

```bash
# Clone and build
git clone https://github.com/ethanitovitch/document-oriented-vibing.git
cd document-oriented-vibing
pnpm install
node esbuild.js

# Package as .vsix
pnpm add -g @vscode/vsce
vsce package --no-dependencies

# Install in VS Code / Cursor
code --install-extension document-oriented-vibing-*.vsix
```

## Quick Start

1. Open any project in VS Code / Cursor
2. Run `DOV: Home` from the command palette (`Ctrl/Cmd+Shift+P`)
3. Create a new feature — this creates a `.features/` folder with a `.md` file
4. Edit the markdown file with a Mermaid diagram, or let your LLM do it

The extension automatically injects instructions into your project's `CLAUDE.md` so your LLM knows the format.

## Workflow Modes

Prefix your prompt to the LLM with a mode:

| Mode | What happens |
|------|-------------|
| `+plan` | LLM creates the diagram with placeholder file paths. No code written. Review and iterate first. |
| `+show` | LLM writes the actual code, then creates the diagram with real file paths. |

Default is `+plan` if you don't specify.

### Example

```
+plan user authentication with JWT and rate limiting
```

The LLM creates `.features/user-auth.md` and opens the diagram:

```mermaid
flowchart LR
    Client([Browser]) -->|POST /login| Auth["AuthController\nsrc/auth/controller.ts"]
    Auth -->|credentials| Validate{"validateCredentials\nsrc/auth/validate.ts"}
    Validate -->|valid| Token["issueJWT\nsrc/auth/token.ts"]
    Validate -->|invalid| Err([401 Unauthorized])
    Token -->|JWT| Auth
    Auth -->|audit event| Log["logAttempt\nsrc/auth/audit.ts"]
```

## Feature File Format

Features live as `.md` files in `.features/` at your project root:

```markdown
# Feature: user login

## Diagram

` ` `mermaid
flowchart LR
    Client([Browser]) -->|POST /login| Auth["AuthController\nsrc/auth/controller.ts:15"]
    Auth --> Validate{"validateCredentials\nsrc/auth/validate.ts:8"}
` ` `

## Summary
Authenticate with email/password, return a JWT.

## Details
- **AuthController**: Express route handler, validates request body.
- **validateCredentials**: bcrypt comparison against users table.
```

## Features

- **Live preview** — diagram updates as the file changes (by you, LLM, or git)
- **Clickable nodes** — file paths in node labels open that file in VS Code
- **Line numbers** — append `:42` to a path to jump to a specific line
- **Hover tooltips** — `## Details` section adds per-node descriptions on hover
- **Scroll to zoom** — Ctrl/Cmd + scroll to zoom in/out on the diagram
- **Any Mermaid diagram** — flowchart, sequence, class, state, ER, journey, gantt
- **LLM-native** — auto-injects instructions into `CLAUDE.md` so your LLM knows the format
- **Auto-open** — LLMs can run a command to open the diagram after generating it

## Commands

| Command | Description |
|---------|-------------|
| `DOV: Home` | Open the home screen with all features |
| `DOV: Quick New Feature` | Create a new feature file |
| `DOV: Open Feature` | Open a specific feature diagram |

## How It Works Under the Hood

```
.features/
├── schema.md          # Auto-generated format reference
├── user-login.md      # Your feature diagrams
└── order-pipeline.md
```

The extension watches `.features/*.md` for changes and renders them as interactive Mermaid diagrams in a webview panel. Node labels containing file paths become clickable links. The `## Details` section maps node names to hover tooltips.

When activated, DOV checks your `CLAUDE.md` for its instruction block (versioned with start/end markers) and adds or updates it automatically.

## Contributing

```bash
pnpm install
node esbuild.js

# Press F5 in VS Code to launch the Extension Development Host
```

## License

MIT
