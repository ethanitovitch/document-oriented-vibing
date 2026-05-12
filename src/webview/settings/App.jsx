import React, { useEffect, useState } from 'react';

const vscode = typeof acquireVsCodeApi === 'function'
	? acquireVsCodeApi()
	: { postMessage: () => {} };

const palette = {
	bg: 'var(--vscode-editor-background, #f4f6fb)',
	surface: 'var(--vscode-sideBar-background, #ffffff)',
	surface2: 'var(--vscode-editorWidget-background, #f8faff)',
	text: 'var(--vscode-editor-foreground, #1b2331)',
	muted: 'var(--vscode-descriptionForeground, #5a667c)',
	border: 'var(--vscode-editorWidget-border, #d6dcea)',
	button: 'var(--vscode-button-background, #2f6fed)',
	buttonText: 'var(--vscode-button-foreground, #ffffff)',
};

export function SettingsApp() {
	const [statusText, setStatusText] = useState('Loading settings...');
	const [workspaceStoragePath, setWorkspaceStoragePath] = useState('N/A');
	const [globalStoragePath, setGlobalStoragePath] = useState('N/A');

	const openHome = () => {
		vscode.postMessage({ action: 'openHome' });
		setStatusText('Opening home...');
	};

	useEffect(() => {
		const handler = (event) => {
			const message = event.data;
			if (!message || message.action !== 'settingsState') {
				return;
			}
			setStatusText(typeof message.statusText === 'string' ? message.statusText : 'Ready.');
			setWorkspaceStoragePath(typeof message.workspaceStoragePath === 'string' ? message.workspaceStoragePath : 'N/A');
			setGlobalStoragePath(typeof message.globalStoragePath === 'string' ? message.globalStoragePath : 'N/A');
		};

		window.addEventListener('message', handler);
		vscode.postMessage({ action: 'ready' });
		return () => window.removeEventListener('message', handler);
	}, []);

	return (
		<div style={{
			background: palette.bg,
			color: palette.text,
			minHeight: '100vh',
			padding: 20,
			boxSizing: 'border-box',
			fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
			fontSize: 'var(--vscode-font-size, 13px)',
		}}>
			<div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 12 }}>
				<div style={panelStyle()}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
						<button style={backButtonStyle()} onClick={openHome} aria-label="Back to home">
							←
						</button>
						<h2 style={{ margin: 0 }}>Settings</h2>
					</div>
					<div style={{ color: palette.muted, fontSize: 13 }}>
						Use extension storage for persistent app data. Keep `.features` as an export/view layer if needed.
					</div>
				</div>

				<div style={panelStyle()}>
					<div style={{ fontSize: 12, color: palette.muted, marginBottom: 8 }}>Persistence locations</div>
					<div style={rowStyle()}>
						<strong style={{ minWidth: 180 }}>Workspace storage</strong>
						<code>{workspaceStoragePath}</code>
					</div>
					<div style={rowStyle()}>
						<strong style={{ minWidth: 180 }}>Global storage</strong>
						<code>{globalStoragePath}</code>
					</div>
				</div>

				<div style={panelStyle()}>
					<div style={{ fontSize: 12, color: palette.muted, marginBottom: 8 }}>Recommended strategy</div>
					<ul style={{ margin: 0, paddingLeft: 18 }}>
						<li>Use `workspaceStorage` for project graph/state (team/project specific).</li>
						<li>Use `globalStorage` for user preferences and caches.</li>
						<li>Use `globalState` / `workspaceState` for small key-value flags.</li>
					</ul>
				</div>

				<div style={{ fontSize: 12, color: palette.muted }}>{statusText}</div>
			</div>
		</div>
	);
}

function panelStyle() {
	return {
		background: palette.surface,
		border: `1px solid ${palette.border}`,
		borderRadius: 12,
		padding: 14,
	};
}

function rowStyle() {
	return {
		display: 'flex',
		gap: 10,
		alignItems: 'center',
		padding: '6px 0',
		color: palette.text,
	};
}

function backButtonStyle() {
	return {
		padding: 0,
		width: 32,
		height: 32,
		borderRadius: 8,
		border: '1px solid transparent',
		background: palette.button,
		color: palette.buttonText,
		cursor: 'pointer',
		fontSize: 18,
		lineHeight: '32px',
		textAlign: 'center',
	};
}
