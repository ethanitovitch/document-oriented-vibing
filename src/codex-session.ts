export interface CodexToolCallRecord {
	type?: string;
	payload?: {
		type?: string;
		name?: string;
		input?: string;
	};
}

/**
 * Returns apply_patch payloads from both legacy direct tool calls and the
 * newer Codex exec wrapper. Exec source is parsed as text and is never run.
 */
export function extractApplyPatchInputs(record: CodexToolCallRecord): string[] {
	if (
		record.type !== 'response_item' ||
		record.payload?.type !== 'custom_tool_call' ||
		typeof record.payload.input !== 'string'
	) {
		return [];
	}

	if (record.payload.name === 'apply_patch') {
		return [record.payload.input];
	}
	if (record.payload.name !== 'exec' || !record.payload.input.includes('tools.apply_patch')) {
		return [];
	}

	const patches = extractJavaScriptStringLiterals(record.payload.input)
		.filter((value) => value.includes('*** Begin Patch') && value.includes('*** End Patch'));
	return [...new Set(patches)];
}

function extractJavaScriptStringLiterals(source: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < source.length; index += 1) {
		const quote = source[index];
		if (quote !== '"' && quote !== "'" && quote !== '`') {
			continue;
		}
		const literal = readJavaScriptStringLiteral(source, index, quote);
		if (!literal) {
			continue;
		}
		values.push(literal.value);
		index = literal.endIndex;
	}
	return values;
}

function readJavaScriptStringLiteral(
	source: string,
	startIndex: number,
	quote: string,
): { value: string; endIndex: number } | undefined {
	let value = '';
	for (let index = startIndex + 1; index < source.length; index += 1) {
		const char = source[index];
		if (char === quote) {
			return { value, endIndex: index };
		}
		if (quote === '`' && char === '$' && source[index + 1] === '{') {
			return undefined;
		}
		if (char !== '\\') {
			value += char;
			continue;
		}

		const escaped = source[index + 1];
		if (escaped === undefined) {
			return undefined;
		}
		index += 1;
		if (escaped === '\n') {
			continue;
		}
		if (escaped === '\r') {
			if (source[index + 1] === '\n') {
				index += 1;
			}
			continue;
		}

		const simpleEscape: Record<string, string> = {
			b: '\b',
			f: '\f',
			n: '\n',
			r: '\r',
			t: '\t',
			v: '\v',
			0: '\0',
		};
		if (escaped in simpleEscape) {
			value += simpleEscape[escaped];
			continue;
		}
		if (escaped === 'x') {
			const hex = source.slice(index + 1, index + 3);
			if (!/^[0-9a-f]{2}$/i.test(hex)) {
				return undefined;
			}
			value += String.fromCodePoint(Number.parseInt(hex, 16));
			index += 2;
			continue;
		}
		if (escaped === 'u') {
			const unicode = readUnicodeEscape(source, index + 1);
			if (!unicode) {
				return undefined;
			}
			value += String.fromCodePoint(unicode.codePoint);
			index = unicode.endIndex;
			continue;
		}
		value += escaped;
	}
	return undefined;
}

function readUnicodeEscape(
	source: string,
	startIndex: number,
): { codePoint: number; endIndex: number } | undefined {
	if (source[startIndex] === '{') {
		const closeIndex = source.indexOf('}', startIndex + 1);
		if (closeIndex < 0) {
			return undefined;
		}
		const hex = source.slice(startIndex + 1, closeIndex);
		if (!/^[0-9a-f]{1,6}$/i.test(hex)) {
			return undefined;
		}
		const codePoint = Number.parseInt(hex, 16);
		return codePoint <= 0x10ffff ? { codePoint, endIndex: closeIndex } : undefined;
	}

	const hex = source.slice(startIndex, startIndex + 4);
	if (!/^[0-9a-f]{4}$/i.test(hex)) {
		return undefined;
	}
	return { codePoint: Number.parseInt(hex, 16), endIndex: startIndex + 3 };
}
