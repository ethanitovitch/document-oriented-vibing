import React, { useEffect, useMemo, useState } from 'react';
import { createHighlighter, createJavaScriptRegexEngine } from 'shiki';

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
	success: 'var(--vscode-testing-iconPassed, #15803d)',
	danger: 'var(--vscode-testing-iconFailed, #b91c1c)',
	warn: 'var(--vscode-testing-iconQueued, #9a6700)',
};

let shikiHighlighterPromise;

function getShikiTheme() {
	return document.body.classList.contains('vscode-light') ? 'light-plus' : 'dark-plus';
}

function getShikiHighlighter() {
	shikiHighlighterPromise ??= createHighlighter({
		themes: ['dark-plus', 'light-plus'],
		langs: ['typescript', 'javascript'],
		engine: createJavaScriptRegexEngine(),
	});
	return shikiHighlighterPromise;
}

export function ReviewApp() {
	const [reviewName, setReviewName] = useState('');
	const [rawContent, setRawContent] = useState('');
	const [diffFiles, setDiffFiles] = useState([]);
	const [statePath, setStatePath] = useState('');
	const [selectedPath, setSelectedPath] = useState('');
	const [selectedChangeId, setSelectedChangeId] = useState('');
	const [expandedHunks, setExpandedHunks] = useState({});
	const [expandedDiffFiles, setExpandedDiffFiles] = useState({});
	const [statusText, setStatusText] = useState('Loading review...');
	const isDiffReview = reviewName.toLowerCase().endsWith('.diff');

	const parsed = useMemo(() => {
		if (isDiffReview) {
			return { review: { version: 1, files: [] }, error: '' };
		}
		if (!rawContent.trim()) {
			return { review: { version: 1, files: [] }, error: '' };
		}
		try {
			return { review: JSON.parse(rawContent), error: '' };
		} catch (err) {
			return {
				review: { version: 1, title: 'Invalid review', files: [] },
				error: String(err?.message || err || 'Invalid JSON'),
			};
		}
	}, [rawContent, isDiffReview]);
	const review = parsed.review;
	const parseError = parsed.error;

	const files = isDiffReview ? [] : Array.isArray(review.files) ? review.files : [];
	const selectedFile = files.find((file) => file.path === selectedPath) || files[0];
	const selectedChanges = getChanges(selectedFile);
	const selectedChange = selectedChanges.find((change, index) => getChangeId(change, index) === selectedChangeId)
		|| selectedChanges[0];

	const totals = useMemo(() => getTotals(files), [files]);

	useEffect(() => {
		const handler = (event) => {
			const message = event.data;
			if (!message || message.action !== 'reviewUpdate') {
				return;
			}
			const nextReviewName = typeof message.reviewName === 'string' ? message.reviewName : '';
			const nextRaw = typeof message.rawContent === 'string' ? message.rawContent : '';
			setReviewName(nextReviewName);
			setRawContent(nextRaw);
			setDiffFiles(Array.isArray(message.diffFiles) ? message.diffFiles : []);
			setStatePath(typeof message.statePath === 'string' ? message.statePath : '');
			setStatusText('Ready.');
		};

		window.addEventListener('message', handler);
		vscode.postMessage({ action: 'ready' });
		return () => window.removeEventListener('message', handler);
	}, []);

	useEffect(() => {
		if (!selectedPath && files[0]?.path) {
			setSelectedPath(files[0].path);
		}
	}, [files, selectedPath]);

	useEffect(() => {
		if (!selectedFile?.path) {
			return;
		}
		if (selectedChange) {
			const id = getChangeId(selectedChange, selectedChanges.indexOf(selectedChange));
			vscode.postMessage({ action: 'selectChange', filePath: selectedFile.path, changeId: id });
		} else {
			vscode.postMessage({ action: 'openFile', filePath: selectedFile.path });
		}
	}, [selectedFile, selectedChange, selectedChanges]);

	const chooseFile = (file) => {
		if (!file?.path) {
			return;
		}
		setSelectedPath(file.path);
		const firstChange = getChanges(file)[0];
		setSelectedChangeId(firstChange ? getChangeId(firstChange, 0) : '');
		setStatusText(`Opened ${file.path}.`);
	};

	const chooseChange = (change, index) => {
		if (!selectedFile?.path) {
			return;
		}
		const id = getChangeId(change, index);
		setSelectedChangeId(id);
		vscode.postMessage({ action: 'selectChange', filePath: selectedFile.path, changeId: id });
		setStatusText(`Selected ${change.title || id}.`);
	};

	const approveChange = (change, index, filePath = selectedFile?.path) => {
		if (!filePath) {
			return;
		}
		const id = getChangeId(change, index);
		vscode.postMessage({ action: 'approveChange', filePath, changeId: id });
		setStatusText(`Approving ${change.title || id}...`);
	};

	const rejectChange = (change, index, filePath = selectedFile?.path) => {
		if (!filePath) {
			return;
		}
		const id = getChangeId(change, index);
		vscode.postMessage({ action: 'rejectChange', filePath, changeId: id });
		setStatusText(`Rejecting ${change.title || id}...`);
	};

	const undoChange = (change, index, filePath = selectedFile?.path) => {
		if (!filePath) {
			return;
		}
		const id = getChangeId(change, index);
		vscode.postMessage({ action: 'undoChange', filePath, changeId: id });
		setStatusText(`Undoing review state for ${change.title || id}...`);
	};

	const approveFile = () => {
		if (!selectedFile?.path) {
			return;
		}
		vscode.postMessage({ action: 'approveFile', filePath: selectedFile.path });
		setStatusText(`Accepting pending changes in ${selectedFile.path}...`);
	};

	const approveAll = () => {
		vscode.postMessage({ action: 'approveAll' });
		setStatusText('Accepting all pending changes...');
	};

	const rejectAll = () => {
		vscode.postMessage({ action: 'rejectAll' });
		setStatusText('Rejecting all pending changes...');
	};

	const completeReview = () => {
		vscode.postMessage({ action: 'completeReview' });
		setStatusText('Completing review...');
	};
	const copyReviewText = (text, label) => {
		vscode.postMessage({ action: 'copyText', text });
		setStatusText(`Copied ${label}.`);
	};

	if (isDiffReview) {
		const diffTotals = getDiffTotals(diffFiles);
		const allReviewed = diffFiles.length > 0 && diffTotals.pending === 0;
		const openDiffFile = (file) => {
			const firstChange = getChanges(file)[0];
			vscode.postMessage({
				action: firstChange ? 'selectChange' : 'openFile',
				filePath: file.path,
				changeId: firstChange?.id,
			});
			setStatusText(`Opened ${file.path}.`);
		};
		const openDiffHunk = (file, change) => {
			vscode.postMessage({ action: 'selectChange', filePath: file.path, changeId: change.id });
			setStatusText(`Opened ${file.path} lines ${change.startLine}-${change.endLine}.`);
		};
		const approveAllDiffChanges = () => {
			vscode.postMessage({ action: 'approveAll' });
			setStatusText('Approving all pending changes...');
		};
		const rejectAllDiffChanges = () => {
			vscode.postMessage({ action: 'rejectAll' });
			setStatusText('Rejecting all pending changes...');
		};
		const undoAllDiffChanges = () => {
			vscode.postMessage({ action: 'undoAll' });
			setStatusText('Undoing all review states...');
		};
		const approveDiffFile = (file) => {
			vscode.postMessage({ action: 'approveFile', filePath: file.path });
			setStatusText(`Approving changes in ${file.path}...`);
		};
		const rejectDiffFile = (file) => {
			vscode.postMessage({ action: 'rejectFile', filePath: file.path });
			setStatusText(`Rejecting changes in ${file.path}...`);
		};
		const undoDiffFile = (file) => {
			vscode.postMessage({ action: 'undoFile', filePath: file.path });
			setStatusText(`Undoing review states in ${file.path}...`);
		};
		const toggleDiffHunk = (changeId) => {
			setExpandedHunks((current) => ({
				...current,
				[changeId]: !current[changeId],
			}));
		};
		const toggleDiffFileHunks = (file) => {
			setExpandedDiffFiles((current) => {
				const nextExpanded = !current[file.path];
				setStatusText(`${nextExpanded ? 'Expanded' : 'Collapsed'} hunks in ${file.path}.`);
				return {
					...current,
					[file.path]: nextExpanded,
				};
			});
		};
		const copyDiffFile = (file) => {
			copyReviewText(formatFileForLlm(file), `changes for ${file.path}`);
		};
		const copyDiffHunk = (file, change, index) => {
			copyReviewText(formatHunkForLlm(file, change, index), `${file.path} hunk ${index + 1}`);
		};

		return (
			<div style={{
				background: palette.bg,
				color: palette.text,
				minHeight: '100vh',
				padding: 16,
				boxSizing: 'border-box',
				fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
				fontSize: 'var(--vscode-font-size, 13px)',
			}}>
				<main style={{ display: 'grid', gap: 12, maxWidth: 980, margin: '0 auto' }}>
					<section style={panelStyle()}>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
							<div>
								<div style={{ fontSize: 12, color: palette.muted }}>{reviewName || 'Review'}</div>
								<h1 style={{ margin: '4px 0 0', fontSize: 20 }}>Changed Files</h1>
							</div>
							<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
								<div style={{ fontSize: 12, color: palette.muted, whiteSpace: 'nowrap' }}>
									{diffFiles.length} files · {diffTotals.pending} pending · {diffTotals.approved} approved · {diffTotals.rejected} rejected
								</div>
								{(diffTotals.pending > 0 || diffTotals.rejected > 0) && (
									<button style={approveButtonStyle()} onClick={approveAllDiffChanges}>
										Approve All
									</button>
								)}
								{diffTotals.pending > 0 && (
									<button style={dangerButtonStyle()} onClick={rejectAllDiffChanges}>
										Reject All
									</button>
								)}
								{(diffTotals.approved > 0 || diffTotals.rejected > 0) && (
									<button style={secondaryButtonStyle()} onClick={undoAllDiffChanges}>
										Undo All
									</button>
								)}
								<button
									style={dangerButtonStyle(diffTotals.pending > 0)}
									disabled={diffTotals.pending > 0}
									onClick={completeReview}
								>
									Complete
								</button>
							</div>
						</div>
						{statePath && (
							<div style={{ marginTop: 8, fontSize: 11, color: palette.muted, overflowWrap: 'anywhere' }}>
								State: {statePath}
							</div>
						)}
						{allReviewed && (
							<div style={completeBannerStyle()}>
								All files reviewed
							</div>
						)}
					</section>

					<section style={{ display: 'grid', gap: 10 }}>
						{diffFiles.map((file) => {
							const changes = getChanges(file);
							const fileTotals = getTotals([file]);
							const fileExpanded = Boolean(expandedDiffFiles[file.path]);
							const visibleChanges = fileExpanded ? changes : changes.slice(0, 4);
							return (
								<article key={file.path} style={panelStyle()}>
									<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'start' }}>
										<div>
											<h2 style={{ margin: 0, fontSize: 15, overflowWrap: 'anywhere' }}>{file.path}</h2>
											<div style={{ marginTop: 6, fontSize: 12, color: palette.muted }}>
												{changes.length} hunks · {fileTotals.pending} pending · {fileTotals.approved} approved · {fileTotals.rejected} rejected
											</div>
										</div>
										<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'end' }}>
											<button style={secondaryButtonStyle()} onClick={() => copyDiffFile(file)}>Copy File</button>
											{fileTotals.pending > 0 && (
												<>
													<button style={approveButtonStyle()} onClick={() => approveDiffFile(file)}>Approve File</button>
													<button style={dangerButtonStyle()} onClick={() => rejectDiffFile(file)}>Reject File</button>
												</>
											)}
											{(fileTotals.approved > 0 || fileTotals.rejected > 0) && (
												<button style={secondaryButtonStyle()} onClick={() => undoDiffFile(file)}>Undo File</button>
											)}
											<button style={buttonStyle()} onClick={() => openDiffFile(file)}>Open File</button>
										</div>
									</div>
									<div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
										{visibleChanges.map((change, index) => {
											const status = getStatus(change);
											return (
											<div
												key={change.id}
												style={previewRowStyle()}
												onClick={() => openDiffHunk(file, change)}
												onKeyDown={(event) => {
													if (event.key === 'Enter' || event.key === ' ') {
														openDiffHunk(file, change);
													}
												}}
												role="button"
												tabIndex={0}
											>
												<span>Lines {change.startLine}-{change.endLine}</span>
												<span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
													{change.title || 'Changed hunk'}
												</span>
												<span style={statusStyle(status)}>{status}</span>
												<div style={{ display: 'flex', gap: 6 }}>
													<button
														style={secondaryButtonStyle()}
														onClick={(event) => {
															event.stopPropagation();
															copyDiffHunk(file, change, index);
														}}
													>
														Copy
													</button>
													<button
														style={secondaryButtonStyle()}
														onClick={(event) => {
															event.stopPropagation();
															toggleDiffHunk(change.id);
														}}
													>
														{expandedHunks[change.id] ? 'Collapse' : 'Expand'}
													</button>
													{status === 'pending' ? (
														<>
															<button
																style={approveButtonStyle()}
																onClick={(event) => {
																	event.stopPropagation();
																	approveChange(change, index, file.path);
																}}
															>
																Approve
															</button>
															<button
																style={dangerButtonStyle()}
																onClick={(event) => {
																	event.stopPropagation();
																	rejectChange(change, index, file.path);
																}}
															>
																Reject
															</button>
														</>
													) : (
														<button
															style={secondaryButtonStyle()}
															onClick={(event) => {
																event.stopPropagation();
																undoChange(change, index, file.path);
															}}
														>
															Undo
														</button>
													)}
												</div>
												{expandedHunks[change.id]
													? renderFullDiff(change, () => toggleDiffHunk(change.id))
													: renderMiniDiff(change, () => toggleDiffHunk(change.id))}
											</div>
											);
										})}
										{changes.length > 4 && (
											<button
												style={{
													...secondaryButtonStyle(),
													justifySelf: 'start',
													marginTop: 2,
												}}
												onClick={() => toggleDiffFileHunks(file)}
											>
												{fileExpanded ? 'Collapse Hunks' : `Show ${changes.length - 4} More Hunks`}
											</button>
										)}
									</div>
								</article>
							);
						})}
						{diffFiles.length === 0 && (
							<div style={panelStyle()}>No changed files found in this diff.</div>
						)}
						<div style={{ fontSize: 12, color: palette.muted }}>{statusText}</div>
					</section>
				</main>
			</div>
		);
	}

	return (
		<div style={{
			background: palette.bg,
			color: palette.text,
			minHeight: '100vh',
			padding: 16,
			boxSizing: 'border-box',
			fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
			fontSize: 'var(--vscode-font-size, 13px)',
		}}>
			<div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 12, maxWidth: 1180, margin: '0 auto' }}>
				<aside style={panelStyle()}>
					<div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
						<div style={{ fontSize: 12, color: palette.muted }}>{reviewName || 'Review'}</div>
						<h2 style={{ margin: 0, fontSize: 18 }}>{review.title || 'Code Review'}</h2>
						<div style={{ fontSize: 12, color: palette.muted }}>
							{totals.pending} pending · {totals.approved} approved · {totals.rejected} rejected
						</div>
					</div>

					<div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
						<button style={approveButtonStyle()} disabled={!selectedFile} onClick={approveFile}>Accept File</button>
						<button style={approveButtonStyle()} disabled={totals.pending === 0} onClick={approveAll}>Accept All</button>
						<button style={dangerButtonStyle()} disabled={totals.pending === 0} onClick={rejectAll}>Reject All</button>
						<button
							style={dangerButtonStyle(totals.pending > 0)}
							disabled={totals.pending > 0}
							onClick={completeReview}
						>
							Complete
						</button>
					</div>

					<div style={{ display: 'grid', gap: 6 }}>
						{files.map((file) => {
							const fileTotals = getTotals([file]);
							const active = file.path === selectedFile?.path;
							return (
								<button
									key={file.path}
									style={fileButtonStyle(active)}
									onClick={() => chooseFile(file)}
								>
									<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
										{file.path || 'Untitled file'}
									</span>
									<span style={{ color: active ? palette.buttonText : palette.muted, fontSize: 11 }}>
										{fileTotals.pending} pending
									</span>
								</button>
							);
						})}
					</div>
				</aside>

				<main style={{ display: 'grid', gap: 12 }}>
					<section style={panelStyle()}>
						<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
							<div>
								<h1 style={{ margin: 0, fontSize: 20 }}>{selectedFile?.path || 'No file selected'}</h1>
								{selectedFile?.summary && (
									<div style={{ marginTop: 6, color: palette.muted, fontSize: 13, lineHeight: 1.5 }}>
										{selectedFile.summary}
									</div>
								)}
							</div>
							<div style={{ fontSize: 12, color: palette.muted, whiteSpace: 'nowrap' }}>
								{selectedChanges.length} changes
							</div>
						</div>
						{selectedFile && (
							<div style={{ marginTop: 10 }}>
								<button
									style={secondaryButtonStyle()}
									onClick={() => copyReviewText(formatFileForLlm(selectedFile), `changes for ${selectedFile.path}`)}
								>
									Copy File
								</button>
							</div>
						)}
						{review.summary && (
							<div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
								{review.summary}
							</div>
						)}
						{parseError && (
							<div style={{ marginTop: 10, color: palette.danger, fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: 12 }}>
								{parseError}
							</div>
						)}
					</section>

					<section style={{ display: 'grid', gap: 8 }}>
						{selectedChanges.map((change, index) => {
							const id = getChangeId(change, index);
							const active = id === (selectedChange ? getChangeId(selectedChange, selectedChanges.indexOf(selectedChange)) : '');
							const status = getStatus(change);
							return (
								<article key={id} style={changeStyle(active, status)}>
									<button style={changeHeaderStyle()} onClick={() => chooseChange(change, index)}>
										<span style={{ fontWeight: 700 }}>{change.title || id}</span>
										<span style={statusStyle(status)}>{status}</span>
									</button>
									<div style={{ color: palette.muted, fontSize: 12 }}>
										Lines {change.startLine || 1}-{change.endLine || change.startLine || 1}
										{change.severity ? ` · ${change.severity}` : ''}
										{typeof change.replacement === 'string' ? ' · applicable' : ' · note only'}
									</div>
									{change.message && (
										<div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>{change.message}</div>
									)}
									{typeof change.replacement === 'string' && (
										<pre style={replacementStyle()}>{change.replacement}</pre>
									)}
									<div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
										<button
											style={secondaryButtonStyle()}
											onClick={() => copyReviewText(formatHunkForLlm(selectedFile, change, index), `${selectedFile?.path || 'file'} change ${index + 1}`)}
										>
											Copy
										</button>
										{status === 'pending' ? (
											<>
												<button style={approveButtonStyle()} onClick={() => approveChange(change, index)}>
													Approve
												</button>
												<button style={dangerButtonStyle()} onClick={() => rejectChange(change, index)}>
													Reject
												</button>
											</>
										) : (
											<button style={secondaryButtonStyle()} onClick={() => undoChange(change, index)}>
												Undo
											</button>
										)}
									</div>
								</article>
							);
						})}
						{selectedFile && selectedChanges.length === 0 && (
							<div style={panelStyle()}>No changes for this file.</div>
						)}
					</section>

					<div style={{ fontSize: 12, color: palette.muted }}>{statusText}</div>
				</main>
			</div>
		</div>
	);
}

