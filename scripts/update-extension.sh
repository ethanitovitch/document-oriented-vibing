#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for command in node pnpm vsce code; do
	if ! command -v "$command" >/dev/null 2>&1; then
		echo "Missing required command: $command" >&2
		exit 1
	fi
done

EXTENSION_NAME="$(node -p "require('./package.json').name")"
EXTENSION_VERSION="$(node -p "require('./package.json').version")"
VSIX_FILE="${EXTENSION_NAME}-${EXTENSION_VERSION}.vsix"

echo "Building ${EXTENSION_NAME}..."
pnpm run package

echo "Packaging ${VSIX_FILE}..."
vsce package --no-dependencies

echo "Installing ${VSIX_FILE} in VS Code..."
code --install-extension "$VSIX_FILE" --force

echo "Installed ${VSIX_FILE}. Reload VS Code to activate the update."
