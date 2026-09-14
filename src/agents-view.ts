import * as vscode from 'vscode';
import { AgentThread, CodexThreadIndex } from './codex-threads';

const prefix = 'document-oriented-vibing';
export function registerAgentsView(context: vscode.ExtensionContext): void {
	const index = new CodexThreadIndex();
	const changed = new vscode.EventEmitter<void>();
	let threads: AgentThread[] = [];
	let busy = false;
	let disposed = false;
	const provider: vscode.TreeDataProvider<AgentThread> = {
		onDidChangeTreeData: changed.event,
		getChildren: () => threads,
		getTreeItem: thread => {
			const item = new vscode.TreeItem(thread.title);
			item.id = thread.id;
			item.description = thread.status;
			item.tooltip = `${thread.title}\n${thread.status} (observed from local session log)\n${thread.model ?? 'Model unknown'}\n${thread.cwd}\n${thread.id}`;
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
			threads = await index.list((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
			if (disposed) { return; }
			setMessage(threads.length ? undefined : 'No local Codex conversations in this workspace yet.');
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
		...views, changed,
		{ dispose: () => { disposed = true; clearInterval(timer); } },
		...views.map(view => view.onDidChangeVisibility(event => { if (event.visible) { void refresh(); } })),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
		vscode.commands.registerCommand(`${prefix}.refreshAgents`, refresh),
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