function getChanges(file) {
	return Array.isArray(file?.changes) ? file.changes : [];
}

function getChangeId(change, index) {
	return typeof change?.id === 'string' && change.id.trim() ? change.id : `change-${index + 1}`;
}

function getStatus(change) {
	return change?.status === 'approved' || change?.status === 'rejected' ? change.status : 'pending';
}

function getTotals(files) {
	const totals = { pending: 0, approved: 0, rejected: 0 };
	for (const file of files) {
		for (const change of getChanges(file)) {
			totals[getStatus(change)] += 1;
		}
	}
	return totals;
}

function getDiffTotals(files) {
	return getTotals(files);
}

function formatFileForLlm(file) {
	const changes = getChanges(file);
	const totals = getTotals([file]);
	const sections = [
		'Review these file changes.',
		`File: ${file?.path || 'Unknown file'}`,
		`Hunks: ${changes.length}`,
		`State: ${totals.pending} pending, ${totals.approved} approved, ${totals.rejected} rejected`,
		'',
	];
	for (let index = 0; index < changes.length; index += 1) {
		sections.push(formatHunkForLlm(file, changes[index], index));
		if (index < changes.length - 1) {
			sections.push('');
			sections.push('---');
			sections.push('');
		}
	}
	return sections.join('\n');
}

