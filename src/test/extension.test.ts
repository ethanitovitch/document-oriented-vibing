import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { extractApplyPatchInputs } from '../codex-session';
import { mergeReviewQueue } from '../extension';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	test('activates the extension and registers agent commands', async () => {
		const extension = vscode.extensions.getExtension('ethanitovitch.document-oriented-vibing');
		assert.ok(extension);
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		for (const name of ['newAgent', 'newSidebarAgent', 'openAgent', 'refreshAgents']) {
			assert.ok(commands.includes(`document-oriented-vibing.${name}`));
		}
	});

	test('extracts legacy apply_patch tool calls', () => {
		const patch = '*** Begin Patch\n*** Add File: src/example.ts\n+export {};\n*** End Patch';
		assert.deepStrictEqual(extractApplyPatchInputs({
			type: 'response_item',
			payload: { type: 'custom_tool_call', name: 'apply_patch', input: patch },
		}), [patch]);
	});

	test('extracts apply_patch payloads from the Codex exec wrapper', () => {
		const patch = '*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch';
		const execInput = `const patch = ${JSON.stringify(patch)};\ntext(await tools.apply_patch(patch));`;
		assert.deepStrictEqual(extractApplyPatchInputs({
			type: 'response_item',
			payload: { type: 'custom_tool_call', name: 'exec', input: execInput },
		}), [patch]);
	});

	test('does not execute or accept unrelated exec source', () => {
		assert.deepStrictEqual(extractApplyPatchInputs({
			type: 'response_item',
			payload: {
				type: 'custom_tool_call',
				name: 'exec',
				input: 'text(await tools.exec_command({ cmd: "echo safe" }));',
			},
		}), []);
	});

	test('keeps pending hunks and updates a revised hunk in place', () => {
		const first = { id: 'src/a.ts:10:1', filePath: 'src/a.ts', title: 'Hunk 1', startLine: 10, endLine: 10, oldLines: ['old'], newLines: ['first'], removedLines: ['old'], addedLines: ['first'], status: 'pending' as const };
		const untouched = { ...first, id: 'src/a.ts:30:2', startLine: 30, endLine: 30, oldLines: ['before'], newLines: ['keep'], removedLines: ['before'], addedLines: ['keep'] };
		const roundOne = mergeReviewQueue([], [{ path: 'src/a.ts', changes: [first, untouched] }], 1);
		const revised = { ...first, oldLines: ['first'], newLines: ['second'], removedLines: ['first'], addedLines: ['second'] };
		const roundTwo = mergeReviewQueue(roundOne, [{ path: 'src/a.ts', changes: [revised] }], 2);
		assert.strictEqual(roundTwo.length, 2);
		assert.strictEqual(roundTwo[0].id, roundOne[0].id);
		assert.deepStrictEqual(roundTwo[0].newLines, ['second']);
		assert.strictEqual(roundTwo[0].status, 'pending');
		assert.strictEqual(roundTwo[1].id, roundOne[1].id);
		assert.deepStrictEqual(roundTwo[1].newLines, ['keep']);
	});
});
