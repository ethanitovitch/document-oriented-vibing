import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import {
	createFeatureTemplate,
	getCodexAgentsInstructions,
	getDovSkillInstructions,
	getDovSkillOpenaiYaml,
	getLlmInstructions,
	getReviewSchemaDocument,
	getSchemaDocument,
	DOV_SKILL_VERSION_MARKER,
	type DovInstructionOptions,
	DOV_BLOCK_REGEX,
	DOV_LEGACY_REGEX,
	DOV_SCHEMA_VERSION,
} from './feature-graph/schema';

const previewPanels = new Map<string, vscode.WebviewPanel>();
const reviewPanels = new Map<string, vscode.WebviewPanel>();
const CLAUDE_INSTRUCTION_FILE_NAME = 'CLAUDE.md';
const CODEX_INSTRUCTION_FILE_NAME = 'AGENTS.md';
const DOV_SKILL_NAME = 'document-oriented-vibing';
const execFileAsync = promisify(execFile);

type ReviewStatus = 'pending' | 'approved' | 'rejected';

interface DiffReviewChange {
	id: string;
	filePath: string;
	title: string;
	startLine: number;
	endLine: number;
	oldLines: string[];
	newLines: string[];
	status: ReviewStatus;
}

interface DiffReviewFile {
	path: string;
	changes: DiffReviewChange[];
}

interface DiffReviewState {
	version: number;
	reviewName: string;
	updatedAt: string;
	changes: Record<string, ReviewStatus>;
}

interface ReviewChange {
	id?: string;
	title?: string;
	message?: string;
	severity?: string;
	startLine?: number;
	endLine?: number;
	replacement?: string;
	status?: ReviewStatus;
}

interface ReviewFile {
	path?: string;
	summary?: string;
	changes?: ReviewChange[];
}

interface ReviewDocument {
	version?: number;
	title?: string;
	summary?: string;
	files?: ReviewFile[];
}

interface CodexSessionRecord {
	timestamp?: string;
	type?: string;
	payload?: {
		type?: string;
		role?: string;
		name?: string;
		input?: string;
	};
}

interface CaptureReviewOptions {
	reviewName?: string;
	threadId?: string;
}

interface FeatureListItem {
	name: string;
	createdAt: number;
	updatedAt: number;
	ageLabel: string;
}

interface ReviewListItem {
	name: string;
	updatedAt: number;
	ageLabel: string;
}

interface CodexThreadListItem {
	id: string;
	title: string;
	updatedAt: number;
	ageLabel: string;
	changeCount: number;
}

interface CodexPatchHunk {
	filePath: string;
	oldLines: string[];
	newLines: string[];
}

let pendingReviewDecorationType: vscode.TextEditorDecorationType | undefined;
let approvedReviewDecorationType: vscode.TextEditorDecorationType | undefined;
let rejectedReviewDecorationType: vscode.TextEditorDecorationType | undefined;
let activeDiffReview: {
	reviewName: string;
	reviewUri: vscode.Uri;
	files: DiffReviewFile[];
} | undefined;
let reviewCodeLensProvider: ReviewCodeLensProvider | undefined;
let reviewBaseContentProvider: DiffReviewBaseContentProvider | undefined;

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
	const reviewDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.review',
		(reviewName?: string) => {
			if (typeof reviewName === 'string' && reviewName.trim()) {
				void openReview(context, normalizeReviewFileName(reviewName.trim()));
			} else {
				void openLatestReview(context);
			}
		},
	);
	const captureReviewDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.captureReview',
		(options?: string | CaptureReviewOptions) => void captureCodexReview(context, normalizeCaptureReviewOptions(options)),
	);
	const uriHandlerDisposable = vscode.window.registerUriHandler({
		handleUri: (uri) => void handleDovUri(context, uri),
	});
	const noopDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.noop',
		() => undefined,
	);
	const approveDiffChangeDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.approveDiffChange',
		(changeId: string) => void setActiveDiffChangeStatus(changeId, 'approved'),
	);
	const rejectDiffChangeDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.rejectDiffChange',
		(changeId: string) => void setActiveDiffChangeStatus(changeId, 'rejected'),
	);
	const approveDiffFileDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.approveDiffFile',
		(filePath: string) => void setActiveDiffFileStatuses(filePath, 'approved'),
	);
	const rejectDiffFileDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.rejectDiffFile',
		(filePath: string) => void setActiveDiffFileStatuses(filePath, 'rejected'),
	);
	const undoDiffFileDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.undoDiffFile',
		(filePath: string) => void setActiveDiffFileStatuses(filePath, 'pending'),
	);
	const openDiffReviewFileDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.openDiffReviewFile',
		(filePath: string) => void openDiffReviewForFile(filePath),
	);
	const approveAllDiffChangesDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.approveAllDiffChanges',
		() => void setAllActiveDiffChangeStatuses('approved'),
	);
	const rejectAllDiffChangesDisposable = vscode.commands.registerCommand(
		'document-oriented-vibing.rejectAllDiffChanges',
		() => void setAllActiveDiffChangeStatuses('rejected'),
	);
	reviewCodeLensProvider = new ReviewCodeLensProvider();
	reviewBaseContentProvider = new DiffReviewBaseContentProvider();
	const reviewCodeLensDisposable = vscode.languages.registerCodeLensProvider({ scheme: 'file' }, reviewCodeLensProvider);
	const reviewBaseContentDisposable = vscode.workspace.registerTextDocumentContentProvider('dov-review-base', reviewBaseContentProvider);
	const visibleEditorsDisposable = vscode.window.onDidChangeVisibleTextEditors(() => refreshReviewDecorations());

	pendingReviewDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});
	approvedReviewDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});
	rejectedReviewDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});

	const featureWatcher = vscode.workspace.createFileSystemWatcher('**/.features/*.md');
	const autoOpen = (uri: vscode.Uri) => {
		const fileName = uri.fsPath.split(/[/\\]/).pop();
		if (fileName && !previewPanels.has(fileName)) {
			void openFeature(context, fileName);
		}
	};
	featureWatcher.onDidCreate(autoOpen);
	const reviewWatcher = vscode.workspace.createFileSystemWatcher('**/.reviews/*.{diff,json}');
	const autoOpenReview = (uri: vscode.Uri) => {
		const fileName = uri.fsPath.split(/[/\\]/).pop();
		if (fileName && !fileName.endsWith('.state.json') && !reviewPanels.has(fileName)) {
			void openReview(context, fileName);
		}
	};
	reviewWatcher.onDidCreate(autoOpenReview);

	context.subscriptions.push(
		homeDisposable,
		newFeatureDisposable,
		openFeatureDisposable,
		settingsDisposable,
		reviewDisposable,
		captureReviewDisposable,
		uriHandlerDisposable,
		noopDisposable,
		approveDiffChangeDisposable,
		rejectDiffChangeDisposable,
		approveDiffFileDisposable,
		rejectDiffFileDisposable,
		undoDiffFileDisposable,
		openDiffReviewFileDisposable,
		approveAllDiffChangesDisposable,
		rejectAllDiffChangesDisposable,
		reviewCodeLensDisposable,
		reviewBaseContentDisposable,
		visibleEditorsDisposable,
		featureWatcher,
		reviewWatcher,
		pendingReviewDecorationType,
		approvedReviewDecorationType,
		rejectedReviewDecorationType,
	);
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
		if (action === 'removeOldReviews') {
			void removeOldReviews(panel);
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
		if (action === 'openReview') {
			const reviewName = (message as { reviewName?: unknown }).reviewName;
			if (typeof reviewName === 'string' && reviewName.trim()) {
				void openReview(context, reviewName.trim());
				void publishHomeState(panel, `Opened ${reviewName.trim()}.`);
			}
			return;
		}
		if (action === 'captureReviewFromThread') {
			const threadId = (message as { threadId?: unknown }).threadId;
			if (typeof threadId === 'string' && threadId.trim()) {
				void captureCodexReview(context, { threadId: threadId.trim() }).then(() => {
					void publishHomeState(panel, 'Updated Codex thread reviews.');
				});
			}
			return;
		}
		if (action === 'addLlmInstructions') {
			void addLlmInstructionsAndCodexSkill(context).then(() => {
				void publishHomeState(panel, 'Added feature-graph instructions to CLAUDE.md and Codex skill.');
			});
			return;
		}
		if (action === 'openSettings') {
			openSettingsPanel(context);
		}
	});
}

async function publishHomeState(panel: vscode.WebviewPanel, statusText: string): Promise<void> {
	const [features, reviews, codexThreads, featuresFolderExists, hasLlmInstructions, reviewCount] = await Promise.all([
		readFeatureEntries(),
		readReviewEntries(),
		readCodexThreadEntries(),
		checkFeaturesFolderExists(),
		checkLlmFilesHaveInstructions(),
		readReviewArtifactCount(),
	]);
	void panel.webview.postMessage({
		action: 'homeState',
		statusText,
		features,
		reviews,
		codexThreads,
		featuresFolderExists,
		hasLlmInstructions,
		reviewCount,
	});
}

