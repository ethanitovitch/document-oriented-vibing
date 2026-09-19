import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface, type Interface } from 'readline';

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: NodeJS.Timeout;
}

export interface NamedThread {
	id: string;
	name?: string;
}

export class CodexAppServer {
	private process?: ChildProcessWithoutNullStreams;
	private lines?: Interface;
	private ready?: Promise<void>;
	private nextId = 1;
	private readonly pending = new Map<number, PendingRequest>();

	constructor(private readonly binary: string) {}

	private send(method: string, params: Record<string, unknown>): Promise<unknown> {
		const process = this.process;
		if (!process || process.killed) {
			return Promise.reject(new Error('Codex app server is not running.'));
		}
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex app server timed out on ${method}.`));
			}, 15_000);
			this.pending.set(id, { resolve, reject, timer });
			process.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	}

	private handleLine(line: string): void {
		let message: { id?: unknown; result?: unknown; error?: { message?: string } };
		try { message = JSON.parse(line); } catch { return; }
		if (typeof message.id !== 'number') { return; }
		const request = this.pending.get(message.id);
		if (!request) { return; }
		clearTimeout(request.timer);
		this.pending.delete(message.id);
		if (message.error) { request.reject(new Error(message.error.message || 'Codex app server request failed.')); }
		else { request.resolve(message.result); }
	}

	private failAll(error: Error): void {
		for (const request of this.pending.values()) {
			clearTimeout(request.timer);
			request.reject(error);
		}
		this.pending.clear();
		this.lines?.close();
		this.lines = undefined;
		this.process = undefined;
		this.ready = undefined;
	}

	private async connect(): Promise<void> {
		const process = spawn(this.binary, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.process = process;
		process.stderr.resume();
		process.stdin.on('error', (error) => this.failAll(error));
		this.lines = createInterface({ input: process.stdout, crlfDelay: Infinity });
		this.lines.on('line', (line) => this.handleLine(line));
		process.on('error', (error) => this.failAll(error));
		process.on('exit', () => this.failAll(new Error('Codex app server stopped.')));
		await this.send('initialize', { clientInfo: { name: 'document_oriented_vibing', title: 'Document Oriented Vibing', version: '0.0.5' } });
		process.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
	}

	private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.ready ??= this.connect();
		await this.ready;
		return this.send(method, params);
	}

	async listNames(roots: string[], threadIds: string[]): Promise<Map<string, string>> {
		const wanted = new Set(threadIds);
		const names = new Map<string, string>();
		if (wanted.size === 0) { return names; }
		let cursor: string | null = null;
		do {
			const result = await this.request('thread/list', {
				cwd: roots,
				sourceKinds: ['cli', 'vscode'],
				limit: 100,
				cursor,
			}) as { data?: NamedThread[]; nextCursor?: string | null };
			for (const thread of result.data ?? []) {
				if (wanted.has(thread.id) && typeof thread.name === 'string' && thread.name.trim()) {
					names.set(thread.id, thread.name);
				}
				wanted.delete(thread.id);
			}
			cursor = result.nextCursor ?? null;
		} while (cursor && wanted.size > 0);
		return names;
	}

	async setName(threadId: string, name: string): Promise<void> {
		await this.request('thread/name/set', { threadId, name });
	}

	dispose(): void {
		this.process?.kill();
		this.failAll(new Error('Codex app server disposed.'));
	}
}
