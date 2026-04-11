import * as vscode from 'vscode';
import {
	createFeatureTemplate,
	getLlmInstructions,
	LLM_INSTRUCTIONS_START,
	DOV_BLOCK_REGEX,
	DOV_LEGACY_REGEX,
	DOV_SCHEMA_VERSION,
} from './feature-graph/schema';

const previewPanels = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext) {
	const homeDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.home',
		() => openHomePanel(context),
	);
	const newFeatureDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.newFeature',
		() => void createDefaultFeatureAndOpen(context),
	);
	const openFeatureDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.openFeature',
		(featureName?: string) => {
			if (typeof featureName === 'string' && featureName.trim()) {
				void openFeature(context, normalizeFeatureFileName(featureName.trim()));
			} else {
				void pickAndOpenFeature(context);
			}
		},
	);
	const settingsDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.settings',
		() => openSettingsPanel(context),
	);

	const featureWatcher = vscode.workspace.createFileSystemWatcher('**/.features/*.md');
	const autoOpen = (uri: vscode.Uri) => {
		const fileName = uri.fsPath.split(/[/\\]/).pop();
		if (fileName && !previewPanels.has(fileName)) {
			void openFeature(context, fileName);
		}
	};
	featureWatcher.onDidCreate(autoOpen);

	context.subscriptions.push(homeDisposable, newFeatureDisposable, openFeatureDisposable, settingsDisposable, featureWatcher);
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// Home panel
// ---------------------------------------------------------------------------

function openHomePanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'documentOrientedHome',
		'DOV: Home',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-webview')],
		},
	);

	panel.webview.html = getHomeWebviewHtml(panel.webview, context.extensionUri);

	panel.webview.onDidReceiveMessage((message: unknown) => {
		if (typeof message !== 'object' || message === null || !('action' in message)) {
			return;
		}
		const action = (message as { action?: unknown }).action;
		if (typeof action !== 'string') {
			return;
		}

		if (action === 'createFeaturesFolder') {
			void createFeaturesFolder(panel);
			return;
		}
		if (action === 'refreshFeatures') {
			void publishHomeState(panel, 'Refreshed.');
			return;
		}
		if (action === 'openNewFeature') {
			void createDefaultFeatureAndOpen(context, panel);
			return;
		}
		if (action === 'ready') {
			void publishHomeState(panel, 'Ready.');
			return;
		}
		if (action === 'openFeature') {
			const featureName = (message as { featureName?: unknown }).featureName;
			if (typeof featureName === 'string' && featureName.trim()) {
				void openFeature(context, featureName.trim(), panel);
			}
			return;
		}
		if (action === 'addLlmInstructions') {
			void addInstructionsToClaudeMd().then(() => {
				void publishHomeState(panel, 'Added feature-graph instructions to CLAUDE.md.');
			});
			return;
		}
		if (action === 'openSettings') {
			openSettingsPanel(context);
		}
	});
}

async function publishHomeState(panel: vscode.WebviewPanel, statusText: string): Promise<void> {
	const [features, featuresFolderExists, hasLlmInstructions] = await Promise.all([
		readFeatureNames(),
		checkFeaturesFolderExists(),
		checkClaudeMdHasInstructions(),
	]);
	void panel.webview.postMessage({
		action: 'homeState',
		statusText,
		features,
		featuresFolderExists,
		hasLlmInstructions,
	});
}

async function pickAndOpenFeature(context: vscode.ExtensionContext): Promise<void> {
	const features = await readFeatureNames();
	if (features.length === 0) {
		void vscode.window.showInformationMessage('No features found. Create one first via DOV: Home.');
		return;
	}
	const picked = await vscode.window.showQuickPick(features, { placeHolder: 'Select a feature to open' });
	if (picked) {
		void openFeature(context, picked);
	}
}

// ---------------------------------------------------------------------------
// Feature: diagram preview panel
// ---------------------------------------------------------------------------