async function pickAndOpenFeature(context: vscode.ExtensionContext): Promise<void> {
	const featureEntries = await readFeatureEntries();
	if (featureEntries.length === 0) {
		void vscode.window.showInformationMessage('No features found. Create one first via DOV: Home.');
		return;
	}
	const picked = await vscode.window.showQuickPick(
		featureEntries.map((feature) => ({
			label: feature.name,
			description: feature.ageLabel,
		})),
		{ placeHolder: 'Select a feature to open' },
	);
	if (picked) {
		void openFeature(context, picked.label);
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
// Review panel
// ---------------------------------------------------------------------------

async function openLatestReview(context: vscode.ExtensionContext): Promise<void> {
	const reviews = await readReviewNames();
	if (reviews.length === 0) {
		void vscode.window.showInformationMessage('No reviews found. Ask Codex for +review first.');
		return;
	}
	await openReview(context, reviews[0]);
}

async function handleDovUri(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
	const action = uri.path.replace(/^\/+/, '');
	if (action !== 'captureReview') {
		void vscode.window.showWarningMessage(`Unknown DOV action: ${action || uri.toString()}`);
		return;
	}

	const params = new URLSearchParams(uri.query);
	await captureCodexReview(context, {
		reviewName: params.get('name') ?? params.get('reviewName') ?? undefined,
		threadId: params.get('threadId') ?? undefined,
	});
}

async function captureCodexReview(context: vscode.ExtensionContext, options: CaptureReviewOptions = {}): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage('Open a workspace folder first.');
		return;
	}

	const { reviewName, threadId } = options;
	const normalizedReviewName = normalizeReviewFileName(reviewName?.trim() || getDefaultReviewName());
	if (!normalizedReviewName || normalizedReviewName.toLowerCase().endsWith('.json')) {
		void vscode.window.showWarningMessage('Enter a valid .diff review name.');
		return;
	}

	try {
		const patchHunks = await readCodexPatchHunksForReview(workspaceFolder.uri.fsPath, threadId);
		if (patchHunks.length === 0) {
			void vscode.window.showErrorMessage('No Codex-written changes found for this review.');
			return;
		}

		const diff = await buildCodexThreadDiff(workspaceFolder.uri, patchHunks);
		const reviewsFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, '.reviews');
		await vscode.workspace.fs.createDirectory(reviewsFolderUri);

		const reviewUri = vscode.Uri.joinPath(reviewsFolderUri, normalizedReviewName);
		await vscode.workspace.fs.writeFile(reviewUri, Buffer.from(diff, 'utf8'));
		openReviewPanel(context, normalizedReviewName, reviewUri);

		const fileCount = new Set(patchHunks.map((hunk) => hunk.filePath)).size;
		void vscode.window.showInformationMessage(`Captured ${fileCount} Codex-written file${fileCount === 1 ? '' : 's'} in ${normalizedReviewName}.`);
	} catch (error) {
		void vscode.window.showErrorMessage(`Could not capture DOV review: ${getErrorMessage(error)}`);
	}
}

function normalizeCaptureReviewOptions(options?: string | CaptureReviewOptions): CaptureReviewOptions {
	if (typeof options === 'string') {
		return { reviewName: options };
	}
	if (options && typeof options === 'object') {
		return {
			reviewName: typeof options.reviewName === 'string' ? options.reviewName : undefined,
			threadId: typeof options.threadId === 'string' ? options.threadId : undefined,
		};
	}
	return {};
}

async function openReview(context: vscode.ExtensionContext, reviewName: string): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage('Open a workspace folder first.');
		return;
	}

	const reviewUri = vscode.Uri.joinPath(workspaceFolder.uri, '.reviews', reviewName);
	try {
		await vscode.workspace.fs.stat(reviewUri);
	} catch {
		void vscode.window.showErrorMessage(`Review file not found: ${reviewName}`);
		return;
	}

	openReviewPanel(context, reviewName, reviewUri);
}

function openReviewPanel(
	context: vscode.ExtensionContext,
	reviewName: string,
	reviewUri: vscode.Uri,
): void {
	const existing = reviewPanels.get(reviewName);
	if (existing) {
		existing.reveal(vscode.ViewColumn.One);
		void readReviewAndSend(existing, reviewName, reviewUri);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'documentOrientedReview',
		reviewName.replace(/\.(diff|json)$/i, ''),
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-webview')],
		},
	);

	panel.webview.html = getReviewWebviewHtml(panel.webview, context.extensionUri);
	reviewPanels.set(reviewName, panel);

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	let fileWatcher: vscode.FileSystemWatcher | undefined;
	if (workspaceFolder) {
		const pattern = new vscode.RelativePattern(workspaceFolder, `.reviews/${reviewName}`);
		fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		const onFileChange = () => void readReviewAndSend(panel, reviewName, reviewUri);
		fileWatcher.onDidChange(onFileChange);
		fileWatcher.onDidCreate(onFileChange);
	}

	panel.webview.onDidReceiveMessage((message: unknown) => {
		if (typeof message !== 'object' || message === null || !('action' in message)) {
			return;
		}
		const action = (message as { action?: unknown }).action;

		if (action === 'ready') {
			void readReviewAndSend(panel, reviewName, reviewUri);
			return;
		}

		if (action === 'completeReview') {
			void completeReview(reviewName, reviewUri, panel);
			return;
		}

		if (action === 'copyText') {
			const text = (message as { text?: unknown }).text;
			if (typeof text === 'string') {
				void vscode.env.clipboard.writeText(text);
			}
			return;
		}

		if (action === 'openFile' || action === 'selectChange') {
			const filePath = (message as { filePath?: unknown }).filePath;
			const changeId = (message as { changeId?: unknown }).changeId;
			if (typeof filePath === 'string' && workspaceFolder) {
				void focusReviewFile(reviewUri, filePath, typeof changeId === 'string' ? changeId : undefined);
			}
			return;
		}

		if (action === 'approveChange' || action === 'rejectChange' || action === 'undoChange') {
			if (reviewName.toLowerCase().endsWith('.diff')) {
				const changeId = (message as { changeId?: unknown }).changeId;
				if (typeof changeId === 'string') {
					const status: ReviewStatus = action === 'approveChange'
						? 'approved'
						: action === 'rejectChange'
							? 'rejected'
							: 'pending';
					void setActiveDiffChangeStatus(changeId, status).then(() => {
						void readReviewAndSend(panel, reviewName, reviewUri);
					});
				}
				return;
			}
			const filePath = (message as { filePath?: unknown }).filePath;
			const changeId = (message as { changeId?: unknown }).changeId;
			if (typeof filePath === 'string' && typeof changeId === 'string' && workspaceFolder) {
				const status: ReviewStatus = action === 'approveChange'
					? 'approved'
					: action === 'rejectChange'
						? 'rejected'
						: 'pending';
				void updateReviewChangeStatus(reviewUri, filePath, changeId, status).then(() => {
					void readReviewAndSend(panel, reviewName, reviewUri);
				});
			}
			return;
		}

		if (action === 'approveFile' || action === 'rejectFile' || action === 'undoFile' || action === 'approveAll' || action === 'rejectAll' || action === 'undoAll') {
			if (reviewName.toLowerCase().endsWith('.diff')) {
				const status: ReviewStatus = action === 'rejectFile' || action === 'rejectAll'
					? 'rejected'
					: action === 'undoFile' || action === 'undoAll'
						? 'pending'
						: 'approved';
				const filePath = (message as { filePath?: unknown }).filePath;
				const update = (action === 'approveFile' || action === 'rejectFile' || action === 'undoFile') && typeof filePath === 'string'
					? setActiveDiffFileStatuses(filePath, status)
					: setAllActiveDiffChangeStatuses(status);
				void update.then(() => {
					void readReviewAndSend(panel, reviewName, reviewUri);
				});
				return;
			}
			const filePath = (message as { filePath?: unknown }).filePath;
			const targetPath = action === 'approveFile' && typeof filePath === 'string' ? filePath : undefined;
			const update = action === 'rejectAll'
				? rejectReviewChanges(reviewUri)
				: approveReviewChanges(reviewUri, targetPath);
			void update.then(() => {
				void readReviewAndSend(panel, reviewName, reviewUri);
			});
		}
	});

	panel.onDidDispose(() => {
		reviewPanels.delete(reviewName);
		fileWatcher?.dispose();
	});
}

async function completeReview(
	reviewName: string,
	reviewUri: vscode.Uri,
	panel: vscode.WebviewPanel,
): Promise<void> {
	const pendingCount = await getPendingReviewCount(reviewName, reviewUri);
	if (pendingCount > 0) {
		void vscode.window.showWarningMessage(`Review still has ${pendingCount} pending hunk${pendingCount === 1 ? '' : 's'}. Approve or reject everything before completing.`);
		await readReviewAndSend(panel, reviewName, reviewUri);
		return;
	}

	const urisToDelete = [reviewUri, getReviewStateUri(reviewUri)];
	await Promise.all(urisToDelete.map(async (uri) => {
		try {
			await vscode.workspace.fs.delete(uri, { useTrash: true });
		} catch {
			// Already gone.
		}
	}));

	if (activeDiffReview?.reviewName === reviewName) {
		activeDiffReview = undefined;
		refreshReviewDecorations();
		reviewCodeLensProvider?.refresh();
		reviewBaseContentProvider?.refresh();
	}

	panel.dispose();
}

