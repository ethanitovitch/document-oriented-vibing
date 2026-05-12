import React, { useCallback, useEffect, useRef, useState } from 'react';

const vscode = typeof acquireVsCodeApi === 'function'
	? acquireVsCodeApi()
	: { postMessage: () => {} };

function getMermaid() {
	return /** @type {any} */ (window).mermaid;
}

function isDarkTheme() {
	return (
		document.body.classList.contains('vscode-dark') ||
		document.body.classList.contains('vscode-high-contrast')
	);
}

const palette = {
	bg: 'var(--vscode-editor-background, #f4f6fb)',
	bgDark: 'var(--vscode-editor-background, #1e1e1e)',
	surface: 'var(--vscode-sideBar-background, #ffffff)',
	surfaceDark: 'var(--vscode-sideBar-background, #252526)',
	surface2: 'var(--vscode-editorWidget-background, #f8faff)',
	surface2Dark: 'var(--vscode-editorWidget-background, #2d2d2d)',
	text: 'var(--vscode-editor-foreground, #1b2331)',
	textDark: 'var(--vscode-editor-foreground, #d4d4d4)',
	muted: 'var(--vscode-descriptionForeground, #5a667c)',
	mutedDark: 'var(--vscode-descriptionForeground, #888)',
	border: 'var(--vscode-editorWidget-border, #d6dcea)',
	borderDark: 'var(--vscode-editorWidget-border, #3e3e42)',
	button: 'var(--vscode-button-background, #2f6fed)',
	buttonText: 'var(--vscode-button-foreground, #ffffff)',
	errorBg: 'var(--vscode-inputValidation-errorBackground, #fef2f2)',
	errorBorder: 'var(--vscode-inputValidation-errorBorder, #fecaca)',
	errorText: 'var(--vscode-inputValidation-errorForeground, #b91c1c)',
};

function p(dark, light, darkVal) { return dark ? darkVal : light; }

let mermaidThemeKey = '';
function ensureMermaidInit(forceDark) {
	const m = getMermaid();
	if (!m) return;
	const dark = typeof forceDark === 'boolean' ? forceDark : isDarkTheme();
	const nextThemeKey = dark ? 'dark' : 'light';
	if (mermaidThemeKey === nextThemeKey) return;

	const themeVariables = dark
		? {
			background: '#1e1e1e',
			primaryColor: '#2d2d2d',
			primaryTextColor: '#e5e7eb',
			primaryBorderColor: '#6b7280',
			lineColor: '#9ca3af',
			secondaryColor: '#252526',
			tertiaryColor: '#1f2937',
			textColor: '#e5e7eb',
		}
		: {
			background: '#ffffff',
			primaryColor: '#f8faff',
			primaryTextColor: '#1b2331',
			primaryBorderColor: '#93a3c5',
			lineColor: '#4b5b7e',
			secondaryColor: '#eef3ff',
			tertiaryColor: '#f1f5f9',
			textColor: '#1b2331',
		};
	m.initialize({
		startOnLoad: false,
		theme: 'base',
		themeVariables,
		securityLevel: 'loose',
		flowchart: { htmlLabels: true },
		fontFamily: 'system-ui, -apple-system, sans-serif',
	});
	mermaidThemeKey = nextThemeKey;
}

function extractMermaid(text) {
	const source = normalizeNewlines(getLatestFeatureSection(text));
	const matches = [...source.matchAll(/```mermaid[^\n]*\n([\s\S]*?)```/gi)];
	if (matches.length === 0) {
		return '';
	}
	// Prefer the last real diagram block (skip placeholders from docs/examples).
	for (let i = matches.length - 1; i >= 0; i -= 1) {
		const candidate = matches[i][1].trim();
		if (!candidate || candidate.includes('<any valid Mermaid diagram>')) {
			continue;
		}
		return candidate;
	}
	return matches[matches.length - 1][1].trim();
}