async function openFeature(
	context: vscode.ExtensionContext,
	featureName: string,
	homePanel?: vscode.WebviewPanel,
): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage('Open a workspace folder first.');
		return;
	}

	const featureUri = vscode.Uri.joinPath(workspaceFolder.uri, '.features', featureName);
	try {
		await vscode.workspace.fs.stat(featureUri);
	} catch {
		void vscode.window.showErrorMessage(`Feature file not found: ${featureName}`);
		return;
	}

	openPreviewPanel(context, featureName, featureUri);

	if (homePanel) {
		void publishHomeState(homePanel, `Opened ${featureName}.`);
	}
}

function openPreviewPanel(
	context: vscode.ExtensionContext,
	featureName: string,
	featureUri: vscode.Uri,
): void {
	const existing = previewPanels.get(featureName);
	if (existing) {
		existing.reveal(vscode.ViewColumn.One);
		void readAndSend(existing, featureName, featureUri);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'documentOrientedFeaturePreview',
		featureName.replace(/\.md$/i, ''),
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-webview')],
		},
	);

	panel.webview.html = getFeatureWebviewHtml(panel.webview, context.extensionUri);
	previewPanels.set(featureName, panel);

	// Watch for file changes (LLM edits, manual edits, git, etc.)
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	let fileWatcher: vscode.FileSystemWatcher | undefined;
	if (workspaceFolder) {
		const pattern = new vscode.RelativePattern(workspaceFolder, `.features/${featureName}`);
		fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		const onFileChange = () => void readAndSend(panel, featureName, featureUri);
		fileWatcher.onDidChange(onFileChange);
		fileWatcher.onDidCreate(onFileChange);
	}

	panel.webview.onDidReceiveMessage((message: unknown) => {
		if (typeof message !== 'object' || message === null || !('action' in message)) {
			return;
		}
		const action = (message as { action?: unknown }).action;

		if (action === 'ready') {
			void readAndSend(panel, featureName, featureUri);
			return;
		}

		if (action === 'openFile') {
			const filePath = (message as { filePath?: unknown }).filePath;
			const line = (message as { line?: unknown }).line;
			if (typeof filePath === 'string' && filePath.trim() && workspaceFolder) {
				const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath.trim());
				void vscode.workspace.openTextDocument(fileUri).then(
					(doc) => {
						const options: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.Beside };
						if (typeof line === 'number' && line > 0) {
							const pos = new vscode.Position(line - 1, 0);
							options.selection = new vscode.Range(pos, pos);
						}
						void vscode.window.showTextDocument(doc, options);
					},
					() => void vscode.window.showWarningMessage(`File not found: ${filePath}`),
				);
			}
			return;
		}

		if (action === 'editSource') {
			void vscode.workspace.openTextDocument(featureUri).then(
				(doc) => void vscode.window.showTextDocument(doc, vscode.ViewColumn.One),
			);
		}
	});

	panel.onDidDispose(() => {
		previewPanels.delete(featureName);
		fileWatcher?.dispose();
	});
}

async function readAndSend(
	panel: vscode.WebviewPanel,
	featureName: string,
	featureUri: vscode.Uri,
): Promise<void> {
	try {
		const bytes = await vscode.workspace.fs.readFile(featureUri);
		const rawContent = Buffer.from(bytes).toString('utf8');
		void panel.webview.postMessage({ action: 'contentUpdate', featureName, rawContent });
	} catch {
		// File may have been deleted.
	}
}

// ---------------------------------------------------------------------------
// Feature file CRUD
// ---------------------------------------------------------------------------

async function createFeaturesFolder(panel: vscode.WebviewPanel): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage('Open a workspace folder first.');
		await publishHomeState(panel, 'No workspace folder is open.');
		return;
	}

	const featuresFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, '.features');
	await vscode.workspace.fs.createDirectory(featuresFolderUri);
	void vscode.window.showInformationMessage('Created .features at workspace root.');
	await publishHomeState(panel, 'Created .features at workspace root.');
}

async function createDefaultFeatureAndOpen(
	context: vscode.ExtensionContext,
	homePanel?: vscode.WebviewPanel,
): Promise<void> {
	const defaultName = await getNextDefaultFeatureName();
	const createdName = await createFeatureFile(defaultName);
	if (!createdName) {
		if (homePanel) {
			await publishHomeState(homePanel, 'Could not create feature.');
		}
		return;
	}

	await openFeature(context, createdName, homePanel);
}

