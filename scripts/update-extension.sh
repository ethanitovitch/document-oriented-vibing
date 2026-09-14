#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for command in node pnpm vsce; do
	if ! command -v "$command" >/dev/null 2>&1; then
		echo "Missing required command: $command" >&2
		exit 1
	fi
done

# Cursor can take over the `code` symlink on macOS. Prefer VS Code itself.
DOV_EDITOR_CLI="${DOV_CODE_CLI:-}"
if [[ -z "$DOV_EDITOR_CLI" && -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]]; then
	DOV_EDITOR_CLI="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
fi
if [[ -z "$DOV_EDITOR_CLI" ]]; then
	DOV_EDITOR_CLI="$(command -v code || true)"
fi
if [[ -z "$DOV_EDITOR_CLI" || ! -x "$DOV_EDITOR_CLI" ]]; then
	echo "VS Code CLI not found. Set DOV_CODE_CLI to its executable path." >&2
	exit 1
fi

EXTENSION_NAME="$(node -p "require('./package.json').name")"
EXTENSION_VERSION="$(node -p "require('./package.json').version")"
VSIX_FILE="${EXTENSION_NAME}-${EXTENSION_VERSION}.vsix"

echo "Building ${EXTENSION_NAME}..."
pnpm run package

echo "Packaging ${VSIX_FILE}..."
vsce package --no-dependencies

echo "Installing ${VSIX_FILE} using ${DOV_EDITOR_CLI}..."
"$DOV_EDITOR_CLI" --install-extension "$VSIX_FILE" --force

echo "Installed ${VSIX_FILE}. Reload VS Code to activate the update."
