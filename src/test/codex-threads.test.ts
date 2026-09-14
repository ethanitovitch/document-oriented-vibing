import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentThread, CodexThreadIndex, observedStatus, parseSessionLine, sessionMetadata, updateThread, userPromptTimes } from '../codex-threads';
import { extractApplyPatchInputs } from '../codex-session';

suite('Codex session compatibility', () => {
	test('reads current nested metadata and ignores partial or null records', () => {
		assert.deepStrictEqual(sessionMetadata([{ type: 'session_meta', payload: { id: 'thread-1', cwd: '/repo' } }]), { id: 'thread-1', cwd: '/repo' });
		for (const input of ['null', '[1]', '{"type":', '']) { assert.deepStrictEqual(parseSessionLine(input), []); }
	});
	test('uses real prompt events instead of injected context messages', () => {
		assert.deepStrictEqual(userPromptTimes([
			{ timestamp: '1', type: 'event_msg', payload: { type: 'user_message' } },
			{ timestamp: '2', type: 'response_item', payload: { type: 'message', role: 'user' } },
		]), ['1']);
		assert.deepStrictEqual(userPromptTimes([{ timestamp: '2', type: 'response_item', payload: { type: 'message', role: 'user' } }]), ['2']);
	});
	test('tracks lifecycle, model and latest prompt without claiming stale sessions are live', () => {
		const thread: AgentThread = { id: 'id', cwd: '/repo', title: '', status: 'Unknown', updatedAt: 0, file: '' };
		updateThread(thread, { type: 'event_msg', payload: { type: 'task_started' } });
		assert.strictEqual(thread.status, 'Working');
		assert.strictEqual(observedStatus(thread, 600_001), 'Unknown');
		updateThread(thread, { type: 'turn_context', payload: { model: 'future-model' } });
		updateThread(thread, { type: 'event_msg', payload: { type: 'user_message', message: 'Fix\n this' } });
		assert.strictEqual(thread.title, 'Fix this');
		assert.strictEqual(thread.model, 'future-model');
		updateThread(thread, { type: 'event_msg', payload: { type: 'task_complete' } });
		assert.strictEqual(observedStatus(thread), 'Finished');
		updateThread(thread, { type: 'event_msg', payload: { type: 'turn_aborted' } });
		assert.strictEqual(thread.status, 'Interrupted');
	});
	test('accepts namespaced and JSON argument tools without executing source', () => {
		const patch = '*** Begin Patch\n*** Add File: a.ts\n+hello\n*** End Patch';
		for (const payload of [
			{ type: 'custom_tool_call', name: 'functions.apply_patch', input: patch },
			{ type: 'function_call', name: 'apply_patch', arguments: JSON.stringify({ patch }) },
			{ type: 'function_call', name: 'functions.exec', arguments: JSON.stringify({ code: `text(await tools.apply_patch(${JSON.stringify(patch)}));` }) },
		]) { assert.deepStrictEqual(extractApplyPatchInputs({ type: 'response_item', payload }), [patch]); }
		assert.deepStrictEqual(extractApplyPatchInputs({ type: 'response_item', payload: { type: 'function_call', name: 'apply_patch', arguments: '{' } }), []);
	});
	test('indexes only workspace threads, refreshes appends and removes deleted logs', async () => {
		const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dov-sessions-'));
		const previous = process.env.CODEX_HOME;
		process.env.CODEX_HOME = home;
		try {
			await fs.mkdir(path.join(home, 'sessions'));
			const line = (value: unknown) => JSON.stringify(value) + '\n';
			const file = path.join(home, 'sessions', 'rollout-thread.jsonl');
			await fs.writeFile(file, line({ type: 'session_meta', payload: { id: 'thread', cwd: '/repo' } }) + line({ type: 'event_msg', payload: { type: 'user_message', message: 'No edits yet' } }));
			await fs.writeFile(path.join(home, 'sessions', 'other.jsonl'), line({ type: 'session_meta', payload: { id: 'other', cwd: '/different' } }));
			const index = new CodexThreadIndex();
			let threads = await index.list(['/repo']);
			assert.deepStrictEqual(threads.map(thread => thread.id), ['thread']);
			assert.strictEqual(threads[0].title, 'No edits yet');
			await fs.appendFile(file, line({ type: 'event_msg', payload: { type: 'task_complete' } }));
			threads = await index.list(['/repo']);
			assert.strictEqual(threads[0].status, 'Finished');
			assert.deepStrictEqual((await index.list(['/different'])).map(thread => thread.id), ['other']);
			await fs.unlink(file);
			assert.deepStrictEqual(await index.list(['/repo']), []);
		} finally {
			if (previous === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = previous; }
			await fs.rm(home, { recursive: true, force: true });
		}
	});
});
