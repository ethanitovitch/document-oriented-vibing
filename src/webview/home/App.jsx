import React, { useEffect, useMemo, useRef, useState } from 'react';

const vscode = typeof acquireVsCodeApi === 'function'
	? acquireVsCodeApi()
	: { postMessage: () => {} };

const palette = {
	bg: '#f4f6fb',
	surface: '#ffffff',
	surface2: '#f8faff',
	text: '#1b2331',
	muted: '#5a667c',
	border: '#d6dcea',
	button: '#2f6fed',
	buttonText: '#ffffff',
};

export function HomeApp() {
	const [statusText, setStatusText] = useState('Loading...');
	const [features, setFeatures] = useState([]);
	const [selectedFeature, setSelectedFeature] = useState('');
	const [searchQuery, setSearchQuery] = useState('');
	const [listOpen, setListOpen] = useState(false);
	const [featuresFolderExists, setFeaturesFolderExists] = useState(false);
	const listRef = useRef(null);
	const [hasLlmInstructions, setHasLlmInstructions] = useState(true);

	useEffect(() => {
		const handler = (event) => {
			const message = event.data;
			if (!message || message.action !== 'homeState') {
				return;
			}
			if (typeof message.statusText === 'string') {
				setStatusText(message.statusText);
			}
			const nextFeatures = Array.isArray(message.features) ? message.features : [];
			setFeatures(nextFeatures);
			setFeaturesFolderExists(Boolean(message.featuresFolderExists));
			setHasLlmInstructions(Boolean(message.hasLlmInstructions));
			if (nextFeatures.length === 0) {
				setSelectedFeature('');
			} else if (!nextFeatures.includes(selectedFeature)) {
				setSelectedFeature(nextFeatures[0]);
			}
		};

		window.addEventListener('message', handler);
		vscode.postMessage({ action: 'ready' });
		return () => window.removeEventListener('message', handler);
	}, [selectedFeature]);

	const createFeaturesFolder = () => {
		vscode.postMessage({ action: 'createFeaturesFolder' });
		setStatusText('Creating .features folder...');
	};

	const refreshFeatures = () => {
		vscode.postMessage({ action: 'refreshFeatures' });
		setStatusText('Refreshing features list...');
	};

	const openNewFeature = () => {
		vscode.postMessage({ action: 'openNewFeature' });
		setStatusText('Creating default feature...');
	};

	const openFeature = () => {
		if (!selectedFeature) {
			setStatusText('Select a feature first.');
			return;
		}
		vscode.postMessage({ action: 'openFeature', featureName: selectedFeature });
		setStatusText(`Opening ${selectedFeature}...`);
	};

	const addLlmInstructions = () => {
		vscode.postMessage({ action: 'addLlmInstructions' });
		setStatusText('Adding instructions to CLAUDE.md...');
	};

	const filteredFeatures = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) {
			return features;
		}
		return features.filter((f) => f.toLowerCase().includes(q));
	}, [features, searchQuery]);

	const selectAndOpen = (name) => {
		setSelectedFeature(name);
		setSearchQuery(name);
		setListOpen(false);
		vscode.postMessage({ action: 'openFeature', featureName: name });
		setStatusText(`Opening ${name}...`);
	};

	useEffect(() => {
		if (!listOpen) {
			return;
		}
		const onDocClick = (e) => {
			if (listRef.current && !listRef.current.contains(e.target)) {
				setListOpen(false);
			}
		};
		document.addEventListener('pointerdown', onDocClick, true);
		return () => document.removeEventListener('pointerdown', onDocClick, true);
	}, [listOpen]);

	const openSettings = () => {
		vscode.postMessage({ action: 'openSettings' });
		setStatusText('Opening settings...');
	};

	return (
		<div style={{ background: palette.bg, color: palette.text, minHeight: '100vh', padding: 20, boxSizing: 'border-box' }}>
			<div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: 12 }}>
				<div style={panelStyle(palette)}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
						<h2 style={{ margin: 0 }}>Home</h2>
						<button style={buttonStyle(palette)} onClick={openSettings}>Settings</button>
					</div>

					<div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
						{!featuresFolderExists && (
							<button style={buttonStyle(palette)} onClick={createFeaturesFolder}>
								Create .features Folder
							</button>
						)}

						<div style={{ display: 'flex', gap: 8 }}>
							<button style={buttonStyle(palette)} onClick={openNewFeature}>New Feature</button>
							<button style={buttonStyle(palette)} onClick={refreshFeatures}>Refresh</button>
						</div>

						<div ref={listRef} style={{ position: 'relative' }}>
							<div style={{ display: 'flex', gap: 8 }}>
								<input
									style={inputStyle(palette)}
									type="text"
									value={searchQuery}
									placeholder={features.length === 0 ? 'No features found' : 'Search features…'}
									disabled={features.length === 0}
									autoComplete="off"
									spellCheck={false}
									onFocus={() => setListOpen(true)}
									onChange={(e) => {
										setSearchQuery(e.target.value);
										setListOpen(true);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter' && filteredFeatures.length > 0) {
											e.preventDefault();
											selectAndOpen(filteredFeatures[0]);
										}
										if (e.key === 'Escape') {
											setListOpen(false);
										}
									}}
								/>
								<button
									style={buttonStyle(palette)}
									onClick={openFeature}
									disabled={features.length === 0 || !selectedFeature}
								>
									Open
								</button>
							</div>
							{listOpen && filteredFeatures.length > 0 && (
								<ul style={{
									position: 'absolute',
									left: 0,
									right: 0,
									top: '100%',
									marginTop: 4,
									margin: '4px 0 0 0',
									padding: 0,
									listStyle: 'none',
									maxHeight: 200,
									overflowY: 'auto',
									borderRadius: 8,
									border: `1px solid ${palette.border}`,
									background: palette.surface,
									boxShadow: '0 4px 16px rgba(27, 35, 49, 0.12)',
									zIndex: 10,
								}} role="listbox">
									{filteredFeatures.map((f) => (
										<li
											key={f}
											role="option"
											aria-selected={f === selectedFeature}
											style={{
												padding: '8px 12px',
												fontSize: 13,
												cursor: 'pointer',
												background: f === selectedFeature ? palette.surface2 : 'transparent',
												borderBottom: `1px solid ${palette.border}`,
											}}
											onPointerDown={(e) => {
												e.preventDefault();
												selectAndOpen(f);
											}}
										>
											{f}
										</li>
									))}
								</ul>
							)}
							{listOpen && searchQuery.trim() && filteredFeatures.length === 0 && (
								<div style={{
									position: 'absolute',
									left: 0,
									right: 0,
									top: '100%',
									marginTop: 4,
									padding: '8px 12px',
									fontSize: 12,
									color: palette.muted,
									borderRadius: 8,
									border: `1px solid ${palette.border}`,
									background: palette.surface,
									boxShadow: '0 4px 16px rgba(27, 35, 49, 0.12)',
									zIndex: 10,
								}}>
									No matching features
								</div>
							)}
						</div>
					</div>
				</div>

				{!hasLlmInstructions && (
					<div style={{
						...panelStyle(palette),
						background: '#fffbe6',
						border: '1px solid #f0d060',
						display: 'grid',
						gap: 8,
					}}>
						<div style={{ fontWeight: 600, fontSize: 13 }}>LLM setup needed</div>
						<div style={{ fontSize: 12, color: palette.text, lineHeight: 1.5 }}>
							Your CLAUDE.md doesn't have the feature-graph schema yet. LLMs need this
							to know how to create <code>.features/*.md</code> files with the correct format,
							where to put them, and what fields are available.
						</div>
						<button style={buttonStyle(palette)} onClick={addLlmInstructions}>
							Add instructions to CLAUDE.md
						</button>
					</div>
				)}

				<div style={{ fontSize: 12, color: palette.muted }}>{statusText}</div>
			</div>
		</div>
	);
}

function panelStyle(palette) {
	return {
		background: palette.surface,
		border: `1px solid ${palette.border}`,
		borderRadius: 12,
		padding: 18,
	};
}

function buttonStyle(palette) {
	return {
		padding: '8px 12px',
		borderRadius: 8,
		border: '1px solid transparent',
		background: palette.button,
		color: palette.buttonText,
		cursor: 'pointer',
	};
}

function inputStyle(palette) {
	return {
		flex: 1,
		padding: '8px 10px',
		borderRadius: 8,
		border: `1px solid ${palette.border}`,
		background: palette.surface2,
		color: palette.text,
	};
}