function formatHunkForLlm(file, change, index) {
	const oldLines = Array.isArray(change?.oldLines) ? change.oldLines : [];
	const newLines = Array.isArray(change?.newLines) ? change.newLines : [];
	const replacement = typeof change?.replacement === 'string' ? change.replacement : '';
	const lines = [
		'Review this change hunk.',
		`File: ${file?.path || 'Unknown file'}`,
		`Hunk: ${change?.title || getChangeId(change, index)}`,
		`Lines: ${change?.startLine || 1}-${change?.endLine || change?.startLine || 1}`,
		`Status: ${getStatus(change)}`,
	];
	if (change?.message) {
		lines.push(`Message: ${change.message}`);
	}
	lines.push('');
	if (oldLines.length > 0 || newLines.length > 0) {
		lines.push('Old code:');
		lines.push(codeFence('ts', oldLines.join('\n')));
		lines.push('');
		lines.push('New code:');
		lines.push(codeFence('ts', newLines.join('\n')));
		lines.push('');
		lines.push('Diff:');
		lines.push(codeFence('diff', formatInlineDiff(oldLines, newLines)));
	} else if (replacement) {
		lines.push('Replacement:');
		lines.push(codeFence('ts', replacement));
	}
	return lines.join('\n');
}

function formatInlineDiff(oldLines, newLines) {
	return [
		...oldLines.map((line) => `-${line}`),
		...newLines.map((line) => `+${line}`),
	].join('\n');
}

