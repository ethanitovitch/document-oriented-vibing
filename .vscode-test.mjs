import { defineConfig } from '@vscode/test-cli';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: [`--user-data-dir=${path.join(os.tmpdir(), 'dov-vscode-test-user-data')}`],
});