async function getPendingReviewCount(reviewName: string, reviewUri: vscode.Uri): Promise<number> {
	if (reviewName.toLowerCase().endsWith('.diff')) {
		const bytes = await vscode.workspace.fs.readFile(reviewUri);
		const rawContent = Buffer.from(bytes).toString('utf8');
		const diffReview = await buildDiffReview(reviewName, reviewUri, rawContent);
		return diffReview.files.reduce(
			(total, file) => total + file.changes.filter((change) => change.status === 'pending').length,
			0,
		);
	}

	const review = await readReviewDocument(reviewUri);
	return getReviewFiles(review).reduce(
		(total, file) => total + getReviewChanges(file).filter((change) => getReviewStatus(change) === 'pending').length,
		0,
	);
}

async function readReviewAndSend(
	panel: vscode.WebviewPanel,
	reviewName: string,
	reviewUri: vscode.Uri,
): Promise<void> {
	try {
		const bytes = await vscode.workspace.fs.readFile(reviewUri);
		const rawContent = Buffer.from(bytes).toString('utf8');
		if (reviewName.toLowerCase().endsWith('.diff')) {
			const diffReview = await buildDiffReview(reviewName, reviewUri, rawContent);
			activeDiffReview = { reviewName, reviewUri, files: diffReview.files };
			refreshReviewDecorations();
			reviewCodeLensProvider?.refresh();
			void panel.webview.postMessage({
				action: 'reviewUpdate',
				reviewName,
				rawContent,
				diffFiles: diffReview.files,
				statePath: getReviewStateFileName(reviewName),
			});
			return;
		}
		void panel.webview.postMessage({ action: 'reviewUpdate', reviewName, rawContent });
	} catch {
		// File may have been deleted.
	}
}

async function buildDiffReview(
	reviewName: string,
	reviewUri: vscode.Uri,
	rawContent: string,
): Promise<{ files: DiffReviewFile[] }> {
	const state = await readDiffReviewState(reviewName, reviewUri);
	const files = parseUnifiedDiff(rawContent);
	for (const file of files) {
		for (const change of file.changes) {
			change.status = state.changes[change.id] ?? 'pending';
		}
	}
	return { files };
}

function parseUnifiedDiff(rawContent: string): DiffReviewFile[] {
	const files: DiffReviewFile[] = [];
	let currentPath = '';
	let currentFile: DiffReviewFile | undefined;
	let hunkIndex = 0;
	const lines = rawContent.replace(/\r\n?/g, '\n').split('\n');

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const diffMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
		if (diffMatch) {
			currentPath = diffMatch[2];
			currentFile = undefined;
			hunkIndex = 0;
			continue;
		}

		const newFileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
		if (newFileMatch) {
			currentPath = newFileMatch[1];
			currentFile = getOrCreateDiffFile(files, currentPath);
			continue;
		}

		const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
		if (!hunkMatch || !currentPath) {
			continue;
		}

		currentFile = currentFile ?? getOrCreateDiffFile(files, currentPath);
		hunkIndex += 1;
		const newStart = Number(hunkMatch[2]);
		const newCount = hunkMatch[3] ? Number(hunkMatch[3]) : 1;
		const oldLines: string[] = [];
		const newLines: string[] = [];
		while (index + 1 < lines.length) {
			const bodyLine = lines[index + 1];
			if (
				bodyLine.startsWith('diff --git ') ||
				bodyLine.startsWith('@@ ') ||
				bodyLine.startsWith('--- ') ||
				bodyLine.startsWith('+++ ')
			) {
				break;
			}
			index += 1;
			if (bodyLine.startsWith('\\')) {
				continue;
			}
			const prefix = bodyLine[0];
			const value = bodyLine.slice(1);
			if (prefix === '+') {
				newLines.push(value);
			} else if (prefix === '-') {
				oldLines.push(value);
			} else if (prefix === ' ') {
				oldLines.push(value);
				newLines.push(value);
			}
		}
		const startLine = newCount === 0 ? Math.max(1, newStart + 1) : Math.max(1, newStart);
		const endLine = newCount === 0 ? startLine : Math.max(startLine, newStart + Math.max(1, newCount) - 1);
		const title = hunkMatch[4].trim() || `Hunk ${hunkIndex}`;
		currentFile.changes.push({
			id: `${currentPath}:${newStart}:${hunkIndex}`,
			filePath: currentPath,
			title,
			startLine,
			endLine,
			oldLines,
			newLines,
			status: 'pending',
		});
	}

	return files;
}

function getOrCreateDiffFile(files: DiffReviewFile[], filePath: string): DiffReviewFile {
	const existing = files.find((file) => file.path === filePath);
	if (existing) {
		return existing;
	}
	const created: DiffReviewFile = { path: filePath, changes: [] };
	files.push(created);
	return created;
}

async function readDiffReviewState(reviewName: string, reviewUri: vscode.Uri): Promise<DiffReviewState> {
	const stateUri = getReviewStateUri(reviewUri);
	try {
		const bytes = await vscode.workspace.fs.readFile(stateUri);
		const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as DiffReviewState;
		if (parsed && typeof parsed === 'object' && parsed.changes && typeof parsed.changes === 'object') {
			return parsed;
		}
	} catch {
		// State file does not exist yet or is invalid.
	}
	return {
		version: 1,
		reviewName,
		updatedAt: new Date().toISOString(),
		changes: {},
	};
}

async function writeDiffReviewState(reviewUri: vscode.Uri, state: DiffReviewState): Promise<void> {
	state.updatedAt = new Date().toISOString();
	await vscode.workspace.fs.writeFile(
		getReviewStateUri(reviewUri),
		Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8'),
	);
}

function getReviewStateUri(reviewUri: vscode.Uri): vscode.Uri {
	return reviewUri.with({ path: `${reviewUri.path}.state.json` });
}

function getReviewStateFileName(reviewName: string): string {
	return `${reviewName}.state.json`;
}

async function setActiveDiffChangeStatus(changeId: string, status: ReviewStatus): Promise<void> {
	if (!activeDiffReview) {
		return;
	}
	const change = findActiveDiffChange(changeId);
	if (!change) {
		return;
	}
	const state = await readDiffReviewState(activeDiffReview.reviewName, activeDiffReview.reviewUri);
	await transitionDiffChangeStatus(change, status);
	state.changes[changeId] = status;
	await writeDiffReviewState(activeDiffReview.reviewUri, state);
	refreshReviewDecorations();
	reviewCodeLensProvider?.refresh();
	reviewBaseContentProvider?.refresh();
	await refreshActiveDiffReviewPanel();
}

async function replaceDiffChangeLines(
	change: DiffReviewChange,
	fromLines: string[],
	toLines: string[],
	errorAction: string,
): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}
	const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, change.filePath);
	const bytes = await vscode.workspace.fs.readFile(fileUri);
	const rawContent = Buffer.from(bytes).toString('utf8');
	const hasTrailingNewline = rawContent.endsWith('\n');
	const lines = splitTextLines(rawContent);
	const startIndex = findLineSequence(lines, fromLines, Math.max(0, change.startLine - 1));
	if (startIndex < 0 && fromLines.length > 0) {
		throw new Error(`Could not find changed lines to ${errorAction} in ${change.filePath}.`);
	}

	const replacementStart = fromLines.length > 0 ? startIndex : Math.max(0, change.startLine - 1);
	const nextLines = [
		...lines.slice(0, replacementStart),
		...toLines,
		...lines.slice(replacementStart + fromLines.length),
	];
	const nextContent = joinTextLines(nextLines, hasTrailingNewline);
	await vscode.workspace.fs.writeFile(fileUri, Buffer.from(nextContent, 'utf8'));
}

async function rejectDiffChange(change: DiffReviewChange): Promise<void> {
	await replaceDiffChangeLines(change, change.newLines, change.oldLines, 'reject');
}

async function restoreRejectedDiffChange(change: DiffReviewChange): Promise<void> {
	await replaceDiffChangeLines(change, change.oldLines, change.newLines, 'restore');
}

function findActiveDiffChange(changeId: string): DiffReviewChange | undefined {
	for (const file of activeDiffReview?.files ?? []) {
		const change = file.changes.find((entry) => entry.id === changeId);
		if (change) {
			return change;
		}
	}
	return undefined;
}

async function setActiveDiffFileStatuses(filePath: string, status: ReviewStatus): Promise<void> {
	if (!activeDiffReview) {
		return;
	}
	const file = activeDiffReview.files.find((entry) => entry.path === filePath);
	if (!file) {
		return;
	}
	const state = await readDiffReviewState(activeDiffReview.reviewName, activeDiffReview.reviewUri);
	for (const change of sortDiffChangesForTransition(file.changes, status)) {
		await transitionDiffChangeStatus(change, status);
		state.changes[change.id] = status;
	}
	await writeDiffReviewState(activeDiffReview.reviewUri, state);
	refreshReviewDecorations();
	reviewCodeLensProvider?.refresh();
	reviewBaseContentProvider?.refresh();
	await refreshActiveDiffReviewPanel();
}

