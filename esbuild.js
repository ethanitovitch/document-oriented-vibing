const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

function copyWebviewVendorScripts() {
	const files = [
		{
			label: 'mermaid',
			src: path.join(__dirname, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
			dest: path.join(__dirname, 'dist-webview', 'mermaid.min.js'),
		},
		{
			label: 'dompurify',
			src: path.join(__dirname, 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
			dest: path.join(__dirname, 'dist-webview', 'purify.min.js'),
		},
	];

	for (const file of files) {
		try {
			fs.mkdirSync(path.dirname(file.dest), { recursive: true });
			fs.copyFileSync(file.src, file.dest);
			console.log(`[${file.label}] Copied ${path.basename(file.dest)} to dist-webview/`);
		} catch (e) {
			console.error(`[${file.label}] Failed to copy ${path.basename(file.dest)}:`, e.message);
		}
	}
}

async function main() {
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	const webviewCtx = await esbuild.context({
		entryPoints: {
			'home': 'src/webview/home/main.jsx',
			'feature': 'src/webview/feature/main.jsx',
			'review': 'src/webview/review/main.jsx',
			'settings': 'src/webview/settings/main.jsx',
		},
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outdir: 'dist-webview',
		entryNames: '[name]',
		logLevel: 'silent',
		loader: {
			'.js': 'jsx',
			'.jsx': 'jsx',
			'.css': 'css',
		},
	});

	if (watch) {
		copyWebviewVendorScripts();
		await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
	} else {
		await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
		copyWebviewVendorScripts();
		await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