function codeFence(language, content) {
	return ['````' + language, content || '', '````'].join('\n');
}

function renderMiniDiff(change, onExpand) {
	const oldLines = Array.isArray(change?.oldLines) ? change.oldLines : [];
	const newLines = Array.isArray(change?.newLines) ? change.newLines : [];
	const rows = [
		...oldLines.map((line) => ({ kind: 'old', line })),
		...newLines.map((line) => ({ kind: 'new', line })),
	];
	const preferredRows = rows.length > 0 ? rows : [];
	const visibleRows = preferredRows.slice(0, 2);
	if (visibleRows.length === 0) {
		return null;
	}

	return (
		<div style={miniDiffStyle()}>
			{visibleRows.map((row, index) => (
				<div key={`${row.kind}-${index}`} style={miniDiffLineStyle(row.kind)}>
					<span style={miniDiffPrefixStyle(row.kind)}>{row.kind === 'old' ? '-' : '+'}</span>
					<code style={miniDiffCodeStyle()}><CodeLine line={row.line || ' '} /></code>
				</div>
			))}
			{preferredRows.length > visibleRows.length && (
				<button
					type="button"
					style={miniDiffMoreStyle()}
					onClick={(event) => {
						event.stopPropagation();
						onExpand?.();
					}}
				>
					+ {preferredRows.length - visibleRows.length} more changed lines
				</button>
			)}
		</div>
	);
}

