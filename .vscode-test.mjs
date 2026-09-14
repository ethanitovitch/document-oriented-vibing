import { defineConfig } from '@vscode/test-cli';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
	useInstallation: process.env.DOV_VSCODE_EXECUTABLE
		? { fromPath: process.env.DOV_VSCODE_EXECUTABLE }
		: undefined,
	files: 'out/test/**/*.test.js',
	launchArgs: [`--user-data-dir=${path.join(os.tmpdir(), 'dov-vscode-test-user-data')}`],
});
