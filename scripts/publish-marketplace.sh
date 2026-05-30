#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for command in node pnpm; do
	if ! command -v "$command" >/dev/null 2>&1; then
		echo "Missing required command: $command" >&2
		exit 1
	fi
done

PUBLISHER="$(node -p "require('./package.json').publisher")"
CURRENT_VERSION="$(node -p "require('./package.json').version")"

if [[ -z "$PUBLISHER" ]]; then
	echo "package.json is missing a publisher." >&2
	exit 1
fi

echo "Publishing VS Code extension for publisher: ${PUBLISHER}"
echo "Current version: ${CURRENT_VERSION}"

pnpm version patch --no-git-tag-version

NEXT_VERSION="$(node -p "require('./package.json').version")"
echo "Next version: ${NEXT_VERSION}"

pnpm install --config.confirm-modules-purge=false
pnpm run package
pnpm dlx @vscode/vsce publish --no-dependencies

echo "Published ${PUBLISHER}.$(node -p "require('./package.json').name")@${NEXT_VERSION}."
