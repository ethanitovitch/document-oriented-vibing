import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createInterface } from 'readline';

export interface SessionRecord {
	type?: string;
	timestamp?: string;
	payload?: Record<string, unknown>;
}
export type AgentStatus = 'Working' | 'Finished' | 'Interrupted' | 'Unknown';
export interface AgentThread {
	id: string;
	cwd: string;
	title: string;
	model?: string;
	status: AgentStatus;
	updatedAt: number;
	file: string;
}
export function codexSessionsRoot(): string {
	return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
}
export function parseSessionLine(line: string): SessionRecord[] {
	try {
		const value = JSON.parse(line);
		return value && typeof value === 'object' && !Array.isArray(value) ? [value] : [];
	} catch { return []; }
}
export function sessionMetadata(records: SessionRecord[]): { id: string; cwd: string } | undefined {
	const meta = records.find(record => record.type === 'session_meta')?.payload;
	return typeof meta?.id === 'string' && typeof meta.cwd === 'string'
		? { id: meta.id, cwd: meta.cwd } : undefined;
}
export function isSubagentSession(records: SessionRecord[]): boolean {
	const source = records.find(record => record.type === 'session_meta')?.payload?.source;
	return source === 'subagent' || (
		typeof source === 'object' && source !== null && !Array.isArray(source) && 'subagent' in source
	);
}
export function updateThread(thread: AgentThread, record: SessionRecord): void {
	const payload = record.payload;
	if (!payload) { return; }
	if (record.type === 'turn_context' && typeof payload.model === 'string') {
		thread.model = payload.model;
	}
	if (record.type !== 'event_msg') { return; }
	if (payload.type === 'user_message' && typeof payload.message === 'string') {
		thread.title = payload.message.replace(/\s+/g, ' ').trim().slice(0, 100) || thread.title;
	}
	if (payload.type === 'task_started' || payload.type === 'turn_started') { thread.status = 'Working'; }
	if (payload.type === 'task_complete' || payload.type === 'turn_complete') { thread.status = 'Finished'; }
	if (payload.type === 'turn_aborted') { thread.status = 'Interrupted'; }
}
export function observedStatus(thread: AgentThread, now = Date.now()): AgentStatus {
	// A log cannot prove that a process is still alive or waiting for approval.
	return thread.status === 'Working' && now - thread.updatedAt > 10 * 60_000 ? 'Unknown' : thread.status;
}
async function sessionFiles(root: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(root, { withFileTypes: true });
		return (await Promise.all(entries.map(entry => entry.isDirectory()
			? sessionFiles(path.join(root, entry.name))
			: Promise.resolve(entry.isFile() && entry.name.endsWith('.jsonl') ? [path.join(root, entry.name)] : [])))).flat();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
		throw error;
	}
}
export class CodexThreadIndex {
	private cache = new Map<string, { stamp: string; thread?: AgentThread }>();
	async list(roots: string[]): Promise<AgentThread[]> {
		const files = await sessionFiles(codexSessionsRoot());
		const present = new Set(files);
		for (const file of this.cache.keys()) { if (!present.has(file)) { this.cache.delete(file); } }
		const threads: AgentThread[] = [];
		// Sequential streaming bounds memory even with very large rollout files.
		for (const file of files) {
			try {
				const stat = await fs.stat(file);
				const stamp = `${stat.mtimeMs}:${stat.size}:${roots.join('|')}`;
				let cached = this.cache.get(file);
				if (cached?.stamp !== stamp) {
					let thread: AgentThread | undefined;
					const stream = createReadStream(file, { encoding: 'utf8' });
					const lines = createInterface({ input: stream, crlfDelay: Infinity });
					try {
						for await (const line of lines) {
							const records = parseSessionLine(line);
							if (!thread) {
								const meta = sessionMetadata(records);
								if (!meta) { continue; }
								if (!roots.some(root => path.resolve(root) === path.resolve(meta.cwd))) { break; }
								if (isSubagentSession(records)) { break; }
								thread = { ...meta, file, title: 'Codex conversation', status: 'Unknown', updatedAt: stat.mtimeMs };
							}
							for (const record of records) { updateThread(thread, record); }
						}
					} finally { lines.close(); stream.destroy(); }
					cached = { stamp, thread };
					this.cache.set(file, cached);
				}
				if (cached.thread) { threads.push({ ...cached.thread, status: observedStatus(cached.thread) }); }
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
			}
		}
		return [...new Map(threads.sort((a, b) => a.updatedAt - b.updatedAt).map(thread => [thread.id, thread])).values()]
			.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
	}
}

export function userPromptTimes(records: SessionRecord[]): string[] {
	const events = records.filter(record => record.type === 'event_msg' && record.payload?.type === 'user_message');
	const prompts = events.length ? events : records.filter(record => record.type === 'response_item'
		&& record.payload?.type === 'message' && record.payload.role === 'user');
	return prompts.flatMap(record => typeof record.timestamp === 'string' ? [record.timestamp] : []);
}
