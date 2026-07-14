import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { extractApplyPatchInputs } from '../codex-session';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
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
});
