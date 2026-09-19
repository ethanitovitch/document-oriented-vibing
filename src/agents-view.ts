import { existsSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CodexAppServer } from './codex-app-server';
import { AgentThread, CodexThreadIndex } from './codex-threads';

const prefix = 'document-oriented-vibing';
function codexBinary(): string {
	const extension = vscode.extensions.getExtension('openai.chatgpt');
	const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform;
	const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
	const bundled = extension && path.join(extension.extensionPath, 'bin', `${platform}-${arch}`, process.platform === 'win32' ? 'codex.exe' : 'codex');
	return bundled && existsSync(bundled) ? bundled : 'codex';
}
export function registerAgentsView(context: vscode.ExtensionContext): void {
	const index = new CodexThreadIndex();
	const appServer = new CodexAppServer(codexBinary());
	const changed = new vscode.EventEmitter<void>();
	let names = new Map<string, string>();
	let threads: AgentThread[] = [];
	let busy = false;
	let disposed = false;
	const provider: vscode.TreeDataProvider<AgentThread> = {
		onDidChangeTreeData: changed.event,
		getChildren: () => threads,
		getTreeItem: thread => {
			const title = names.get(thread.id) || thread.title;
			const item = new vscode.TreeItem(title);
			item.id = thread.id;
			item.contextValue = 'dovAgent';
			item.description = thread.status;
			item.tooltip = `${title}\n${thread.status} (observed from local session log)\n${thread.model ?? 'Model unknown'}\n${thread.cwd}\n${thread.id}`;
			item.iconPath = new vscode.ThemeIcon({ Working: 'sync~spin', Finished: 'pass', Interrupted: 'debug-pause', Unknown: 'question' }[thread.status]);
			item.command = { command: `${prefix}.openAgent`, title: 'Switch Agent in Codex', arguments: [thread.id] };
			return item;
		},
	};
	const views = ['codexAgents', 'codexAgentsLegacy'].map(id => vscode.window.createTreeView(`${prefix}.${id}`, {
		treeDataProvider: provider, showCollapseAll: false,
	}));
	function setMessage(message: string | undefined) {
		for (const view of views) { view.message = message; }
	}
	async function refresh() {
		if (busy || disposed) { return; }
		busy = true;
		try {
			const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
			threads = await index.list(roots);
			if (disposed) { return; }
			try {
				names = await appServer.listNames(roots, threads.map(thread => thread.id));
				setMessage(threads.length ? undefined : 'No top-level Codex conversations in this workspace yet.');
			} catch (error) {
				setMessage(`Codex name sync unavailable: ${error instanceof Error ? error.message : String(error)}`);
			}
			changed.fire();
		} catch (error) {
			if (!disposed) { setMessage(`Cannot read Codex sessions: ${error instanceof Error ? error.message : String(error)}`); }
		} finally { busy = false; }
	}
	async function withCodex(action: () => Promise<unknown>) {
		try {
			const extension = vscode.extensions.getExtension('openai.chatgpt');
			if (!extension) { throw new Error('Install the OpenAI Codex extension to open agent tabs.'); }
			await extension.activate();
			await action();
		} catch (error) {
			void vscode.window.showErrorMessage(`DOV: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const timer = setInterval(() => { if (views.some(view => view.visible)) { void refresh(); } }, 5000);
	context.subscriptions.push(
		...views, changed, appServer,
		{ dispose: () => { disposed = true; clearInterval(timer); } },
		...views.map(view => view.onDidChangeVisibility(event => { if (event.visible) { void refresh(); } })),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
		vscode.commands.registerCommand(`${prefix}.refreshAgents`, refresh),
		vscode.commands.registerCommand(`${prefix}.renameAgent`, async (target: unknown) => {
			const id = typeof target === 'object' && target !== null && 'id' in target ? target.id : undefined;
			const thread = threads.find((entry) => entry.id === id);
			if (!thread) { return; }
			const name = await vscode.window.showInputBox({
				title: 'Rename Agent',
				prompt: 'This name is shared with the Codex conversation.',
				value: names.get(thread.id) || thread.title,
				validateInput: value => value.trim() ? undefined : 'Enter a name.',
			});
			if (name === undefined) { return; }
			try {
				await appServer.setName(thread.id, name.trim());
				names.set(thread.id, name.trim());
				changed.fire();
			} catch (error) {
				void vscode.window.showErrorMessage(`DOV: Could not rename Codex conversation: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
		vscode.commands.registerCommand(`${prefix}.newSidebarAgent`, () => withCodex(async () => {
			await vscode.commands.executeCommand('chatgpt.openSidebar');
			await vscode.commands.executeCommand('chatgpt.newChat');
		})),
		vscode.commands.registerCommand(`${prefix}.newAgent`, () => withCodex(async () => {
			await vscode.commands.executeCommand('chatgpt.newCodexPanel');
		})),
		vscode.commands.registerCommand(`${prefix}.openAgent`, (id: unknown) => withCodex(async () => {
			if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) { throw new Error('Invalid Codex thread ID.'); }
			await vscode.commands.executeCommand('chatgpt.openSidebar');
			// Codex's URI handler navigates its sidebar to this local conversation.
			// Verified against 26.901.22334; keep the internal route in this adapter.
			const uri = vscode.Uri.from({ scheme: vscode.env.uriScheme, authority: 'openai.chatgpt', path: `/local/${id}` });
			if (!await vscode.env.openExternal(uri)) {
				throw new Error('Could not switch the Codex sidebar to this conversation.');
			}
		})),
	);
	void refresh();
}