async function setAllActiveDiffChangeStatuses(status: ReviewStatus): Promise<void> {
	if (!activeDiffReview) {
		return;
	}
	const state = await readDiffReviewState(activeDiffReview.reviewName, activeDiffReview.reviewUri);
	for (const file of activeDiffReview.files) {
		for (const change of sortDiffChangesForTransition(file.changes, status)) {
			await transitionDiffChangeStatus(change, status);
			state.changes[change.id] = status;
		}
	}
	await writeDiffReviewState(activeDiffReview.reviewUri, state);
	refreshReviewDecorations();
	reviewCodeLensProvider?.refresh();
	reviewBaseContentProvider?.refresh();
	await refreshActiveDiffReviewPanel();
}

async function transitionDiffChangeStatus(change: DiffReviewChange, status: ReviewStatus): Promise<void> {
	if (change.status === status) {
		return;
	}
	if (change.status === 'rejected' && status !== 'rejected') {
		await restoreRejectedDiffChange(change);
	}
	if (status === 'rejected') {
		await rejectDiffChange(change);
	}
	change.status = status;
}

function sortDiffChangesForTransition(changes: DiffReviewChange[], status: ReviewStatus): DiffReviewChange[] {
	const direction = status === 'rejected' ? -1 : 1;
	return [...changes].sort((a, b) => direction * (a.startLine - b.startLine));
}

async function refreshActiveDiffReviewPanel(): Promise<void> {
	if (!activeDiffReview) {
		return;
	}
	const panel = reviewPanels.get(activeDiffReview.reviewName);
	if (!panel) {
		return;
	}
	await readReviewAndSend(panel, activeDiffReview.reviewName, activeDiffReview.reviewUri);
}

function refreshReviewDecorations(): void {
	for (const editor of vscode.window.visibleTextEditors) {
		const relativePath = getWorkspaceRelativePath(editor.document.uri);
		const file = relativePath ? activeDiffReview?.files.find((entry) => entry.path === relativePath) : undefined;
		applyDiffReviewDecorations(editor, file);
	}
}

function applyDiffReviewDecorations(editor: vscode.TextEditor, file: DiffReviewFile | undefined): void {
	if (!pendingReviewDecorationType || !approvedReviewDecorationType || !rejectedReviewDecorationType) {
		return;
	}
	const optionsByStatus: Record<ReviewStatus, vscode.DecorationOptions[]> = {
		pending: [],
		approved: [],
		rejected: [],
	};

	for (const change of file?.changes ?? []) {
		if (change.status !== 'pending') {
			continue;
		}
		const range = getDiffChangeRange(editor.document, change);
		optionsByStatus[change.status].push({
			range,
			hoverMessage: getDiffReviewHover(change),
		});
	}

	editor.setDecorations(pendingReviewDecorationType, optionsByStatus.pending);
	editor.setDecorations(approvedReviewDecorationType, optionsByStatus.approved);
	editor.setDecorations(rejectedReviewDecorationType, optionsByStatus.rejected);
}

function getDiffReviewHover(change: DiffReviewChange): vscode.MarkdownString {
	const hover = new vscode.MarkdownString(`**DOV ${change.status}**\n\n${change.title}`);
	const diffLines = [
		...change.oldLines.map((line) => `-${line}`),
		...change.newLines.map((line) => `+${line}`),
	];
	if (diffLines.length > 0) {
		const visibleLines = diffLines.slice(0, 30);
		hover.appendMarkdown('\n\n');
		hover.appendCodeblock(
			[
				...visibleLines,
				...(diffLines.length > visibleLines.length ? [`... ${diffLines.length - visibleLines.length} more lines`] : []),
			].join('\n'),
			'diff',
		);
	}
	return hover;
}

function getDiffChangeRange(doc: vscode.TextDocument, change: DiffReviewChange): vscode.Range {
	const startLine = Math.min(doc.lineCount - 1, Math.max(0, change.startLine - 1));
	const endLine = Math.min(doc.lineCount - 1, Math.max(startLine, change.endLine - 1));
	return new vscode.Range(doc.lineAt(startLine).range.start, doc.lineAt(endLine).range.end);
}

function getWorkspaceRelativePath(uri: vscode.Uri): string | undefined {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
	if (!workspaceFolder) {
		return undefined;
	}
	return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

async function focusReviewFile(
	reviewUri: vscode.Uri,
	filePath: string,
	changeId?: string,
): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}

	if (reviewUri.fsPath.toLowerCase().endsWith('.diff')) {
		const file = activeDiffReview?.files.find((entry) => entry.path === filePath);
		const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
		const doc = await vscode.workspace.openTextDocument(fileUri);
		const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
		applyDiffReviewDecorations(editor, file);
		const change = changeId ? file?.changes.find((entry) => entry.id === changeId) : file?.changes[0];
		if (change) {
			const range = getDiffChangeRange(doc, change);
			editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			editor.selection = new vscode.Selection(range.start, range.start);
		}
		return;
	}

	const review = await readReviewDocument(reviewUri);
	const file = findReviewFile(review, filePath);
	const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
	const doc = await vscode.workspace.openTextDocument(fileUri);
	const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
	applyReviewDecorations(editor, file);

	const change = changeId ? findReviewChange(file, changeId) : undefined;
	if (change) {
		const range = getChangeRange(doc, change);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		editor.selection = new vscode.Selection(range.start, range.start);
	}
}

async function updateReviewChangeStatus(
	reviewUri: vscode.Uri,
	filePath: string,
	changeId: string,
	status: ReviewStatus,
): Promise<void> {
	const review = await readReviewDocument(reviewUri);
	const file = findReviewFile(review, filePath);
	const change = findReviewChange(file, changeId);
	if (!change) {
		return;
	}

	if (status === 'approved') {
		await applyReviewChange(filePath, change);
	}
	change.status = status;
	await writeReviewDocument(reviewUri, review);
	await focusReviewFile(reviewUri, filePath, changeId);
}

async function approveReviewChanges(reviewUri: vscode.Uri, filePath?: string): Promise<void> {
	const review = await readReviewDocument(reviewUri);
	const files = getReviewFiles(review).filter((file) => !filePath || file.path === filePath);

	for (const file of files) {
		if (!file.path) {
			continue;
		}
		const changes = getReviewChanges(file)
			.filter((change) => getReviewStatus(change) === 'pending')
			.sort((a, b) => getStartLine(b) - getStartLine(a));
		for (const change of changes) {
			await applyReviewChange(file.path, change);
			change.status = 'approved';
		}
	}

	await writeReviewDocument(reviewUri, review);
	if (filePath) {
		await focusReviewFile(reviewUri, filePath);
	}
}

async function rejectReviewChanges(reviewUri: vscode.Uri): Promise<void> {
	const review = await readReviewDocument(reviewUri);
	for (const file of getReviewFiles(review)) {
		for (const change of getReviewChanges(file)) {
			if (getReviewStatus(change) === 'pending') {
				change.status = 'rejected';
			}
		}
	}
	await writeReviewDocument(reviewUri, review);
}

async function applyReviewChange(filePath: string, change: ReviewChange): Promise<void> {
	if (typeof change.replacement !== 'string') {
		return;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}
	const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
	const doc = await vscode.workspace.openTextDocument(fileUri);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(fileUri, getChangeRange(doc, change), normalizeReplacement(change.replacement));
	await vscode.workspace.applyEdit(edit);
}

function applyReviewDecorations(editor: vscode.TextEditor, file: ReviewFile | undefined): void {
	if (!pendingReviewDecorationType || !approvedReviewDecorationType || !rejectedReviewDecorationType) {
		return;
	}
	const optionsByStatus: Record<ReviewStatus, vscode.DecorationOptions[]> = {
		pending: [],
		approved: [],
		rejected: [],
	};

	for (const change of getReviewChanges(file)) {
		const status = getReviewStatus(change);
		if (status === 'approved') {
			continue;
		}
		const range = getChangeRange(editor.document, change);
		optionsByStatus[status].push({
			range,
			hoverMessage: getReviewHover(change),
			renderOptions: {
				after: {
					contentText: `  DOV ${status}: ${change.title ?? change.id ?? 'review change'}`,
					color: new vscode.ThemeColor('editorCodeLens.foreground'),
					fontStyle: 'italic',
				},
			},
		});
	}

	editor.setDecorations(pendingReviewDecorationType, optionsByStatus.pending);
	editor.setDecorations(approvedReviewDecorationType, optionsByStatus.approved);
	editor.setDecorations(rejectedReviewDecorationType, optionsByStatus.rejected);
}

