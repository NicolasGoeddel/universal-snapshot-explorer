/**
 * Universal Snapshot Explorer - Text Differ Plugin
 * Side-by-Side and Unified views with Pygments syntax highlighting,
 * intra-line character diffs, synchronized scrolling, and unchanged context collapsing.
 */

function formatSnapshotColor(color, fallback = 'var(--snap-blue)') {
    if (!color || color === 'none') return fallback;
    if (color.startsWith('var(')) return color;
    return `var(--snap-${color})`;
}

class TextDifferPlugin {
    constructor() {
        this.id = 'text-differ';
        this.name = 'Text Differ';
        this.minSnapshots = 2;
        this.maxSnapshots = 2;
        this.viewMode = localStorage.getItem('use_diff_view_mode') || 'side-by-side'; // 'side-by-side' | 'unified'
        this.collapseUnchanged = localStorage.getItem('use_diff_collapse') !== 'false';
        this.wordWrap = localStorage.getItem('use_diff_wrap') === 'true';
        this.currentData = null;
        this.currentContext = null;
        this.host = null;

        this.leftScrollEl = null;
        this.rightScrollEl = null;
        this.unifiedScrollEl = null;
        this.isSyncingScroll = false;
        this.expandedBlocks = new Set();

        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if (
                (e.altKey && e.key === 'ArrowDown') ||
                (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'F7'))
            ) {
                e.preventDefault();
                this.jumpToChange(1);
            } else if (
                (e.altKey && e.key === 'ArrowUp') ||
                (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'p') ||
                (e.shiftKey && e.key === 'F7')
            ) {
                e.preventDefault();
                this.jumpToChange(-1);
            }
        });
    }

    mountControls(container, host) {
        this.host = host;
        const i18n = window.clientI18n || {};

        const sbsLabel = i18n['diff.side_by_side'] || 'Side-by-Side';
        const unifiedLabel = i18n['diff.unified'] || 'Unified';
        const collapseLabel = i18n['diff.collapse_context'] || 'Collapse Unchanged';
        const wrapLabel = i18n['diff.word_wrap'] || 'Wrap lines';
        const prevChangeTitle = i18n['diff.prev_change'] || 'Previous difference (Alt+↑)';
        const nextChangeTitle = i18n['diff.next_change'] || 'Next difference (Alt+↓)';

        container.innerHTML = `
            <div class="differ-btn-group" title="Navigation between changes">
                <button type="button" class="differ-group-btn" id="diff-prev-change" title="${escapeHtml(prevChangeTitle)}">
                    ↑
                </button>
                <button type="button" class="differ-group-btn" id="diff-next-change" title="${escapeHtml(nextChangeTitle)}">
                    ↓
                </button>
                <span id="diff-change-counter" class="diff-change-counter">0 / 0</span>
            </div>
            <div class="diff-stats-badge" id="diff-stats-badge" style="display: none;">
                <span class="stat-add" id="stat-add">+0</span>
                <span class="stat-del" id="stat-del">-0</span>
                <span class="stat-mod" id="stat-mod">~0</span>
            </div>
            <div class="differ-btn-group">
                <button type="button" class="differ-group-btn ${this.viewMode === 'side-by-side' ? 'active' : ''}" id="diff-mode-sbs">
                    ${escapeHtml(sbsLabel)}
                </button>
                <button type="button" class="differ-group-btn ${this.viewMode === 'unified' ? 'active' : ''}" id="diff-mode-unified">
                    ${escapeHtml(unifiedLabel)}
                </button>
            </div>
            <label class="differ-toggle-label">
                <input type="checkbox" id="diff-wrap-check" ${this.wordWrap ? 'checked' : ''}>
                <span>${escapeHtml(wrapLabel)}</span>
            </label>
            <label class="differ-toggle-label">
                <input type="checkbox" id="diff-collapse-check" ${this.collapseUnchanged ? 'checked' : ''}>
                <span>${escapeHtml(collapseLabel)}</span>
            </label>
        `;

        const sbsBtn = container.querySelector('#diff-mode-sbs');
        const unifiedBtn = container.querySelector('#diff-mode-unified');
        const collapseCheck = container.querySelector('#diff-collapse-check');
        const wrapCheck = container.querySelector('#diff-wrap-check');
        const prevChangeBtn = container.querySelector('#diff-prev-change');
        const nextChangeBtn = container.querySelector('#diff-next-change');

        sbsBtn?.addEventListener('click', () => {
            if (this.viewMode === 'side-by-side') return;
            this.viewMode = 'side-by-side';
            localStorage.setItem('use_diff_view_mode', 'side-by-side');
            sbsBtn.classList.add('active');
            unifiedBtn?.classList.remove('active');
            this.reRender();
        });

        unifiedBtn?.addEventListener('click', () => {
            if (this.viewMode === 'unified') return;
            this.viewMode = 'unified';
            localStorage.setItem('use_diff_view_mode', 'unified');
            unifiedBtn.classList.add('active');
            sbsBtn?.classList.remove('active');
            this.reRender();
        });

        wrapCheck?.addEventListener('change', (e) => {
            this.wordWrap = Boolean(e.target.checked);
            localStorage.setItem('use_diff_wrap', String(this.wordWrap));
            this.applyWordWrap();
        });

        collapseCheck?.addEventListener('change', (e) => {
            this.collapseUnchanged = Boolean(e.target.checked);
            localStorage.setItem('use_diff_collapse', String(this.collapseUnchanged));
            this.expandedBlocks.clear();
            this.reRender();
        });

        prevChangeBtn?.addEventListener('click', () => this.jumpToChange(-1));
        nextChangeBtn?.addEventListener('click', () => this.jumpToChange(1));
    }

    applyWordWrap() {
        if (!this.host?.viewport) return;
        this.host.viewport.classList.toggle('diff-wrap', this.wordWrap);
    }

    jumpToChange(direction) {
        if (!this.totalChanges || this.totalChanges <= 0) return;

        if (this.currentChangeIndex === null || this.currentChangeIndex === undefined) {
            this.currentChangeIndex = direction > 0 ? 0 : this.totalChanges - 1;
        } else {
            this.currentChangeIndex = (this.currentChangeIndex + direction + this.totalChanges) % this.totalChanges;
        }

        const counterEl = document.getElementById('diff-change-counter');
        if (counterEl) {
            counterEl.textContent = `${this.currentChangeIndex + 1} / ${this.totalChanges}`;
        }

        document.querySelectorAll('.diff-active-change').forEach((el) => el.classList.remove('diff-active-change'));

        const scrollContainers =
            this.viewMode === 'side-by-side'
                ? [this.leftScrollEl, this.rightScrollEl].filter(Boolean)
                : [this.unifiedScrollEl].filter(Boolean);

        let targetScrollTop = null;

        for (const container of scrollContainers) {
            const targetEls = container.querySelectorAll(
                `#diff-change-${this.currentChangeIndex}, [data-change-index="${this.currentChangeIndex}"]`,
            );
            if (targetEls.length > 0) {
                targetEls.forEach((el) => el.classList.add('diff-active-change'));
                if (targetScrollTop === null) {
                    const containerRect = container.getBoundingClientRect();
                    const targetRect = targetEls[0].getBoundingClientRect();
                    targetScrollTop = Math.max(0, targetRect.top - containerRect.top + container.scrollTop - 90);
                }
            }
        }

        if (targetScrollTop !== null) {
            this.isSyncingScroll = true;
            for (const container of scrollContainers) {
                container.scrollTo({
                    top: targetScrollTop,
                    behavior: 'smooth',
                });
            }
            setTimeout(() => {
                this.isSyncingScroll = false;
            }, 350);
        }
    }

    updateStatsBadge(stats) {
        const badge = document.getElementById('diff-stats-badge');
        const addEl = document.getElementById('stat-add');
        const delEl = document.getElementById('stat-del');
        const modEl = document.getElementById('stat-mod');

        if (!badge || !stats) return;

        if (addEl) addEl.textContent = `+${stats.additions || 0}`;
        if (delEl) delEl.textContent = `-${stats.deletions || 0}`;
        if (modEl) modEl.textContent = `~${stats.modifications || 0}`;
        badge.style.display = 'inline-flex';
    }

    getScrollPosition() {
        if (this.viewMode === 'side-by-side' && this.leftScrollEl) {
            return {
                scrollTop: this.leftScrollEl.scrollTop,
                scrollLeft: this.leftScrollEl.scrollLeft,
            };
        }
        if (this.viewMode === 'unified' && this.unifiedScrollEl) {
            return {
                scrollTop: this.unifiedScrollEl.scrollTop,
                scrollLeft: this.unifiedScrollEl.scrollLeft,
            };
        }
        return null;
    }

    setScrollPosition(pos) {
        if (!pos) return;
        requestAnimationFrame(() => {
            if (this.viewMode === 'side-by-side') {
                if (this.leftScrollEl) {
                    this.leftScrollEl.scrollTop = pos.scrollTop;
                    this.leftScrollEl.scrollLeft = pos.scrollLeft;
                }
            } else if (this.viewMode === 'unified' && this.unifiedScrollEl) {
                this.unifiedScrollEl.scrollTop = pos.scrollTop;
                this.unifiedScrollEl.scrollLeft = pos.scrollLeft;
            }
        });
    }

    render(viewport, data, context) {
        this.currentData = data;
        this.currentContext = context;

        this.updateStatsBadge(data.stats);

        // Binary File Warning
        if (data.is_binary) {
            const i18n = window.clientI18n || {};
            const warningText = i18n['diff.binary_warning'] || 'Binary file: direct text diff not available.';
            viewport.innerHTML = `
                <div class="diff-message-box">
                    <span>${escapeHtml(warningText)}</span>
                </div>
            `;
            return;
        }

        let gitHeaderHtml = '';
        if (data.are_identical) {
            const i18n = window.clientI18n || {};
            const identicalNotice = i18n['diff.identical_notice'] || 'Dateien in diesen Snapshots sind identisch';
            const displayPath = data.file_path || 'file';
            gitHeaderHtml = `
                <div class="diff-git-header">
                    <code>diff --git a/${escapeHtml(displayPath)} b/${escapeHtml(displayPath)}</code>
                    <span class="diff-identical-badge">✓ ${escapeHtml(identicalNotice)}</span>
                </div>
            `;
        }

        // Render Diff View
        if (this.viewMode === 'side-by-side') {
            this.renderSideBySide(viewport, data, context, gitHeaderHtml);
        } else {
            this.renderUnified(viewport, data, context, gitHeaderHtml);
        }

        const prevBtn = document.getElementById('diff-prev-change');
        const nextBtn = document.getElementById('diff-next-change');
        const counterEl = document.getElementById('diff-change-counter');
        const hasChanges = (this.totalChanges || 0) > 0;
        if (prevBtn) prevBtn.disabled = !hasChanges;
        if (nextBtn) nextBtn.disabled = !hasChanges;
        if (counterEl) {
            const current =
                this.currentChangeIndex !== null && this.currentChangeIndex !== undefined
                    ? this.currentChangeIndex + 1
                    : 0;
            counterEl.textContent = `${current} / ${this.totalChanges || 0}`;
        }

        this.applyWordWrap();
    }

    reRender() {
        if (!this.currentData || !this.host?.viewport) return;
        const scrollPos = this.getScrollPosition();
        this.render(this.host.viewport, this.currentData, this.currentContext);
        this.setScrollPosition(scrollPos);
    }

    /**
     * Compute blocks with context collapsing for unchanged lines
     */
    computeBlocks(lines) {
        let changeCounter = 0;

        if (!this.collapseUnchanged) {
            const blocks = [];
            let i = 0;
            while (i < lines.length) {
                if (lines[i].type === 'equal') {
                    const startEqual = i;
                    while (i < lines.length && lines[i].type === 'equal') i++;
                    blocks.push({ type: 'lines', lines: lines.slice(startEqual, i), startIndex: startEqual });
                } else {
                    const startDiff = i;
                    while (i < lines.length && lines[i].type !== 'equal') i++;
                    blocks.push({
                        type: 'lines',
                        lines: lines.slice(startDiff, i),
                        startIndex: startDiff,
                        isDiff: true,
                        changeIndex: changeCounter++,
                    });
                }
            }
            this.totalChanges = changeCounter;
            return blocks;
        }

        const CONTEXT_LINES = 2;
        const MIN_COLLAPSE_THRESHOLD = 6;
        const blocks = [];
        let i = 0;

        while (i < lines.length) {
            if (lines[i].type === 'equal') {
                const startEqual = i;
                while (i < lines.length && lines[i].type === 'equal') {
                    i++;
                }
                const equalCount = i - startEqual;

                if (equalCount >= MIN_COLLAPSE_THRESHOLD) {
                    // Lines before collapse
                    const preCount = startEqual === 0 ? 0 : CONTEXT_LINES;
                    if (preCount > 0) {
                        blocks.push({
                            type: 'lines',
                            lines: lines.slice(startEqual, startEqual + preCount),
                            startIndex: startEqual,
                        });
                    }

                    // Collapsed portion
                    const postCount = i === lines.length ? 0 : CONTEXT_LINES;
                    const collapseStart = startEqual + preCount;
                    const collapseEnd = i - postCount;

                    if (collapseEnd > collapseStart) {
                        const blockId = `block_${collapseStart}_${collapseEnd}`;
                        if (this.expandedBlocks.has(blockId)) {
                            blocks.push({
                                type: 'expanded_lines',
                                blockId,
                                lines: lines.slice(collapseStart, collapseEnd),
                                startIndex: collapseStart,
                            });
                        } else {
                            blocks.push({
                                type: 'collapsed',
                                blockId,
                                count: collapseEnd - collapseStart,
                                lines: lines.slice(collapseStart, collapseEnd),
                                startIndex: collapseStart,
                                endIndex: collapseEnd,
                            });
                        }
                    }

                    // Lines after collapse
                    if (postCount > 0) {
                        blocks.push({
                            type: 'lines',
                            lines: lines.slice(collapseEnd, i),
                            startIndex: collapseEnd,
                        });
                    }
                } else {
                    blocks.push({
                        type: 'lines',
                        lines: lines.slice(startEqual, i),
                        startIndex: startEqual,
                    });
                }
            } else {
                const startDiff = i;
                while (i < lines.length && lines[i].type !== 'equal') {
                    i++;
                }
                blocks.push({
                    type: 'lines',
                    lines: lines.slice(startDiff, i),
                    startIndex: startDiff,
                    isDiff: true,
                    changeIndex: changeCounter++,
                });
            }
        }

        this.totalChanges = changeCounter;
        return blocks;
    }

    renderSideBySide(viewport, data, context, gitHeaderHtml = '') {
        const leftName = context?.leftSnapshot?.name || data.left_snapshot_name || 'Left';
        const leftTime =
            context?.leftSnapshot?.time || context?.leftSnapshot?.timestamp_formatted || data.left_snapshot_time || '';
        const leftColor = formatSnapshotColor(context?.leftSnapshot?.color, 'var(--snap-blue)');

        const rightName = context?.rightSnapshot?.name || data.right_snapshot_name || 'Right';
        const rightTime =
            context?.rightSnapshot?.time ||
            context?.rightSnapshot?.timestamp_formatted ||
            data.right_snapshot_time ||
            '';
        const rightColor = formatSnapshotColor(context?.rightSnapshot?.color, 'var(--snap-emerald)');

        const blocks = this.computeBlocks(data.lines);
        const rowsHtml = [];
        const i18n = window.clientI18n || {};
        const recollapseText = i18n['diff.recollapse'] || 'Fold unchanged lines';

        for (const block of blocks) {
            if (block.type === 'collapsed') {
                const unchangedText = (i18n['diff.unchanged_block'] || '{count} unchanged lines').replace(
                    '{count}',
                    String(block.count),
                );
                const expandAllText = i18n['diff.expand_all'] || 'Expand all';

                const collapseHtml = `
                    <tr class="diff-row diff-collapse-row" data-block-id="${escapeHtml(block.blockId)}" title="${escapeHtml(expandAllText)}">
                        <td class="diff-gutter">···</td>
                        <td class="diff-content diff-collapse-cell">
                            <div class="diff-collapse-controls">
                                <span class="diff-collapse-text">↕ ${escapeHtml(unchangedText)}</span>
                                <button type="button" class="diff-expand-btn" data-action="expand" data-block-id="${escapeHtml(block.blockId)}">
                                    ${escapeHtml(expandAllText)}
                                </button>
                            </div>
                        </td>
                        <td class="diff-gutter">···</td>
                        <td class="diff-content diff-collapse-cell">
                        </td>
                    </tr>
                `;
                rowsHtml.push(collapseHtml);
            } else if (block.type === 'expanded_lines') {
                const recollapseTopHtml = `
                    <tr class="diff-row diff-recollapse-row" data-block-id="${escapeHtml(block.blockId)}">
                        <td class="diff-gutter">…</td>
                        <td class="diff-content diff-collapse-cell">
                            <div class="diff-collapse-controls">
                                <button type="button" class="diff-recollapse-btn" data-action="collapse" data-block-id="${escapeHtml(block.blockId)}">
                                    ▲ ${escapeHtml(recollapseText)}
                                </button>
                            </div>
                        </td>
                        <td class="diff-gutter">…</td>
                        <td class="diff-content diff-collapse-cell">
                        </td>
                    </tr>
                `;
                const recollapseBottomHtml = `
                    <tr class="diff-row diff-recollapse-row" data-block-id="${escapeHtml(block.blockId)}">
                        <td class="diff-gutter">…</td>
                        <td class="diff-content diff-collapse-cell">
                            <div class="diff-collapse-controls">
                                <button type="button" class="diff-recollapse-btn" data-action="collapse" data-block-id="${escapeHtml(block.blockId)}">
                                    ▼ ${escapeHtml(recollapseText)}
                                </button>
                            </div>
                        </td>
                        <td class="diff-gutter">…</td>
                        <td class="diff-content diff-collapse-cell">
                        </td>
                    </tr>
                `;
                rowsHtml.push(recollapseTopHtml);

                for (const line of block.lines) {
                    const leftClass =
                        line.left_html !== null &&
                        line.left_html !== undefined &&
                        line.left_html !== '' &&
                        line.left_line_num !== null
                            ? `diff-${line.type}`
                            : 'diff-empty';
                    const rightClass =
                        line.right_html !== null &&
                        line.right_html !== undefined &&
                        line.right_html !== '' &&
                        line.right_line_num !== null
                            ? `diff-${line.type}`
                            : 'diff-empty';

                    rowsHtml.push(`
                        <tr class="diff-row">
                            <td class="diff-gutter ${leftClass}">${line.left_line_num ?? ''}</td>
                            <td class="diff-content ${leftClass}" style="width: 50%; max-width: 0;">${line.left_html || ' '}</td>
                            <td class="diff-gutter ${rightClass}">${line.right_line_num ?? ''}</td>
                            <td class="diff-content ${rightClass}" style="width: 50%; max-width: 0;">${line.right_html || ' '}</td>
                        </tr>
                    `);
                }
                rowsHtml.push(recollapseBottomHtml);
            } else {
                for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
                    const line = block.lines[lineIdx];
                    const changeIdAttr = block.isDiff && lineIdx === 0 ? `id="diff-change-${block.changeIndex}"` : '';
                    const changeDataAttr = block.isDiff ? `data-change-index="${block.changeIndex}"` : '';

                    if (line.type === 'modify') {
                        // For modify, the line was replaced. Show left and right inline on the same row.
                        const leftClass = data.left_is_newer ? 'diff-insert' : 'diff-delete';
                        const rightClass = data.left_is_newer ? 'diff-delete' : 'diff-insert';
                        rowsHtml.push(`
                            <tr class="diff-row" ${changeIdAttr} ${changeDataAttr}>
                                <td class="diff-gutter ${leftClass}">${line.left_line_num ?? ''}</td>
                                <td class="diff-content ${leftClass}" style="width: 50%; max-width: 0;">${line.left_html || ' '}</td>
                                <td class="diff-gutter ${rightClass}">${line.right_line_num ?? ''}</td>
                                <td class="diff-content ${rightClass}" style="width: 50%; max-width: 0;">${line.right_html || ' '}</td>
                            </tr>
                        `);
                    } else {
                        const leftClass = line.left_line_num !== null ? `diff-${line.type}` : 'diff-empty';
                        const rightClass = line.right_line_num !== null ? `diff-${line.type}` : 'diff-empty';

                        rowsHtml.push(`
                            <tr class="diff-row" ${changeIdAttr} ${changeDataAttr}>
                                <td class="diff-gutter ${leftClass}">${line.left_line_num ?? ''}</td>
                                <td class="diff-content ${leftClass}" style="width: 50%; max-width: 0;">${line.left_html || ' '}</td>
                                <td class="diff-gutter ${rightClass}">${line.right_line_num ?? ''}</td>
                                <td class="diff-content ${rightClass}" style="width: 50%; max-width: 0;">${line.right_html || ' '}</td>
                            </tr>
                        `);
                    }
                }
            }
        }

        viewport.innerHTML = `
            ${gitHeaderHtml}
            <div class="diff-sbs-container" style="flex-direction: column;">
                <div class="diff-pane-header" style="display: flex; width: 100%; border-bottom: 1px solid var(--border-color); padding: 0;">
                    <div class="diff-pane-title-group" style="width: 50%; padding: 8px 16px; border-right: 1px solid var(--border-color);">
                        <span class="diff-pane-tag" style="background: ${leftColor}; color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); font-weight: 600;">${escapeHtml(leftName)}</span>
                        ${leftTime ? `<span class="diff-pane-time">(${escapeHtml(leftTime)})</span>` : ''}
                    </div>
                    <div class="diff-pane-title-group" style="width: 50%; padding: 8px 16px;">
                        <span class="diff-pane-tag" style="background: ${rightColor}; color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); font-weight: 600;">${escapeHtml(rightName)}</span>
                        ${rightTime ? `<span class="diff-pane-time">(${escapeHtml(rightTime)})</span>` : ''}
                    </div>
                </div>
                <div class="diff-pane-scroll" id="diff-sbs-scroll" style="width: 100%; display: flex; flex-direction: column;">
                    <table class="diff-table diff-sbs-table" style="width: 100%; table-layout: fixed;">
                        <tbody>${rowsHtml.join('')}</tbody>
                    </table>
                </div>
            </div>
        `;

        this.leftScrollEl = viewport.querySelector('#diff-sbs-scroll');
        this.rightScrollEl = null;

        this.setupScrollSync();
        this.setupExpandHandlers(viewport);
    }

    renderUnified(viewport, data, context, gitHeaderHtml = '') {
        const leftName = context?.leftSnapshot?.name || data.left_snapshot_name || 'Left';
        const leftTime =
            context?.leftSnapshot?.time || context?.leftSnapshot?.timestamp_formatted || data.left_snapshot_time || '';
        const leftColor = formatSnapshotColor(context?.leftSnapshot?.color, 'var(--snap-blue)');

        const rightName = context?.rightSnapshot?.name || data.right_snapshot_name || 'Right';
        const rightTime =
            context?.rightSnapshot?.time ||
            context?.rightSnapshot?.timestamp_formatted ||
            data.right_snapshot_time ||
            '';
        const rightColor = formatSnapshotColor(context?.rightSnapshot?.color, 'var(--snap-emerald)');

        const blocks = this.computeBlocks(data.lines);
        const rowsHtml = [];
        const i18n = window.clientI18n || {};
        const recollapseText = i18n['diff.recollapse'] || 'Fold unchanged lines';

        for (const block of blocks) {
            if (block.type === 'collapsed') {
                const unchangedText = (i18n['diff.unchanged_block'] || '{count} unchanged lines').replace(
                    '{count}',
                    String(block.count),
                );
                const expandAllText = i18n['diff.expand_all'] || 'Expand all';

                rowsHtml.push(`
                    <tr class="diff-row diff-collapse-row" data-block-id="${escapeHtml(block.blockId)}" title="${escapeHtml(expandAllText)}">
                        <td class="diff-gutter">···</td>
                        <td class="diff-gutter">···</td>
                        <td class="diff-sign"> </td>
                        <td class="diff-content diff-collapse-cell">
                            <div class="diff-collapse-controls">
                                <span class="diff-collapse-text">↕ ${escapeHtml(unchangedText)}</span>
                                <button type="button" class="diff-expand-btn" data-action="expand" data-block-id="${escapeHtml(block.blockId)}">
                                    ${escapeHtml(expandAllText)}
                                </button>
                            </div>
                        </td>
                    </tr>
                `);
            } else if (block.type === 'expanded_lines') {
                const recollapseTopHtml = `
                    <tr class="diff-row diff-recollapse-row" data-block-id="${escapeHtml(block.blockId)}">
                        <td class="diff-gutter">…</td>
                        <td class="diff-gutter">…</td>
                        <td class="diff-sign"> </td>
                        <td class="diff-content diff-collapse-cell">
                            <div class="diff-collapse-controls">
                                <button type="button" class="diff-recollapse-btn" data-action="collapse" data-block-id="${escapeHtml(block.blockId)}">
                                    ▲ ${escapeHtml(recollapseText)}
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
                const recollapseBottomHtml = `
                    <tr class="diff-row diff-recollapse-row" data-block-id="${escapeHtml(block.blockId)}">
                        <td class="diff-gutter">…</td>
                        <td class="diff-gutter">…</td>
                        <td class="diff-sign"> </td>
                        <td class="diff-content diff-collapse-cell">
                            <div class="diff-collapse-controls">
                                <button type="button" class="diff-recollapse-btn" data-action="collapse" data-block-id="${escapeHtml(block.blockId)}">
                                    ▼ ${escapeHtml(recollapseText)}
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
                rowsHtml.push(recollapseTopHtml);
                for (const line of block.lines) {
                    const rowClass = `diff-${line.type}`;
                    const sign = ' ';
                    const lineHtml = line.left_html || line.right_html || ' ';

                    rowsHtml.push(`
                        <tr class="diff-row ${rowClass}">
                            <td class="diff-gutter">${line.left_line_num ?? ''}</td>
                            <td class="diff-gutter">${line.right_line_num ?? ''}</td>
                            <td class="diff-sign">${sign}</td>
                            <td class="diff-content">${lineHtml}</td>
                        </tr>
                    `);
                }
                rowsHtml.push(recollapseBottomHtml);
            } else {
                for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
                    const line = block.lines[lineIdx];
                    const rowClass = `diff-${line.type}`;
                    const changeIdAttr = block.isDiff && lineIdx === 0 ? `id="diff-change-${block.changeIndex}"` : '';
                    const changeDataAttr = block.isDiff ? `data-change-index="${block.changeIndex}"` : '';

                    let sign = ' ';
                    let lineHtml = line.left_html || line.right_html || ' ';

                    if (line.type === 'insert') {
                        sign = '+';
                        lineHtml = line.left_html || line.right_html || ' '; // Usually left is null for insert if not left_is_newer
                    } else if (line.type === 'delete') {
                        sign = '-';
                        lineHtml = line.left_html || line.right_html || ' ';
                    } else if (line.type === 'modify') {
                        // For modified lines in unified view, we show the deleted line then the inserted line
                        const delContent = data.left_is_newer ? line.right_html : line.left_html;
                        const insContent = data.left_is_newer ? line.left_html : line.right_html;
                        const delLineNum = data.left_is_newer ? line.right_line_num : line.left_line_num;
                        const insLineNum = data.left_is_newer ? line.left_line_num : line.right_line_num;

                        rowsHtml.push(`
                            <tr class="diff-row diff-delete" ${changeIdAttr} ${changeDataAttr}>
                                <td class="diff-gutter">${data.left_is_newer ? '' : (delLineNum ?? '')}</td>
                                <td class="diff-gutter">${data.left_is_newer ? (delLineNum ?? '') : ''}</td>
                                <td class="diff-sign">-</td>
                                <td class="diff-content">${delContent || ' '}</td>
                            </tr>
                        `);
                        rowsHtml.push(`
                            <tr class="diff-row diff-insert" ${changeDataAttr}>
                                <td class="diff-gutter">${data.left_is_newer ? (insLineNum ?? '') : ''}</td>
                                <td class="diff-gutter">${data.left_is_newer ? '' : (insLineNum ?? '')}</td>
                                <td class="diff-sign">+</td>
                                <td class="diff-content">${insContent || ' '}</td>
                            </tr>
                        `);
                        continue;
                    }

                    rowsHtml.push(`
                        <tr class="diff-row ${rowClass}" ${changeIdAttr} ${changeDataAttr}>
                            <td class="diff-gutter">${line.left_line_num ?? ''}</td>
                            <td class="diff-gutter">${line.right_line_num ?? ''}</td>
                            <td class="diff-sign">${sign}</td>
                            <td class="diff-content">${lineHtml}</td>
                        </tr>
                    `);
                }
            }
        }

        viewport.innerHTML = `
            ${gitHeaderHtml}
            <div class="diff-unified-container">
                <div class="diff-pane-header" style="justify-content: flex-start; gap: 16px;">
                    <div class="diff-pane-title-group">
                        <span class="diff-pane-tag" style="background: ${leftColor}; color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); font-weight: 600;">${escapeHtml(leftName)}</span>
                        ${leftTime ? `<span class="diff-pane-time">(${escapeHtml(leftTime)})</span>` : ''}
                    </div>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">↔</span>
                    <div class="diff-pane-title-group">
                        <span class="diff-pane-tag" style="background: ${rightColor}; color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); font-weight: 600;">${escapeHtml(rightName)}</span>
                        ${rightTime ? `<span class="diff-pane-time">(${escapeHtml(rightTime)})</span>` : ''}
                    </div>
                </div>
                <div class="diff-unified-scroll" id="diff-unified-scroll">
                    <table class="diff-table diff-unified-table">
                        <tbody>${rowsHtml.join('')}</tbody>
                    </table>
                </div>
            </div>
        `;

        this.unifiedScrollEl = viewport.querySelector('#diff-unified-scroll');
        this.setupExpandHandlers(viewport);
    }

    setupScrollSync() {
        if (!this.leftScrollEl || !this.rightScrollEl) return;

        const onLeftScroll = () => {
            if (this.isSyncingScroll) return;
            this.isSyncingScroll = true;
            this.rightScrollEl.scrollTop = this.leftScrollEl.scrollTop;
            this.rightScrollEl.scrollLeft = this.leftScrollEl.scrollLeft;
            requestAnimationFrame(() => {
                this.isSyncingScroll = false;
            });
        };

        const onRightScroll = () => {
            if (this.isSyncingScroll) return;
            this.isSyncingScroll = true;
            this.leftScrollEl.scrollTop = this.rightScrollEl.scrollTop;
            this.leftScrollEl.scrollLeft = this.rightScrollEl.scrollLeft;
            requestAnimationFrame(() => {
                this.isSyncingScroll = false;
            });
        };

        this.leftScrollEl.addEventListener('scroll', onLeftScroll, { passive: true });
        this.rightScrollEl.addEventListener('scroll', onRightScroll, { passive: true });
    }

    setupExpandHandlers(viewport) {
        const collapseRows = viewport.querySelectorAll('.diff-collapse-row');
        for (const row of collapseRows) {
            row.addEventListener('click', () => {
                const blockId = row.dataset.blockId;
                if (!blockId) return;

                const scrollPos = this.getScrollPosition();
                this.expandedBlocks.add(blockId);
                this.reRender();
                this.setScrollPosition(scrollPos);
            });
        }

        const recollapseBtns = viewport.querySelectorAll('.diff-recollapse-btn');
        for (const btn of recollapseBtns) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const blockId = btn.dataset.blockId;
                if (!blockId) return;

                const scrollPos = this.getScrollPosition();
                this.expandedBlocks.delete(blockId);
                this.reRender();
                this.setScrollPosition(scrollPos);
            });
        }
    }
}

// Register TextDifferPlugin with DifferHost
document.addEventListener('DOMContentLoaded', () => {
    if (window.differHost) {
        window.differHost.registerPlugin('text-differ', new TextDifferPlugin());
    }
});