async function createFeatureFile(featureName: string): Promise<string | null> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage('Open a workspace folder first.');
		return null;
	}

	const featuresFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, '.features');
	await vscode.workspace.fs.createDirectory(featuresFolderUri);

	const normalizedName = normalizeFeatureFileName(featureName);
	if (!normalizedName) {
		void vscode.window.showWarningMessage('Enter a valid feature name.');
		return null;
	}

	const featureUri = vscode.Uri.joinPath(featuresFolderUri, normalizedName);
	try {
		await vscode.workspace.fs.stat(featureUri);
		void vscode.window.showWarningMessage(`Feature already exists: ${normalizedName}`);
		return null;
	} catch {
		// Doesn't exist yet — good.
	}

	const content = createFeatureTemplate(normalizedName);
	await vscode.workspace.fs.writeFile(featureUri, Buffer.from(content, 'utf8'));
	return normalizedName;
}

function normalizeFeatureFileName(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9._-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^[-._]+|[-._]+$/g, '');

	if (!slug) {
		return '';
	}
	return slug.endsWith('.md') ? slug : `${slug}.md`;
}

async function getNextDefaultFeatureName(): Promise<string> {
	const existing = new Set(await readFeatureNames());
	const base = 'new-feature';
	let index = 1;
	let candidate = `${base}.md`;

	while (existing.has(candidate)) {
		index += 1;
		candidate = `${base}-${index}.md`;
	}
	return candidate;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkFeaturesFolderExists(): Promise<boolean> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return false;
	}
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, '.features');
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type === vscode.FileType.Directory;
	} catch {
		return false;
	}
}

async function readFeatureNames(): Promise<string[]> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return [];
	}
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, '.features');
	try {
		const entries = await vscode.workspace.fs.readDirectory(uri);
		return entries
			.filter(([, type]) => type === vscode.FileType.File)
			.map(([name]) => name)
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

async function checkClaudeMdHasInstructions(): Promise<boolean> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return false;
	}
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'CLAUDE.md');
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const content = Buffer.from(bytes).toString('utf8');
		return content.includes(`<!-- dov-start v${DOV_SCHEMA_VERSION} -->`);
	} catch {
		return false;
	}
}

async function addInstructionsToClaudeMd(): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, 'CLAUDE.md');
	let existing = '';
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		existing = Buffer.from(bytes).toString('utf8');
	} catch {
		// File doesn't exist yet.
	}

	if (existing.includes(LLM_INSTRUCTIONS_START)) {
		return;
	}

	// Strip any old versioned blocks (v1, v2, …) or legacy markers
	let cleaned = existing;
	cleaned = cleaned.replace(DOV_BLOCK_REGEX, '');
	cleaned = cleaned.replace(DOV_LEGACY_REGEX, '');

	const updated = cleaned.trimEnd() + '\n' + getLlmInstructions();
	await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function openSettingsPanel(context: vscode.ExtensionContext): void {
	const panel = vscode.window.createWebviewPanel(
		'documentOrientedSettings',
		'DOV: Settings',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-webview')],
		},
	);

	panel.webview.html = getSettingsWebviewHtml(panel.webview, context.extensionUri);
	panel.webview.onDidReceiveMessage((message: unknown) => {
		if (typeof message !== 'object' || message === null || !('action' in message)) {
			return;
		}
		const action = (message as { action?: unknown }).action;
		if (action === 'ready') {
			void panel.webview.postMessage({
				action: 'settingsState',
				statusText: 'Ready.',
				workspaceStoragePath: context.storageUri?.fsPath ?? 'No workspace storage URI (open a folder workspace).',
				globalStoragePath: context.globalStorageUri.fsPath,
			});
			return;
		}
		if (action === 'openHome') {
			panel.dispose();
			openHomePanel(context);
		}
	});
}

// ---------------------------------------------------------------------------
// Webview HTML generators
// ---------------------------------------------------------------------------

function getHomeWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'home.js'));
	const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Home</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getFeatureWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const purifyUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'purify.min.js'));
	const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'mermaid.min.js'));
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'feature.js'));
	const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:; worker-src blob:;">
	<title>Feature Preview</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${purifyUri}"></script>
	<script nonce="${nonce}" src="${mermaidUri}"></script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getSettingsWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'settings.js'));
	const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Settings</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}