async function readReviewDocument(reviewUri: vscode.Uri): Promise<ReviewDocument> {
	const bytes = await vscode.workspace.fs.readFile(reviewUri);
	const raw = Buffer.from(bytes).toString('utf8');
	try {
		const parsed = JSON.parse(raw) as ReviewDocument;
		if (typeof parsed === 'object' && parsed !== null) {
			return parsed;
		}
	} catch {
		// Fall through to empty review.
	}
	return { version: 1, title: 'Invalid Review', files: [] };
}

async function writeReviewDocument(reviewUri: vscode.Uri, review: ReviewDocument): Promise<void> {
	await vscode.workspace.fs.writeFile(reviewUri, Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8'));
}

function findReviewFile(review: ReviewDocument, filePath: string): ReviewFile | undefined {
	return getReviewFiles(review).find((file) => file.path === filePath);
}

function findReviewChange(file: ReviewFile | undefined, changeId: string): ReviewChange | undefined {
	return getReviewChanges(file).find((change, index) => getChangeId(change, index) === changeId);
}

function getReviewFiles(review: ReviewDocument): ReviewFile[] {
	return Array.isArray(review.files) ? review.files : [];
}

function getReviewChanges(file: ReviewFile | undefined): ReviewChange[] {
	return Array.isArray(file?.changes) ? file.changes : [];
}

function getChangeId(change: ReviewChange, index: number): string {
	return typeof change.id === 'string' && change.id.trim() ? change.id : `change-${index + 1}`;
}

function getReviewStatus(change: ReviewChange): ReviewStatus {
	return change.status === 'approved' || change.status === 'rejected' ? change.status : 'pending';
}

function getStartLine(change: ReviewChange): number {
	return typeof change.startLine === 'number' && change.startLine > 0 ? Math.floor(change.startLine) : 1;
}

function getEndLine(change: ReviewChange): number {
	const startLine = getStartLine(change);
	return typeof change.endLine === 'number' && change.endLine >= startLine ? Math.floor(change.endLine) : startLine;
}

function getChangeRange(doc: vscode.TextDocument, change: ReviewChange): vscode.Range {
	const startLine = Math.min(doc.lineCount - 1, Math.max(0, getStartLine(change) - 1));
	const endLine = Math.min(doc.lineCount - 1, Math.max(startLine, getEndLine(change) - 1));
	return new vscode.Range(doc.lineAt(startLine).range.start, doc.lineAt(endLine).range.end);
}

function normalizeReplacement(replacement: string): string {
	return replacement.replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
}

function getReviewHover(change: ReviewChange): vscode.MarkdownString {
	const hover = new vscode.MarkdownString(undefined, true);
	hover.isTrusted = false;
	hover.appendMarkdown(`**${change.title ?? 'Review change'}**`);
	if (change.severity) {
		hover.appendMarkdown(`\n\nSeverity: \`${change.severity}\``);
	}
	if (change.message) {
		hover.appendMarkdown(`\n\n${change.message}`);
	}
	return hover;
}

class ReviewCodeLensProvider implements vscode.CodeLensProvider {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changeEmitter.event;

	refresh(): void {
		this.changeEmitter.fire();
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (!activeDiffReview) {
			return [];
		}
		const relativePath = getWorkspaceRelativePath(document.uri);
		const file = relativePath ? activeDiffReview.files.find((entry) => entry.path === relativePath) : undefined;
		if (!file) {
			return [];
		}

		const lenses: vscode.CodeLens[] = [];
		const fileRange = new vscode.Range(0, 0, 0, 0);
		lenses.push(new vscode.CodeLens(fileRange, {
			title: '$(diff) Open PR Diff',
			command: 'document-oriented-vibing.openDiffReviewFile',
			arguments: [file.path],
		}));
		if (file.changes.some((change) => change.status === 'pending')) {
			lenses.push(new vscode.CodeLens(fileRange, {
				title: '$(check-all) Approve File',
				command: 'document-oriented-vibing.approveDiffFile',
				arguments: [file.path],
			}));
			lenses.push(new vscode.CodeLens(fileRange, {
				title: '$(x) Reject File',
				command: 'document-oriented-vibing.rejectDiffFile',
				arguments: [file.path],
			}));
		} else if (file.changes.some((change) => change.status === 'approved' || change.status === 'rejected')) {
			lenses.push(new vscode.CodeLens(fileRange, {
				title: '$(discard) Undo File',
				command: 'document-oriented-vibing.undoDiffFile',
				arguments: [file.path],
			}));
		}

		for (const change of file.changes) {
			const range = getDiffChangeRange(document, change);
			if (change.status === 'pending') {
				lenses.push(new vscode.CodeLens(range, {
					title: '$(check) Approve',
					command: 'document-oriented-vibing.approveDiffChange',
					arguments: [change.id],
				}));
				lenses.push(new vscode.CodeLens(range, {
					title: '$(x) Reject',
					command: 'document-oriented-vibing.rejectDiffChange',
					arguments: [change.id],
				}));
			}
		}

		return lenses;
	}
}

class DiffReviewBaseContentProvider implements vscode.TextDocumentContentProvider {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	private readonly activeUris = new Map<string, vscode.Uri>();
	readonly onDidChange = this.changeEmitter.event;

	refresh(): void {
		for (const uri of this.activeUris.values()) {
			this.changeEmitter.fire(uri);
		}
	}

	provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
		this.activeUris.set(uri.toString(), uri);
		const filePath = decodeURIComponent(uri.path.replace(/^\/+/, ''));
		return buildDiffReviewBaseContent(filePath);
	}
}

async function openDiffReviewForFile(filePath: string): Promise<void> {
	if (!activeDiffReview) {
		return;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}
	const file = activeDiffReview.files.find((entry) => entry.path === filePath);
	if (!file) {
		return;
	}

	const beforeUri = vscode.Uri.from({
		scheme: 'dov-review-base',
		authority: activeDiffReview.reviewName,
		path: `/${encodeURIComponent(filePath)}`,
	});
	const afterUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
	await vscode.commands.executeCommand(
		'vscode.diff',
		beforeUri,
		afterUri,
		`DOV Review: ${filePath}`,
		{ preview: false },
	);
}

async function buildDiffReviewBaseContent(filePath: string): Promise<string> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return '';
	}
	const file = activeDiffReview?.files.find((entry) => entry.path === filePath);
	if (!file) {
		return '';
	}
	const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
	const bytes = await vscode.workspace.fs.readFile(fileUri);
	const currentContent = Buffer.from(bytes).toString('utf8');
	const hasTrailingNewline = currentContent.endsWith('\n');
	const lines = splitTextLines(currentContent);

	for (const change of [...file.changes].sort((a, b) => b.startLine - a.startLine)) {
		const newStartIndex = findLineSequence(lines, change.newLines, Math.max(0, change.startLine - 1));
		if (newStartIndex >= 0 || change.newLines.length === 0) {
			const replacementStart = change.newLines.length > 0 ? newStartIndex : Math.max(0, change.startLine - 1);
			lines.splice(replacementStart, change.newLines.length, ...change.oldLines);
			continue;
		}
		const oldStartIndex = findLineSequence(lines, change.oldLines, Math.max(0, change.startLine - 1));
		if (oldStartIndex >= 0) {
			continue;
		}
	}

	return joinTextLines(lines, hasTrailingNewline);
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

async function removeOldReviews(panel: vscode.WebviewPanel): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage('Open a workspace folder first.');
		await publishHomeState(panel, 'No workspace folder is open.');
		return;
	}

	const reviewUris = await readReviewArtifactUris(workspaceFolder);
	if (reviewUris.length === 0) {
		await publishHomeState(panel, 'No old reviews to remove.');
		return;
	}

	const confirmed = await vscode.window.showWarningMessage(
		`Remove ${reviewUris.length} old review artifact${reviewUris.length === 1 ? '' : 's'} from .reviews?`,
		{ modal: true },
		'Remove Reviews',
	);
	if (confirmed !== 'Remove Reviews') {
		await publishHomeState(panel, 'Review cleanup canceled.');
		return;
	}

	await Promise.all(reviewUris.map((uri) => vscode.workspace.fs.delete(uri, { useTrash: true })));
	for (const reviewPanel of reviewPanels.values()) {
		reviewPanel.dispose();
	}
	reviewPanels.clear();
	activeDiffReview = undefined;
	refreshReviewDecorations();
	await publishHomeState(panel, `Removed ${reviewUris.length} old review artifact${reviewUris.length === 1 ? '' : 's'}.`);
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

function normalizeReviewFileName(input: string): string {
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
	return slug.endsWith('.diff') || slug.endsWith('.json') ? slug : `${slug}.diff`;
}

function getDefaultReviewName(): string {
	const now = new Date();
	const stamp = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getDate()).padStart(2, '0'),
		'-',
		String(now.getHours()).padStart(2, '0'),
		String(now.getMinutes()).padStart(2, '0'),
		String(now.getSeconds()).padStart(2, '0'),
	].join('');
	return `codex-review-${stamp}.diff`;
}