function renderFullDiff(change, onCollapse) {
	const oldLines = Array.isArray(change?.oldLines) ? change.oldLines : [];
	const newLines = Array.isArray(change?.newLines) ? change.newLines : [];
	const rows = [
		...oldLines.map((line) => ({ kind: 'old', line })),
		...newLines.map((line) => ({ kind: 'new', line })),
	];
	if (rows.length === 0) {
		return null;
	}

	return (
		<div style={fullDiffStyle()}>
			{rows.map((row, index) => (
				<div key={`${row.kind}-${index}`} style={fullDiffLineStyle(row.kind)}>
					<span style={diffGutterStyle(row.kind)}>{row.kind === 'old' ? '-' : '+'}</span>
					<code style={fullDiffCodeStyle()}><CodeLine line={row.line || ' '} /></code>
				</div>
			))}
			<button
				type="button"
				style={miniDiffMoreStyle()}
				onClick={(event) => {
					event.stopPropagation();
					onCollapse?.();
				}}
			>
				Collapse
			</button>
		</div>
	);
}

function CodeLine({ line }) {
	const [tokens, setTokens] = useState(null);

	useEffect(() => {
		let canceled = false;
		const theme = getShikiTheme();
		void getShikiHighlighter()
			.then(async (highlighter) => {
				const result = await highlighter.codeToTokens(line, {
					lang: 'typescript',
					theme,
				});
				if (!canceled) {
					setTokens(result.tokens[0] ?? []);
				}
			})
			.catch(() => {
				if (!canceled) {
					setTokens([]);
				}
			});
		return () => {
			canceled = true;
		};
	}, [line]);

	if (!tokens) {
		return line;
	}
	if (tokens.length === 0) {
		return line;
	}
	return tokens.map((token, index) => (
		<span
			key={`${index}-${token.offset ?? index}`}
			style={{
				color: token.color,
				fontStyle: token.fontStyle === 1 || token.fontStyle === 3 ? 'italic' : undefined,
				fontWeight: token.fontStyle === 2 || token.fontStyle === 3 ? 700 : undefined,
			}}
		>
			{token.content}
		</span>
	));
}