function extractTitle(text) {
	const source = normalizeNewlines(getLatestFeatureSection(text));
	const match = source.match(/^\s*#\s*Feature:\s*(.*)$/im);
	return match ? match[1].trim() : '';
}

function extractSummary(text) {
	const source = normalizeNewlines(getLatestFeatureSection(text));
	const match = source.match(/^\s*##\s*Summary\s*\n([\s\S]*?)(?=\n^\s*##\s+|$)/im);
	return match ? match[1].trim() : '';
}

function extractDetails(text) {
	const source = normalizeNewlines(getLatestFeatureSection(text));
	const match = source.match(/^\s*##\s*Details\s*\n([\s\S]*?)(?=\n^\s*##\s+|$)/im);
	if (!match) return new Map();
	const details = new Map();
	const lines = match[1].split('\n');
	for (const line of lines) {
		// Matches: "- **NodeName**: description" or "- NodeName: description" or "- NodeName — description"
		const m = line.match(/^\s*[-*]\s+\*{0,2}([^*:—]+?)\*{0,2}\s*[:—–]\s*(.+)/);
		if (m) {
			details.set(m[1].trim().toLowerCase(), m[2].trim());
		}
	}
	return details;
}

function getLatestFeatureSection(text) {
	const normalized = normalizeNewlines(text);
	const matches = [...normalized.matchAll(/^\s*#\s*Feature:.*$/gim)];
	if (matches.length === 0) {
		return normalized;
	}

	const last = matches[matches.length - 1];
	const start = last.index ?? 0;
	return normalized.slice(start);
}

function normalizeNewlines(text) {
	return text.replace(/\r\n?/g, '\n');
}

function normalizeMermaidInput(code) {
	// Keep source as-is to avoid transforming valid Mermaid into invalid Mermaid.
	return code;
}

function extractFilePaths(diagramCode) {
	const paths = new Map();
	const labelMatches = diagramCode.matchAll(/["']([\s\S]*?)["']/g);
	for (const m of labelMatches) {
		const parts = m[1].split(/\\n|<br\s*\/?>/g);
		for (const part of parts) {
			// Match path with optional :lineNumber suffix
			const pathMatch = part.match(/([\w./-]+\/[\w./-]+\.\w+)(?::(\d+))?/);
			if (pathMatch) {
				const filePath = pathMatch[1];
				const line = pathMatch[2] ? parseInt(pathMatch[2], 10) : undefined;
				paths.set(filePath, { filePath, line });
			}
		}
	}
	return paths;
}

function getOrCreateTooltip(container) {
	let tip = container.querySelector('#dov-tooltip');
	if (tip) return tip;
	tip = document.createElement('div');
	tip.id = 'dov-tooltip';
	Object.assign(tip.style, {
		position: 'absolute',
		pointerEvents: 'none',
		padding: '8px 12px',
		borderRadius: '8px',
		background: 'var(--dov-surface, #1e293b)',
		color: 'var(--dov-text, #e2e8f0)',
		border: '1px solid var(--dov-border, #334155)',
		fontSize: '12px',
		lineHeight: '1.5',
		maxWidth: '320px',
		boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
		zIndex: '9999',
		opacity: '0',
		transition: 'opacity 0.15s',
		whiteSpace: 'pre-wrap',
	});
	container.style.position = 'relative';
	container.appendChild(tip);
	return tip;
}

function attachClickHandlers(container, diagramCode, detailsMap) {
	const filePaths = extractFilePaths(diagramCode);

	const nodes = container.querySelectorAll('.node, .nodeLabel, [id*="flowchart-"], .label');
	const tooltip = detailsMap.size > 0 ? getOrCreateTooltip(container) : null;

	nodes.forEach((node) => {
		const text = node.textContent || '';
		const nodeEl = node.closest('.node') || node;

		if (nodeEl.dataset.dovLinked) return;

		// File click handling
		for (const [, entry] of filePaths) {
			const { filePath, line } = entry;
			const fileName = filePath.split('/').pop();
			const funcOrFile = filePath.replace(/\.\w+$/, '').split('/').pop();
			if (text.includes(filePath) || text.includes(fileName) || text.includes(funcOrFile)) {
				const lineLabel = line ? `:${line}` : '';
				node.style.cursor = 'pointer';
				node.title = `Open ${filePath}${lineLabel}`;
				nodeEl.dataset.dovLinked = 'true';
				nodeEl.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					vscode.postMessage({ action: 'openFile', filePath, line });
				});
				break;
			}
		}

		// Tooltip handling — match node text against details keys
		if (tooltip) {
			let matchedDetail = null;
			const textLower = text.toLowerCase();
			for (const [key, desc] of detailsMap) {
				if (textLower.includes(key)) {
					matchedDetail = desc;
					break;
				}
			}
			if (matchedDetail) {
				nodeEl.addEventListener('mouseenter', (e) => {
					tooltip.textContent = matchedDetail;
					tooltip.style.opacity = '1';
					const rect = nodeEl.getBoundingClientRect();
					const containerRect = container.getBoundingClientRect();
					tooltip.style.left = `${rect.left - containerRect.left + rect.width / 2}px`;
					tooltip.style.top = `${rect.top - containerRect.top - 8}px`;
					tooltip.style.transform = 'translate(-50%, -100%)';
				});
				nodeEl.addEventListener('mouseleave', () => {
					tooltip.style.opacity = '0';
				});
			}
		}
	});
}

// ---------------------------------------------------------------------------
// Mermaid preview
// ---------------------------------------------------------------------------

function MermaidPreview({ code, detailsMap }) {
	const containerRef = useRef(null);
	const wrapperRef = useRef(null);
	const [error, setError] = useState(null);
	const tokenRef = useRef(0);
	const retryRef = useRef(null);
	const retryCountRef = useRef(0);
	const zoomRef = useRef(1);

	useEffect(() => {
		const wrapper = wrapperRef.current;
		if (!wrapper) return;
		const onWheel = (e) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const scale = 1 - e.deltaY * 0.002;
			zoomRef.current = Math.min(5, Math.max(0.1, zoomRef.current * scale));
			const svgEl = wrapper.querySelector('svg');
			if (svgEl) {
				svgEl.style.transform = `scale(${zoomRef.current})`;
			}
		};
		wrapper.addEventListener('wheel', onWheel, { passive: false });
		return () => wrapper.removeEventListener('wheel', onWheel);
	}, []);

	const render = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;

		if (retryRef.current) {
			clearTimeout(retryRef.current);
			retryRef.current = null;
		}

		const trimmed = (code || '').trim();
		if (!trimmed) {
			container.innerHTML = '<p style="padding:20px;color:var(--dov-muted);font-style:italic;font-size:13px">No mermaid diagram found.</p>';
			setError(null);
			return;
		}
		const mermaidInput = normalizeMermaidInput(trimmed);

		const m = getMermaid();
		if (!m) {
			retryCountRef.current += 1;
			if (retryCountRef.current > 20) {
				setError('Mermaid runtime did not load in webview.');
				return;
			}
			retryRef.current = setTimeout(render, 300);
			return;
		}
		retryCountRef.current = 0;

		ensureMermaidInit(isDarkTheme());

		const token = ++tokenRef.current;
		const id = `mermaid-${token}`;

		m.render(id, mermaidInput)
			.then(({ svg }) => {
				if (tokenRef.current !== token) return;
				container.innerHTML = svg;
				const svgEl = container.querySelector('svg');
				if (svgEl) {
					svgEl.style.height = 'auto';
					svgEl.removeAttribute('width');
					svgEl.removeAttribute('height');
					svgEl.style.display = 'block';
					svgEl.style.transformOrigin = 'top left';
					svgEl.style.transform = `scale(${zoomRef.current})`;
				} else {
					setError('Diagram rendered with no SVG output.');
				}
				attachClickHandlers(container, trimmed, detailsMap || new Map());
				setError(null);
			})
			.catch(err => {
				if (tokenRef.current !== token) return;
				document.getElementById(id)?.remove();
				setError(String(err?.message || err || 'Diagram syntax error'));
			});
	}, [code, detailsMap]);

	useEffect(() => {
		render();
		return () => {
			if (retryRef.current) clearTimeout(retryRef.current);
		};
	}, [render]);

	return (
		<div ref={wrapperRef} style={{ height: '100%', overflow: 'auto' }}>
			{error && (
				<div style={{
					margin: '12px 16px 0',
					padding: '8px 12px',
					borderRadius: 6,
					background: palette.errorBg,
					border: `1px solid ${palette.errorBorder}`,
					color: palette.errorText,
					fontSize: 12,
					fontFamily: 'var(--vscode-editor-font-family, monospace)',
					whiteSpace: 'pre-wrap',
					lineHeight: 1.5,
				}}>
					{error}
				</div>
			)}
			<div ref={containerRef} style={{ padding: '20px 24px' }} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

export function FeatureApp() {
	const [dark, setDark] = useState(false);
	const [featureName, setFeatureName] = useState('');
	const [title, setTitle] = useState('');
	const [summary, setSummary] = useState('');
	const [details, setDetails] = useState(() => new Map());
	const [diagramCode, setDiagramCode] = useState('');

	useEffect(() => {
		setDark(isDarkTheme());
		ensureMermaidInit(isDarkTheme());
	}, []);

	useEffect(() => {
		const handler = (event) => {
			const msg = event.data;
			if (!msg || typeof msg !== 'object') return;

			if (msg.action === 'contentUpdate' && typeof msg.rawContent === 'string') {
				if (msg.featureName) setFeatureName(msg.featureName);
				setTitle(extractTitle(msg.rawContent));
				setSummary(extractSummary(msg.rawContent));
				setDetails(extractDetails(msg.rawContent));
				setDiagramCode(extractMermaid(msg.rawContent));
			}
		};

		window.addEventListener('message', handler);
		vscode.postMessage({ action: 'ready' });
		return () => window.removeEventListener('message', handler);
	}, []);

	const bg = dark ? palette.bgDark : palette.bg;
	const surface = dark ? palette.surfaceDark : palette.surface;
	const border = dark ? palette.borderDark : palette.border;
	const text = dark ? palette.textDark : palette.text;
	const muted = dark ? palette.mutedDark : palette.muted;

	const cssVars = {
		'--dov-bg': bg,
		'--dov-surface': surface,
		'--dov-border': border,
		'--dov-text': text,
		'--dov-muted': muted,
		'--dov-button': palette.button,
		'--dov-buttonText': palette.buttonText,
	};

	const displayName = featureName.replace(/\.md$/i, '').replace(/-/g, ' ');

	return (
		<div style={{
			height: '100vh',
			display: 'flex',
			flexDirection: 'column',
			background: bg,
			color: text,
			fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
			fontSize: 'var(--vscode-font-size, 13px)',
			overflow: 'hidden',
			...cssVars,
		}}>
			<div style={{ width: '100%', maxWidth: 1200, margin: '0 auto', padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
				{/* Header panel */}
				<div style={{
					background: surface,
					border: `1px solid ${border}`,
					borderRadius: 12,
					padding: '16px 20px',
					display: 'flex',
					alignItems: 'flex-start',
					gap: 16,
					flexShrink: 0,
				}}>
					<div style={{ flex: 1, minWidth: 0 }}>
						<h2 style={{
							margin: 0,
							fontSize: 18,
							fontWeight: 700,
							lineHeight: 1.3,
							textTransform: 'capitalize',
						}}>
							{title || displayName || 'Untitled Feature'}
						</h2>
						{summary && (
							<p style={{
								margin: '6px 0 0',
								fontSize: 13,
								lineHeight: 1.5,
								color: muted,
							}}>
								{summary}
							</p>
						)}
						{featureName && (
							<span style={{
								display: 'inline-block',
								marginTop: 8,
								fontSize: 11,
								color: muted,
								background: dark ? palette.surface2Dark : palette.surface2,
								padding: '2px 8px',
								borderRadius: 4,
								fontFamily: 'monospace',
							}}>
								.features/{featureName}
							</span>
						)}
					</div>
					<div style={{ flexShrink: 0 }}>
						<button
							onClick={() => vscode.postMessage({ action: 'editSource' })}
							style={{
								padding: '7px 14px',
								borderRadius: 8,
								border: '1px solid transparent',
								background: palette.button,
								color: palette.buttonText,
								cursor: 'pointer',
								fontSize: 13,
								fontWeight: 500,
								whiteSpace: 'nowrap',
							}}
						>
							Edit source
						</button>
					</div>
				</div>

				{/* Diagram area */}
				<div style={{ flex: 1, overflow: 'auto', marginTop: 12, minHeight: 200, background: surface, border: `1px solid ${border}`, borderRadius: 12 }}>
					<MermaidPreview code={diagramCode} detailsMap={details} />
				</div>
			</div>
		</div>
	);
}