async function readCodexWrittenFilesForPreviousTurn(workspaceRoot: string, requestedThreadId?: string): Promise<string[]> {
	const threadId = requestedThreadId || process.env.CODEX_THREAD_ID;
	if (!threadId) {
		throw new Error('CODEX_THREAD_ID is not available in the extension host environment.');
	}

	const sessionFile = await findCodexSessionFile(threadId);
	if (!sessionFile) {
		throw new Error(`No Codex session file found for thread ${threadId}.`);
	}

	const rawSession = await fs.readFile(sessionFile, 'utf8');
	const records = rawSession
		.split(/\r?\n/)
		.filter(Boolean)
		.flatMap((line) => parseCodexSessionRecord(line));
	const userTimestamps = records
		.filter((record) => (
			record.type === 'response_item' &&
			record.payload?.type === 'message' &&
			record.payload.role === 'user' &&
			record.timestamp
		))
		.map((record) => record.timestamp as string);

	const ranges: Array<[string, string]> = [];
	const latestUserTime = userTimestamps.at(-1);
	if (latestUserTime) {
		ranges.push([latestUserTime, '9999']);
	}
	if (userTimestamps.length >= 2) {
		ranges.push([userTimestamps[userTimestamps.length - 2], userTimestamps[userTimestamps.length - 1]]);
	}

	for (const [startTime, endTime] of ranges) {
		const files = extractCodexWrittenFilesFromRange(records, workspaceRoot, startTime, endTime);
		if (files.length > 0) {
			return files;
		}
	}

	return [];
}

async function readCodexPatchHunksForReview(workspaceRoot: string, requestedThreadId?: string): Promise<CodexPatchHunk[]> {
	const threadId = requestedThreadId || process.env.CODEX_THREAD_ID;
	if (!threadId) {
		throw new Error('CODEX_THREAD_ID is not available in the extension host environment.');
	}

	const sessionFile = await findCodexSessionFile(threadId);
	if (!sessionFile) {
		throw new Error(`No Codex session file found for thread ${threadId}.`);
	}

	const rawSession = await fs.readFile(sessionFile, 'utf8');
	const records = rawSession
		.split(/\r?\n/)
		.filter(Boolean)
		.flatMap((line) => parseCodexSessionRecord(line));
	return extractRecentCodexPatchHunksForReview(records, workspaceRoot);
}

function extractRecentCodexPatchHunksForReview(records: CodexSessionRecord[], workspaceRoot: string): CodexPatchHunk[] {
	const userTimestamps = records
		.filter((record) => (
			record.type === 'response_item' &&
			record.payload?.type === 'message' &&
			record.payload.role === 'user' &&
			record.timestamp
		))
		.map((record) => record.timestamp as string);
	const ranges: Array<[string, string]> = [];
	const latestUserTime = userTimestamps.at(-1);
	if (latestUserTime) {
		ranges.push([latestUserTime, '9999']);
	}
	if (userTimestamps.length >= 2) {
		ranges.push([userTimestamps[userTimestamps.length - 2], userTimestamps[userTimestamps.length - 1]]);
	}

	for (const [startTime, endTime] of ranges) {
		const hunks = extractCodexPatchHunksFromRange(records, workspaceRoot, startTime, endTime);
		if (hunks.length > 0) {
			return hunks;
		}
	}

	return [];
}

function extractCodexPatchHunksFromRange(
	records: CodexSessionRecord[],
	workspaceRoot: string,
	startTime: string,
	endTime: string,
): CodexPatchHunk[] {
	return records.flatMap((record) => {
		if (
			!record.timestamp ||
			record.timestamp <= startTime ||
			record.timestamp >= endTime ||
			record.type !== 'response_item' ||
			record.payload?.type !== 'custom_tool_call' ||
			record.payload.name !== 'apply_patch' ||
			typeof record.payload.input !== 'string'
		) {
			return [];
		}
		return parseApplyPatchHunks(record.payload.input, workspaceRoot);
	});
}

function parseApplyPatchHunks(patchInput: string, workspaceRoot: string): CodexPatchHunk[] {
	const hunks: CodexPatchHunk[] = [];
	const lines = patchInput.replace(/\r\n?/g, '\n').split('\n');
	let currentPath: string | undefined;

	for (let index = 0; index < lines.length; index += 1) {
		const fileMatch = /^\*\*\* (?:Update|Add) File: (.+)$/.exec(lines[index]);
		if (fileMatch) {
			currentPath = toWorkspaceRelativePath(fileMatch[1], workspaceRoot);
			continue;
		}
		if (/^\*\*\* (?:Delete|End) File: /.test(lines[index]) || lines[index] === '*** End Patch') {
			currentPath = undefined;
			continue;
		}
		if (!currentPath) {
			continue;
		}

		if (lines[index].startsWith('@@')) {
			const oldLines: string[] = [];
			const newLines: string[] = [];
			while (index + 1 < lines.length) {
				const bodyLine = lines[index + 1];
				if (
					bodyLine.startsWith('@@') ||
					bodyLine.startsWith('*** ') ||
					bodyLine === '*** End Patch'
				) {
					break;
				}
				index += 1;
				addApplyPatchLine(bodyLine, oldLines, newLines);
			}
			if (oldLines.length > 0 || newLines.length > 0) {
				hunks.push({ filePath: currentPath, oldLines, newLines });
			}
			continue;
		}

		if (lines[index].startsWith('+')) {
			const newLines: string[] = [];
			while (index < lines.length && lines[index].startsWith('+')) {
				newLines.push(lines[index].slice(1));
				index += 1;
			}
			index -= 1;
			if (newLines.length > 0) {
				hunks.push({ filePath: currentPath, oldLines: [], newLines });
			}
		}
	}

	return hunks;
}

function addApplyPatchLine(line: string, oldLines: string[], newLines: string[]): void {
	const prefix = line[0];
	const value = line.slice(1);
	if (prefix === '-') {
		oldLines.push(value);
	} else if (prefix === '+') {
		newLines.push(value);
	} else if (prefix === ' ') {
		oldLines.push(value);
		newLines.push(value);
	}
}

async function buildCodexThreadDiff(workspaceRoot: vscode.Uri, patchHunks: CodexPatchHunk[]): Promise<string> {
	const hunksByFile = new Map<string, CodexPatchHunk[]>();
	for (const hunk of patchHunks) {
		hunksByFile.set(hunk.filePath, [...(hunksByFile.get(hunk.filePath) ?? []), hunk]);
	}

	const diffs: string[] = [];
	for (const [filePath, hunks] of hunksByFile) {
		const fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);
		const currentContent = await readTextFileIfExists(fileUri);
		const currentLines = splitTextLines(currentContent);
		const baselineLines = reverseApplyPatchHunks(currentLines, hunks);
		const fileDiff = createUnifiedDiff(filePath, baselineLines, currentLines);
		if (fileDiff.trim()) {
			diffs.push(fileDiff);
		}
	}

	return diffs.join('\n');
}

async function readTextFileIfExists(uri: vscode.Uri): Promise<string> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return Buffer.from(bytes).toString('utf8');
	} catch {
		return '';
	}
}

function reverseApplyPatchHunks(currentLines: string[], hunks: CodexPatchHunk[]): string[] {
	let lines = [...currentLines];
	for (const hunk of [...hunks].reverse()) {
		const startIndex = findLineSequence(lines, hunk.newLines);
		if (startIndex < 0) {
			continue;
		}
		lines = [
			...lines.slice(0, startIndex),
			...hunk.oldLines,
			...lines.slice(startIndex + hunk.newLines.length),
		];
	}
	return lines;
}

function createUnifiedDiff(filePath: string, oldLines: string[], newLines: string[]): string {
	const changes = diffLines(oldLines, newLines);
	if (changes.length === 0) {
		return '';
	}
	const output = [
		`diff --git a/${filePath} b/${filePath}`,
		`--- a/${filePath}`,
		`+++ b/${filePath}`,
	];
	for (const change of changes) {
		output.push(`@@ -${formatDiffRange(change.oldStart, change.oldLines.length)} +${formatDiffRange(change.newStart, change.newLines.length)} @@`);
		output.push(...change.oldLines.map((line) => `-${line}`));
		output.push(...change.newLines.map((line) => `+${line}`));
	}
	return `${output.join('\n')}\n`;
}

function diffLines(oldLines: string[], newLines: string[]): Array<{
	oldStart: number;
	newStart: number;
	oldLines: string[];
	newLines: string[];
}> {
	const dp = Array.from({ length: oldLines.length + 1 }, () => Array<number>(newLines.length + 1).fill(0));
	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
			dp[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
				? dp[oldIndex + 1][newIndex + 1] + 1
				: Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1]);
		}
	}

	const changes: Array<{ oldStart: number; newStart: number; oldLines: string[]; newLines: string[] }> = [];
	let oldIndex = 0;
	let newIndex = 0;
	let pending: { oldStart: number; newStart: number; oldLines: string[]; newLines: string[] } | undefined;
	const flush = () => {
		if (pending && (pending.oldLines.length > 0 || pending.newLines.length > 0)) {
			changes.push(pending);
		}
		pending = undefined;
	};

	while (oldIndex < oldLines.length || newIndex < newLines.length) {
		if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
			flush();
			oldIndex += 1;
			newIndex += 1;
			continue;
		}
		pending ??= { oldStart: oldIndex + 1, newStart: newIndex + 1, oldLines: [], newLines: [] };
		if (newIndex >= newLines.length || (oldIndex < oldLines.length && dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1])) {
			pending.oldLines.push(oldLines[oldIndex]);
			oldIndex += 1;
		} else {
			pending.newLines.push(newLines[newIndex]);
			newIndex += 1;
		}
	}
	flush();

	return changes;
}