function panelStyle() {
	return {
		background: palette.surface,
		border: `1px solid ${palette.border}`,
		borderRadius: 8,
		padding: 14,
	};
}

function buttonStyle() {
	return {
		padding: '7px 10px',
		borderRadius: 6,
		border: '1px solid transparent',
		background: palette.button,
		color: palette.buttonText,
		cursor: 'pointer',
		fontSize: 12,
	};
}

function dangerButtonStyle(disabled = false) {
	return {
		...buttonStyle(),
		background: palette.danger,
		opacity: disabled ? 0.45 : 1,
		cursor: disabled ? 'not-allowed' : 'pointer',
	};
}

function approveButtonStyle() {
	return {
		...buttonStyle(),
		background: palette.success,
	};
}

function secondaryButtonStyle() {
	return {
		...buttonStyle(),
		background: palette.surface,
		color: palette.text,
		border: `1px solid ${palette.border}`,
	};
}

function fileButtonStyle(active) {
	return {
		display: 'grid',
		gridTemplateColumns: 'minmax(0, 1fr) auto',
		gap: 8,
		alignItems: 'center',
		width: '100%',
		textAlign: 'left',
		padding: '9px 10px',
		borderRadius: 6,
		border: `1px solid ${active ? palette.button : palette.border}`,
		background: active ? palette.button : palette.surface2,
		color: active ? palette.buttonText : palette.text,
		cursor: 'pointer',
		fontSize: 12,
	};
}

