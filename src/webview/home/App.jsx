import React, { useEffect, useMemo, useRef, useState } from 'react';

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
	danger: 'var(--vscode-testing-iconFailed, #b91c1c)',
	warningBg: 'var(--vscode-inputValidation-warningBackground, #fffbe6)',
	warningBorder: 'var(--vscode-inputValidation-warningBorder, #f0d060)',
};

function normalizeFeature(feature) {
	if (typeof feature === 'string') {
		return { name: feature, ageLabel: '' };
	}
	if (feature && typeof feature.name === 'string') {
		return {
			name: feature.name,
			ageLabel: typeof feature.ageLabel === 'string' ? feature.ageLabel : '',
		};
	}
	return null;
}

function normalizeCodexThread(thread) {
	if (!thread || typeof thread.id !== 'string') {
		return null;
	}
	return {
		id: thread.id,
		title: typeof thread.title === 'string' && thread.title.trim() ? thread.title : thread.id,
		ageLabel: typeof thread.ageLabel === 'string' ? thread.ageLabel : '',
		changeCount: typeof thread.changeCount === 'number' ? thread.changeCount : 0,
	};
}

export function HomeApp() {
	const [statusText, setStatusText] = useState('Loading...');
	const [features, setFeatures] = useState([]);
	const [reviews, setReviews] = useState([]);
	const [codexThreads, setCodexThreads] = useState([]);
	const [selectedFeature, setSelectedFeature] = useState('');
	const [selectedReview, setSelectedReview] = useState('');
	const [selectedCodexThread, setSelectedCodexThread] = useState('');
	const [searchQuery, setSearchQuery] = useState('');
	const [reviewSearchQuery, setReviewSearchQuery] = useState('');
	const [threadSearchQuery, setThreadSearchQuery] = useState('');
	const [listOpen, setListOpen] = useState(false);
	const [reviewListOpen, setReviewListOpen] = useState(false);
	const [threadListOpen, setThreadListOpen] = useState(false);
	const [featuresFolderExists, setFeaturesFolderExists] = useState(false);
	const [reviewCount, setReviewCount] = useState(0);
	const listRef = useRef(null);
	const reviewListRef = useRef(null);
	const threadListRef = useRef(null);
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
			const nextFeatures = Array.isArray(message.features)
				? message.features.map(normalizeFeature).filter(Boolean)
				: [];
			const nextReviews = Array.isArray(message.reviews)
				? message.reviews.map(normalizeFeature).filter(Boolean)
				: [];
			const nextCodexThreads = Array.isArray(message.codexThreads)
				? message.codexThreads.map(normalizeCodexThread).filter(Boolean)
				: [];
			setFeatures(nextFeatures);
			setReviews(nextReviews);
			setCodexThreads(nextCodexThreads);
			setFeaturesFolderExists(Boolean(message.featuresFolderExists));
			setHasLlmInstructions(Boolean(message.hasLlmInstructions));
			setReviewCount(typeof message.reviewCount === 'number' ? message.reviewCount : 0);
			if (nextFeatures.length === 0) {
				setSelectedFeature('');
			} else if (!nextFeatures.some((feature) => feature.name === selectedFeature)) {
				setSelectedFeature(nextFeatures[0].name);
			}
			if (nextReviews.length === 0) {
				setSelectedReview('');
			} else if (!nextReviews.some((review) => review.name === selectedReview)) {
				setSelectedReview(nextReviews[0].name);
			}
			if (nextCodexThreads.length === 0) {
				setSelectedCodexThread('');
			} else if (!nextCodexThreads.some((thread) => thread.id === selectedCodexThread)) {
				setSelectedCodexThread(nextCodexThreads[0].id);
			}
		};

		window.addEventListener('message', handler);
		vscode.postMessage({ action: 'ready' });
		return () => window.removeEventListener('message', handler);
	}, [selectedFeature, selectedReview, selectedCodexThread]);

	const createFeaturesFolder = () => {
		vscode.postMessage({ action: 'createFeaturesFolder' });
		setStatusText('Creating .features folder...');
	};

	const refreshFeatures = () => {
		vscode.postMessage({ action: 'refreshFeatures' });
		setStatusText('Refreshing features list...');
	};

	const removeOldReviews = () => {
		vscode.postMessage({ action: 'removeOldReviews' });
		setStatusText('Removing old reviews...');
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

	const openReview = () => {
		if (!selectedReview) {
			setStatusText('Select a review first.');
			return;
		}
		vscode.postMessage({ action: 'openReview', reviewName: selectedReview });
		setStatusText(`Opening ${selectedReview}...`);
	};

	const captureReviewFromThread = () => {
		if (!selectedCodexThread) {
			setStatusText('Select a Codex thread first.');
			return;
		}
		vscode.postMessage({ action: 'captureReviewFromThread', threadId: selectedCodexThread });
		setStatusText('Capturing review from selected Codex thread...');
	};

	const addLlmInstructions = () => {
		vscode.postMessage({ action: 'addLlmInstructions' });
		setStatusText('Adding instructions and Codex skill...');
	};

	const filteredFeatures = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) {
			return features;
		}
		return features.filter((feature) => feature.name.toLowerCase().includes(q));
	}, [features, searchQuery]);

	const filteredReviews = useMemo(() => {
		const q = reviewSearchQuery.trim().toLowerCase();
		if (!q) {
			return reviews;
		}
		return reviews.filter((review) => review.name.toLowerCase().includes(q));
	}, [reviews, reviewSearchQuery]);

	const filteredCodexThreads = useMemo(() => {
		const q = threadSearchQuery.trim().toLowerCase();
		if (!q) {
			return codexThreads;
		}
		return codexThreads.filter((thread) => (
			thread.title.toLowerCase().includes(q) ||
			thread.id.toLowerCase().includes(q)
		));
	}, [codexThreads, threadSearchQuery]);

	const selectAndOpen = (feature) => {
		const name = typeof feature === 'string' ? feature : feature.name;
		setSelectedFeature(name);
		setSearchQuery(name);
		setListOpen(false);
		vscode.postMessage({ action: 'openFeature', featureName: name });
		setStatusText(`Opening ${name}...`);
	};

	const selectReviewAndOpen = (review) => {
		const name = typeof review === 'string' ? review : review.name;
		setSelectedReview(name);
		setReviewSearchQuery(name);
		setReviewListOpen(false);
		vscode.postMessage({ action: 'openReview', reviewName: name });
		setStatusText(`Opening ${name}...`);
	};

	const selectCodexThread = (thread) => {
		const id = typeof thread === 'string' ? thread : thread.id;
		const title = typeof thread === 'string' ? thread : thread.title;
		setSelectedCodexThread(id);
		setThreadSearchQuery(title);
		setThreadListOpen(false);
	};

	useEffect(() => {
		if (!listOpen && !reviewListOpen && !threadListOpen) {
			return;
		}
		const onDocClick = (e) => {
			if (listRef.current && !listRef.current.contains(e.target)) {
				setListOpen(false);
			}
			if (reviewListRef.current && !reviewListRef.current.contains(e.target)) {
				setReviewListOpen(false);
			}
			if (threadListRef.current && !threadListRef.current.contains(e.target)) {
				setThreadListOpen(false);
			}
		};
		document.addEventListener('pointerdown', onDocClick, true);
		return () => document.removeEventListener('pointerdown', onDocClick, true);
	}, [listOpen, reviewListOpen, threadListOpen]);

	const openSettings = () => {
		vscode.postMessage({ action: 'openSettings' });
		setStatusText('Opening settings...');
	};

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
							<button
								style={dangerButtonStyle(palette, reviewCount === 0)}
								onClick={removeOldReviews}
								disabled={reviewCount === 0}
								title={reviewCount === 0 ? 'No old reviews to remove' : `Remove ${reviewCount} old review artifact${reviewCount === 1 ? '' : 's'}`}
							>
								Remove Old Reviews
							</button>
						</div>

						<div ref={listRef} style={{ position: 'relative' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
								<div style={{ fontSize: 12, fontWeight: 700, color: palette.text }}>
									Feature conversations
								</div>
								<div style={{ fontSize: 12, color: palette.muted }}>
									Newest first
								</div>
							</div>
							<div style={{ display: 'flex', gap: 8 }}>
								<input
									style={inputStyle(palette)}
									type="text"
									value={searchQuery}
									placeholder={features.length === 0 ? 'No features found' : 'Search old conversations...'}
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
									{filteredFeatures.map((feature) => (
										<li
											key={feature.name}
											role="option"
											aria-selected={feature.name === selectedFeature}
											style={{
												padding: '8px 12px',
												fontSize: 13,
												cursor: 'pointer',
												background: feature.name === selectedFeature ? palette.surface2 : 'transparent',
												borderBottom: `1px solid ${palette.border}`,
											}}
											onPointerDown={(e) => {
												e.preventDefault();
												selectAndOpen(feature);
											}}
										>
											<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
												<span style={{
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
												}}>
													{feature.name}
												</span>
												{feature.ageLabel && (
													<span style={{
														flex: '0 0 auto',
														fontSize: 12,
														color: palette.muted,
													}}>
														{feature.ageLabel}
													</span>
												)}
											</div>
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

						<div ref={threadListRef} style={{ position: 'relative' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
								<div style={{ fontSize: 12, fontWeight: 700, color: palette.text }}>
									Previous Codex threads
								</div>
								<div style={{ fontSize: 12, color: palette.muted }}>
									With code changes
								</div>
							</div>
							<div style={{ display: 'flex', gap: 8 }}>
								<input
									style={inputStyle(palette)}
									type="text"
									value={threadSearchQuery}
									placeholder={codexThreads.length === 0 ? 'No Codex threads with code changes found' : 'Search Codex threads...'}
									disabled={codexThreads.length === 0}
									autoComplete="off"
									spellCheck={false}
									onFocus={() => setThreadListOpen(true)}
									onChange={(e) => {
										setThreadSearchQuery(e.target.value);
										setThreadListOpen(true);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter' && filteredCodexThreads.length > 0) {
											e.preventDefault();
											selectCodexThread(filteredCodexThreads[0]);
										}
										if (e.key === 'Escape') {
											setThreadListOpen(false);
										}
									}}
								/>
								<button
									style={buttonStyle(palette)}
									onClick={captureReviewFromThread}
									disabled={codexThreads.length === 0 || !selectedCodexThread}
								>
									Capture Review
								</button>
							</div>
							{threadListOpen && filteredCodexThreads.length > 0 && (
								<ul style={{
									position: 'absolute',
									left: 0,
									right: 0,
									top: '100%',
									marginTop: 4,
									margin: '4px 0 0 0',
									padding: 0,
									listStyle: 'none',
									maxHeight: 220,
									overflowY: 'auto',
									borderRadius: 8,
									border: `1px solid ${palette.border}`,
									background: palette.surface,
									boxShadow: '0 4px 16px rgba(27, 35, 49, 0.12)',
									zIndex: 10,
								}} role="listbox">
									{filteredCodexThreads.map((thread) => (
										<li
											key={thread.id}
											role="option"
											aria-selected={thread.id === selectedCodexThread}
											style={{
												padding: '8px 12px',
												fontSize: 13,
												cursor: 'pointer',
												background: thread.id === selectedCodexThread ? palette.surface2 : 'transparent',
												borderBottom: `1px solid ${palette.border}`,
											}}
											onPointerDown={(e) => {
												e.preventDefault();
												selectCodexThread(thread);
											}}
										>
											<div style={{ display: 'grid', gap: 3 }}>
												<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
													<span style={{
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
													}}>
														{thread.title}
													</span>
													{thread.ageLabel && (
														<span style={{
															flex: '0 0 auto',
															fontSize: 12,
															color: palette.muted,
														}}>
															{thread.ageLabel}
														</span>
													)}
												</div>
												<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12, color: palette.muted }}>
													<span style={{
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
													}}>
														{thread.id}
													</span>
													<span style={{ flex: '0 0 auto' }}>
														{thread.changeCount} changed file{thread.changeCount === 1 ? '' : 's'}
													</span>
												</div>
											</div>
										</li>
									))}
								</ul>
							)}
							{threadListOpen && threadSearchQuery.trim() && filteredCodexThreads.length === 0 && (
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
									No matching Codex threads
								</div>
							)}
						</div>

						<div ref={reviewListRef} style={{ position: 'relative' }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
								<div style={{ fontSize: 12, fontWeight: 700, color: palette.text }}>
									Old reviews
								</div>
								<div style={{ fontSize: 12, color: palette.muted }}>
									Recently updated
								</div>
							</div>
							<div style={{ display: 'flex', gap: 8 }}>
								<input
									style={inputStyle(palette)}
									type="text"
									value={reviewSearchQuery}
									placeholder={reviews.length === 0 ? 'No reviews found' : 'Search old reviews...'}
									disabled={reviews.length === 0}
									autoComplete="off"
									spellCheck={false}
									onFocus={() => setReviewListOpen(true)}
									onChange={(e) => {
										setReviewSearchQuery(e.target.value);
										setReviewListOpen(true);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter' && filteredReviews.length > 0) {
											e.preventDefault();
											selectReviewAndOpen(filteredReviews[0]);
										}
										if (e.key === 'Escape') {
											setReviewListOpen(false);
										}
									}}
								/>
								<button
									style={buttonStyle(palette)}
									onClick={openReview}
									disabled={reviews.length === 0 || !selectedReview}
								>
									Open
								</button>
							</div>
							{reviewListOpen && filteredReviews.length > 0 && (
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
									{filteredReviews.map((review) => (
										<li
											key={review.name}
											role="option"
											aria-selected={review.name === selectedReview}
											style={{
												padding: '8px 12px',
												fontSize: 13,
												cursor: 'pointer',
												background: review.name === selectedReview ? palette.surface2 : 'transparent',
												borderBottom: `1px solid ${palette.border}`,
											}}
											onPointerDown={(e) => {
												e.preventDefault();
												selectReviewAndOpen(review);
											}}
										>
											<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
												<span style={{
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
												}}>
													{review.name}
												</span>
												{review.ageLabel && (
													<span style={{
														flex: '0 0 auto',
														fontSize: 12,
														color: palette.muted,
													}}>
														{review.ageLabel}
													</span>
												)}
											</div>
										</li>
									))}
								</ul>
							)}
							{reviewListOpen && reviewSearchQuery.trim() && filteredReviews.length === 0 && (
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
									No matching reviews
								</div>
							)}
						</div>
					</div>
				</div>

				{!hasLlmInstructions && (
					<div style={{
						...panelStyle(palette),
						background: palette.warningBg,
						border: `1px solid ${palette.warningBorder}`,
						display: 'grid',
						gap: 8,
					}}>
						<div style={{ fontWeight: 600, fontSize: 13 }}>LLM setup needed</div>
						<div style={{ fontSize: 12, color: palette.text, lineHeight: 1.5 }}>
							Your LLM setup is missing the feature-graph schema or Codex skill. LLMs need this
							to know how to create <code>.features/*.md</code> files with the correct format,
							where to put them, and what fields are available.
						</div>
						<button style={buttonStyle(palette)} onClick={addLlmInstructions}>
							Add instructions and Codex skill
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

function dangerButtonStyle(palette, disabled = false) {
	return {
		...buttonStyle(palette),
		background: palette.danger,
		opacity: disabled ? 0.45 : 1,
		cursor: disabled ? 'not-allowed' : 'pointer',
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