function formatDiffRange(start: number, count: number): string {
	if (count === 1) {
		return String(start);
	}
	if (count === 0) {
		return `${Math.max(0, start - 1)},0`;
	}
	return `${start},${count}`;
}

function extractCodexWrittenFilesFromRange(
	records: CodexSessionRecord[],
	workspaceRoot: string,
	startTime: string,
	endTime: string,
): string[] {
	const files = new Set<string>();
	for (const record of records) {
		if (
			!record.timestamp ||
			record.timestamp <= startTime ||
			record.timestamp >= endTime ||
			record.type !== 'response_item' ||
			record.payload?.type !== 'custom_tool_call' ||
			record.payload.name !== 'apply_patch' ||
			typeof record.payload.input !== 'string'
		) {
			continue;
		}

		for (const filePath of extractPatchFilePaths(record.payload.input, workspaceRoot)) {
			files.add(filePath);
		}
	}

	return [...files].sort((a, b) => a.localeCompare(b));
}

async function findCodexSessionFile(threadId: string): Promise<string | undefined> {
	const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
	const files = await listFiles(sessionsRoot);
	const jsonlFiles = files.filter((file) => file.endsWith('.jsonl'));
	const namedMatch = jsonlFiles.find((file) => path.basename(file).includes(threadId));
	if (namedMatch) {
		return namedMatch;
	}

	for (const file of jsonlFiles) {
		const content = await fs.readFile(file, 'utf8');
		if (content.includes(threadId)) {
			return file;
		}
	}

	return undefined;
}

async function readCodexThreadEntries(): Promise<CodexThreadListItem[]> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return [];
	}

	const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
	const files = await listFilesIfExists(sessionsRoot);
	const jsonlStats = await Promise.all(
		files
			.filter((file) => file.endsWith('.jsonl'))
			.map(async (file) => {
				try {
					const stat = await fs.stat(file);
					return { file, mtime: stat.mtimeMs };
				} catch {
					return undefined;
				}
			}),
	);

	const recentJsonlStats = jsonlStats
		.filter((entry): entry is { file: string; mtime: number } => Boolean(entry))
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, 100);

	const entries = await Promise.all(
		recentJsonlStats.map(async ({ file, mtime }) => {
			try {
				const rawSession = await fs.readFile(file, 'utf8');
				const records = rawSession
					.split(/\r?\n/)
					.filter(Boolean)
					.flatMap((line) => parseCodexSessionRecord(line));
				const hunks = extractRecentCodexPatchHunksForReview(records, workspaceFolder.uri.fsPath);
				const changedFiles = new Set(hunks.map((hunk) => hunk.filePath));
				if (changedFiles.size === 0) {
					return undefined;
				}
				return {
					id: getCodexThreadId(records, file),
					title: getCodexThreadTitle(records, file),
					updatedAt: mtime,
					ageLabel: formatRelativeAge(mtime, 'Updated'),
					changeCount: changedFiles.size,
				};
			} catch {
				return undefined;
			}
		}),
	);

	return entries
		.filter((entry): entry is CodexThreadListItem => Boolean(entry))
		.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

async function listFilesIfExists(root: string): Promise<string[]> {
	try {
		return await listFiles(root);
	} catch {
		return [];
	}
}

async function listFiles(root: string): Promise<string[]> {
	const entries = await fs.readdir(root, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(root, entry.name);
			if (entry.isDirectory()) {
				return listFiles(entryPath);
			}
			return entry.isFile() ? [entryPath] : [];
		}),
	);
	return files.flat();
}

function getCodexThreadId(records: CodexSessionRecord[], file: string): string {
	for (const record of records) {
		const candidate = getStringProperty(record, 'thread_id')
			?? getStringProperty(record, 'threadId')
			?? getStringProperty(record, 'session_id')
			?? getStringProperty(record, 'sessionId');
		if (candidate) {
			return candidate;
		}
	}
	return path.basename(file, '.jsonl');
}

function getCodexThreadTitle(records: CodexSessionRecord[], file: string): string {
	const titles: string[] = [];
	for (const record of records) {
		if (
			record.type === 'response_item' &&
			record.payload?.type === 'message' &&
			record.payload.role === 'user'
		) {
			const text = getMessageText(record.payload);
			if (text) {
				titles.push(trimTitle(text));
			}
		}
	}
	const latestTitle = titles.at(-1);
	if (latestTitle) {
		return latestTitle;
	}
	return path.basename(file, '.jsonl');
}

function getStringProperty(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function getMessageText(payload: unknown): string | undefined {
	if (!payload || typeof payload !== 'object') {
		return undefined;
	}
	const content = (payload as Record<string, unknown>).content;
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		const parts = content.flatMap((part) => {
			if (typeof part === 'string') {
				return [part];
			}
			if (!part || typeof part !== 'object') {
				return [];
			}
			const text = (part as Record<string, unknown>).text;
			return typeof text === 'string' ? [text] : [];
		});
		return parts.join(' ');
	}
	return undefined;
}

function trimTitle(value: string): string {
	const title = value.replace(/\s+/g, ' ').trim();
	if (title.length <= 80) {
		return title;
	}
	return `${title.slice(0, 77)}...`;
}

function parseCodexSessionRecord(line: string): CodexSessionRecord[] {
	try {
		return [JSON.parse(line) as CodexSessionRecord];
	} catch {
		return [];
	}
}

function extractPatchFilePaths(patchInput: string, workspaceRoot: string): string[] {
	const files = new Set<string>();
	const fileHeaderPattern = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;
	let match: RegExpExecArray | null;

	while ((match = fileHeaderPattern.exec(patchInput)) !== null) {
		const relativePath = toWorkspaceRelativePath(match[1], workspaceRoot);
		if (relativePath) {
			files.add(relativePath);
		}
	}

	return [...files];
}

function toWorkspaceRelativePath(filePath: string, workspaceRoot: string): string | undefined {
	let normalizedPath = filePath.trim();
	if (!normalizedPath) {
		return undefined;
	}

	if (path.isAbsolute(normalizedPath)) {
		const relativePath = path.relative(workspaceRoot, normalizedPath);
		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			return undefined;
		}
		normalizedPath = relativePath;
	}

	return normalizedPath.replace(/\\/g, '/');
}

function splitTextLines(content: string): string[] {
	const normalized = content.replace(/\r\n?/g, '\n');
	const lines = normalized.split('\n');
	if (lines.at(-1) === '') {
		lines.pop();
	}
	return lines;
}

function joinTextLines(lines: string[], trailingNewline: boolean): string {
	return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

function findLineSequence(lines: string[], sequence: string[], preferredStart?: number): number {
	if (sequence.length === 0) {
		return preferredStart ?? 0;
	}
	if (typeof preferredStart === 'number') {
		const nearbyStart = Math.max(0, preferredStart - 5);
		const nearbyEnd = Math.min(lines.length - sequence.length, preferredStart + 5);
		for (let index = nearbyStart; index <= nearbyEnd; index += 1) {
			if (lineSequenceMatches(lines, sequence, index)) {
				return index;
			}
		}
	}
	for (let index = 0; index <= lines.length - sequence.length; index += 1) {
		if (lineSequenceMatches(lines, sequence, index)) {
			return index;
		}
	}
	return -1;
}

function lineSequenceMatches(lines: string[], sequence: string[], startIndex: number): boolean {
	for (let offset = 0; offset < sequence.length; offset += 1) {
		if (lines[startIndex + offset] !== sequence[offset]) {
			return false;
		}
	}
	return true;
}

async function runGitDiffForFiles(workspaceRoot: string, files: string): Promise<string>;
async function runGitDiffForFiles(workspaceRoot: string, files: string[]): Promise<string>;
async function runGitDiffForFiles(workspaceRoot: string, files: string | string[]): Promise<string> {
	const pathspecs = Array.isArray(files) ? files : [files];
	const { stdout } = await execFileAsync(
		'git',
		['diff', '--no-ext-diff', 'HEAD', '--', ...pathspecs],
		{
			cwd: workspaceRoot,
			encoding: 'utf8',
			maxBuffer: 50 * 1024 * 1024,
		},
	);
	return stdout;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
	const featureEntries = await readFeatureEntries();
	return featureEntries.map((feature) => feature.name);
}

async function readFeatureEntries(): Promise<FeatureListItem[]> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return [];
	}
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, '.features');
	try {
		const entries = await vscode.workspace.fs.readDirectory(uri);
		const featureEntries = await Promise.all(
			entries
				.filter(([, type]) => type === vscode.FileType.File)
				.map(async ([name]) => {
					const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(uri, name));
					const createdAt = stat.ctime || stat.mtime;
					return {
						name,
						createdAt,
						updatedAt: stat.mtime,
						ageLabel: formatRelativeAge(createdAt, 'Created'),
					};
				}),
		);
		return featureEntries.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