function changeHeaderStyle() {
	return {
		display: 'flex',
		justifyContent: 'space-between',
		gap: 12,
		alignItems: 'center',
		width: '100%',
		border: 0,
		background: 'transparent',
		color: 'inherit',
		padding: 0,
		cursor: 'pointer',
		textAlign: 'left',
	};
}

function changeStyle(active, status) {
	const borderColor = active
		? palette.button
		: status === 'approved' || status === 'rejected'
			? status === 'approved' ? palette.success : palette.danger
			: palette.border;
	return {
		...panelStyle(),
		border: `1px solid ${borderColor}`,
		background: active ? palette.surface2 : palette.surface,
	};
}

function statusStyle(status) {
	const color = status === 'approved' ? palette.success : status === 'rejected' ? palette.danger : palette.warn;
	return {
		border: `1px solid ${color}`,
		borderRadius: 999,
		color,
		padding: '2px 8px',
		fontSize: 11,
		textTransform: 'uppercase',
	};
}

function replacementStyle() {
	return {
		margin: '10px 0 0',
		padding: 10,
		borderRadius: 6,
		border: `1px solid ${palette.border}`,
		background: 'var(--vscode-editor-background, #f8faff)',
		color: palette.text,
		overflowX: 'auto',
		fontFamily: 'var(--vscode-editor-font-family, monospace)',
		fontSize: 'var(--vscode-editor-font-size, 12px)',
		lineHeight: 1.45,
	};
}

function previewRowStyle() {
	return {
		display: 'grid',
		gridTemplateColumns: '120px minmax(0, 1fr) auto auto',
		gap: 10,
		alignItems: 'center',
		padding: '7px 8px',
		borderRadius: 6,
		border: `1px solid ${palette.border}`,
		background: palette.surface2,
		color: palette.text,
		cursor: 'pointer',
		fontSize: 12,
		textAlign: 'left',
		width: '100%',
	};
}

function fullDiffStyle() {
	return {
		gridColumn: '1 / -1',
		border: `1px solid ${palette.border}`,
		borderRadius: 4,
		overflow: 'auto',
		fontFamily: 'var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
		fontSize: 'var(--vscode-editor-font-size, 12px)',
		lineHeight: 1.5,
		background: 'var(--vscode-editor-background, transparent)',
	};
}

function fullDiffLineStyle(kind) {
	return {
		display: 'grid',
		gridTemplateColumns: '32px minmax(max-content, 1fr)',
		background: kind === 'old'
			? 'var(--vscode-diffEditor-removedLineBackground, #ffebe9)'
			: 'var(--vscode-diffEditor-insertedLineBackground, #dafbe1)',
		color: palette.text,
	};
}

function diffGutterStyle(kind) {
	return {
		padding: '2px 8px',
		color: kind === 'old' ? palette.danger : palette.success,
		background: kind === 'old'
			? 'var(--vscode-diffEditor-removedTextBackground, #ffd7d5)'
			: 'var(--vscode-diffEditor-insertedTextBackground, #aceebb)',
		fontWeight: 700,
		textAlign: 'center',
		userSelect: 'none',
	};
}

function fullDiffCodeStyle() {
	return {
		padding: '2px 10px',
		whiteSpace: 'pre',
		background: 'transparent',
	};
}

function miniDiffStyle() {
	return {
		gridColumn: '1 / -1',
		borderLeft: `3px solid ${palette.border}`,
		borderRadius: 4,
		overflow: 'hidden',
		fontFamily: 'var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
		fontSize: 'calc(var(--vscode-editor-font-size, 12px) - 1px)',
		lineHeight: 1.45,
	};
}

function miniDiffLineStyle(kind) {
	return {
		display: 'grid',
		gridTemplateColumns: '24px minmax(0, 1fr)',
		background: kind === 'old'
			? 'var(--vscode-diffEditor-removedLineBackground, #fff7f7)'
			: 'var(--vscode-diffEditor-insertedLineBackground, #f0fdf4)',
		color: palette.text,
	};
}

function miniDiffPrefixStyle(kind) {
	return {
		padding: '2px 6px',
		color: kind === 'old' ? palette.danger : palette.success,
		fontWeight: 700,
		textAlign: 'center',
		userSelect: 'none',
	};
}

function miniDiffCodeStyle() {
	return {
		padding: '2px 8px',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'pre',
		background: 'transparent',
	};
}

function miniDiffMoreStyle() {
	return {
		width: '100%',
		padding: '3px 8px',
		background: palette.surface,
		color: palette.muted,
		borderTop: `1px solid ${palette.border}`,
		borderRight: 0,
		borderBottom: 0,
		borderLeft: 0,
		cursor: 'pointer',
		font: 'inherit',
		textAlign: 'left',
	};
}

function completeBannerStyle() {
	return {
		marginTop: 12,
		padding: '10px 12px',
		borderRadius: 6,
		border: `1px solid ${palette.success}`,
		background: 'var(--vscode-diffEditor-insertedLineBackground, #f0fdf4)',
		color: palette.success,
		fontSize: 13,
		fontWeight: 700,
	};
}

function diffStyle() {
	return {
		...panelStyle(),
		margin: 0,
		overflowX: 'auto',
		whiteSpace: 'pre',
		fontSize: 12,
		lineHeight: 1.45,
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
	};
}