function formatRelativeAge(timestamp: number, prefix: string): string {
	const elapsedMs = Math.max(0, Date.now() - timestamp);
	const minute = 60 * 1000;
	const hour = 60 * minute;
	const day = 24 * hour;
	const week = 7 * day;
	const month = 30 * day;
	const year = 365 * day;

	if (elapsedMs < minute) {
		return `${prefix} just now`;
	}
	if (elapsedMs < hour) {
		const value = Math.floor(elapsedMs / minute);
		return `${prefix} ${value}m ago`;
	}
	if (elapsedMs < day) {
		const value = Math.floor(elapsedMs / hour);
		return `${prefix} ${value}h ago`;
	}
	if (elapsedMs < week) {
		const value = Math.floor(elapsedMs / day);
		return `${prefix} ${value}d ago`;
	}
	if (elapsedMs < month) {
		const value = Math.floor(elapsedMs / week);
		return `${prefix} ${value}w ago`;
	}
	if (elapsedMs < year) {
		const value = Math.floor(elapsedMs / month);
		return `${prefix} ${value}mo ago`;
	}

	const value = Math.floor(elapsedMs / year);
	return `${prefix} ${value}y ago`;
}

async function readReviewNames(): Promise<string[]> {
	const reviewEntries = await readReviewEntries();
	return reviewEntries.map((review) => review.name);
}

async function readReviewEntries(): Promise<ReviewListItem[]> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return [];
	}
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, '.reviews');
	try {
		const entries = await vscode.workspace.fs.readDirectory(uri);
		const reviewEntries = await Promise.all(
			entries
				.filter(([name, type]) => {
					const lowerName = name.toLowerCase();
					if (lowerName.endsWith('.state.json')) {
						return false;
					}
					return type === vscode.FileType.File && (lowerName.endsWith('.diff') || lowerName.endsWith('.json'));
				})
				.map(async ([name]) => {
					const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(uri, name));
					return { name, mtime: stat.mtime };
				}),
			);
		return reviewEntries
			.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
			.map(({ name, mtime }) => ({
				name,
				updatedAt: mtime,
				ageLabel: formatRelativeAge(mtime, 'Updated'),
			}));
	} catch {
		return [];
	}
}

async function readReviewArtifactCount(): Promise<number> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return 0;
	}
	const reviewUris = await readReviewArtifactUris(workspaceFolder);
	return reviewUris.length;
}

async function readReviewArtifactUris(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Uri[]> {
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, '.reviews');
	try {
		const entries = await vscode.workspace.fs.readDirectory(uri);
		return entries
			.filter(([name, type]) => type === vscode.FileType.File && isReviewArtifactName(name))
			.map(([name]) => vscode.Uri.joinPath(uri, name));
	} catch {
		return [];
	}
}

function isReviewArtifactName(name: string): boolean {
	const lowerName = name.toLowerCase();
	return lowerName.endsWith('.diff') || lowerName.endsWith('.json');
}

async function checkLlmFilesHaveInstructions(): Promise<boolean> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return false;
	}
	const [hasClaudeInstructions, hasCodexSetup] = await Promise.all([
		checkLlmFileHasInstructions(workspaceFolder, CLAUDE_INSTRUCTION_FILE_NAME),
		checkCodexSetupHasInstructions(workspaceFolder),
	]);
	return hasClaudeInstructions && hasCodexSetup;
}

async function checkLlmFileHasInstructions(
	workspaceFolder: vscode.WorkspaceFolder,
	fileName: string,
): Promise<boolean> {
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const content = Buffer.from(bytes).toString('utf8');
		return content.includes(`<!-- dov-start v${DOV_SCHEMA_VERSION} -->`);
	} catch {
		return false;
	}
}

async function checkCodexSetupHasInstructions(workspaceFolder: vscode.WorkspaceFolder): Promise<boolean> {
	const agentsUri = vscode.Uri.joinPath(workspaceFolder.uri, CODEX_INSTRUCTION_FILE_NAME);
	const skillRootUri = getDovSkillRootUri(workspaceFolder);
	const skillUri = getDovSkillUri(workspaceFolder);
	const schemaReferenceUri = vscode.Uri.joinPath(skillRootUri, 'references', 'schema.md');
	const reviewSchemaReferenceUri = vscode.Uri.joinPath(skillRootUri, 'references', 'review-schema.md');
	const openaiYamlUri = vscode.Uri.joinPath(skillRootUri, 'agents', 'openai.yaml');
	try {
		const [agentsBytes, skillBytes] = await Promise.all([
			vscode.workspace.fs.readFile(agentsUri),
			vscode.workspace.fs.readFile(skillUri),
			vscode.workspace.fs.readFile(schemaReferenceUri),
			vscode.workspace.fs.readFile(reviewSchemaReferenceUri),
			vscode.workspace.fs.readFile(openaiYamlUri),
		]);
		const agentsContent = Buffer.from(agentsBytes).toString('utf8');
		const skillContent = Buffer.from(skillBytes).toString('utf8');
		return (
			agentsContent.includes(`<!-- dov-start v${DOV_SCHEMA_VERSION} -->`)
			&& skillContent.includes(DOV_SKILL_VERSION_MARKER)
		);
	} catch {
		return false;
	}
}

async function addLlmInstructionsAndCodexSkill(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}
	const instructionOptions = getDovInstructionOptions(context);
	await Promise.all([
		upsertManagedInstructions(workspaceFolder, CLAUDE_INSTRUCTION_FILE_NAME, getLlmInstructions(instructionOptions)),
		addCodexSkillSetup(workspaceFolder, instructionOptions),
	]);
}

function getDovInstructionOptions(context: vscode.ExtensionContext): DovInstructionOptions {
	return { extensionId: context.extension.id };
}

async function addCodexSkillSetup(
	workspaceFolder: vscode.WorkspaceFolder,
	instructionOptions: DovInstructionOptions,
): Promise<void> {
	const agentsRootUri = vscode.Uri.joinPath(workspaceFolder.uri, '.agents');
	const skillsRootUri = vscode.Uri.joinPath(agentsRootUri, 'skills');
	const skillRootUri = getDovSkillRootUri(workspaceFolder);
	const referencesUri = vscode.Uri.joinPath(skillRootUri, 'references');
	const agentsMetadataUri = vscode.Uri.joinPath(skillRootUri, 'agents');

	await vscode.workspace.fs.createDirectory(agentsRootUri);
	await vscode.workspace.fs.createDirectory(skillsRootUri);
	await vscode.workspace.fs.createDirectory(skillRootUri);
	await Promise.all([
		vscode.workspace.fs.createDirectory(referencesUri),
		vscode.workspace.fs.createDirectory(agentsMetadataUri),
	]);
	await Promise.all([
		upsertManagedInstructions(workspaceFolder, CODEX_INSTRUCTION_FILE_NAME, getCodexAgentsInstructions(instructionOptions)),
		writeFileIfChanged(getDovSkillUri(workspaceFolder), getDovSkillInstructions(instructionOptions)),
		writeFileIfChanged(vscode.Uri.joinPath(referencesUri, 'schema.md'), getSchemaDocument()),
		writeFileIfChanged(vscode.Uri.joinPath(referencesUri, 'review-schema.md'), getReviewSchemaDocument(instructionOptions)),
		writeFileIfChanged(vscode.Uri.joinPath(agentsMetadataUri, 'openai.yaml'), getDovSkillOpenaiYaml()),
	]);
}

async function upsertManagedInstructions(
	workspaceFolder: vscode.WorkspaceFolder,
	fileName: string,
	instructions: string,
): Promise<void> {
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
	let existing = '';
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		existing = Buffer.from(bytes).toString('utf8');
	} catch {
		// File doesn't exist yet.
	}

	if (existing.includes(instructions.trim())) {
		return;
	}

	// Strip any old versioned blocks (v1, v2, …) or legacy markers
	let cleaned = existing;
	cleaned = cleaned.replace(DOV_BLOCK_REGEX, '');
	cleaned = cleaned.replace(DOV_LEGACY_REGEX, '');

	const updated = cleaned.trimEnd() + '\n' + instructions;
	await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
}

async function writeFileIfChanged(uri: vscode.Uri, content: string): Promise<void> {
	let existing = '';
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		existing = Buffer.from(bytes).toString('utf8');
	} catch {
		// File doesn't exist yet.
	}
	if (existing === content) {
		return;
	}
	await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

function getDovSkillRootUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
	return vscode.Uri.joinPath(workspaceFolder.uri, '.agents', 'skills', DOV_SKILL_NAME);
}

function getDovSkillUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri {
	return vscode.Uri.joinPath(getDovSkillRootUri(workspaceFolder), 'SKILL.md');
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

function getReviewWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-webview', 'review.js'));
	const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Review</title>
</head>
<body>
	<div id="root"></div>
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
