/**
 * Universal Snapshot Explorer - Differ Host & Timeline Orchestrator
 */

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

class DifferHost {
    constructor() {
        this.toolbar = document.getElementById('differ-toolbar');
        if (!this.toolbar) return;

        this.rootName = this.toolbar.dataset.root || '';
        this.filePath = this.toolbar.dataset.path || '';
        const initSnaps = this.toolbar.dataset.initialSnapshots;
        this.initialSnapshots = initSnaps ? initSnaps.split(',') : [];

        this.timelineSvg = document.getElementById('diff-timeline-svg');
        this.segmentsGroup = document.getElementById('diff-timeline-segments');
        this.bracketPath = document.getElementById('active-pair-bracket');
        this.stepperContainer = document.getElementById('diff-stepper');
        this.stepperPrevBtn = document.getElementById('stepper-prev');
        this.stepperNextBtn = document.getElementById('stepper-next');
        this.stepperLabel = document.getElementById('stepper-label');
        this.groupSizeInput = document.getElementById('differ-group-size');

        this.pluginControlsSlot = document.getElementById('differ-plugin-controls');
        this.pluginSelector = document.getElementById('differ-plugin-selector');
        this.mainContent = document.getElementById('differ-main-content');
        this.viewport = document.getElementById('diff-viewport');
        this.loadingIndicator = document.getElementById('diff-loading');

        // hideUnchanged is set from localStorage inside initTimeline(), before the
        // timeline's first layout pass.
        this.hideUnchanged = true;
        this.segments = [];
        this.versionBlocks = [];
        this.selectedSnapshotIds = new Set();
        this.activeGroupIndex = 0;
        this.groups = [];
        this.diffCache = new Map();
        this.scrollMemory = null;
        this.plugins = new Map();
        this.activePlugin = null;
        this.criteriaRequestId = 0;

        this.isDragging = false;
        this.dragStartIndex = -1;
        this.dragRange = new Set();
        this.dragIsCtrl = false;

        this.initTimeline();
        this.initHideToggle();
        this.initCriteria();
        this.initStepper();
        this.initPluginSelector();
        this.initKeyboardNav();
    }

    // Mirrors the file browser's snapshot-bar criteria: which metadata changes count
    // as "a change" when computing snapshot colors (and therefore which snapshots
    // "Hide unchanged" treats as duplicates). Colors are computed server-side, so a
    // change refetches just the timeline segments for the new criteria and swaps
    // them in, the same way the file browser refetches its snapshot bars.
    initCriteria() {
        if (typeof SnapshotCriteriaManager === 'undefined') return;
        const container = document.querySelector('.snapshot-criteria-dropdown');
        if (!container) return;

        this.criteriaManager = new SnapshotCriteriaManager({
            container,
            onChange: (attrs) => this.applyCriteria(attrs),
        });

        // The server always renders with every criterion; apply saved custom criteria
        // right away (mirrors the file browser applying stored criteria on load).
        const active = this.criteriaManager.getActiveAttributes();
        if (active.length < SnapshotCriteriaManager.ALL_ATTRIBUTES.length) {
            this.applyCriteria(active);
        }
    }

    async applyCriteria(attrs) {
        const isAll = attrs.length >= SnapshotCriteriaManager.ALL_ATTRIBUTES.length;
        // Toggling several checkboxes quickly fires overlapping requests; only the
        // latest one may be applied.
        const requestId = ++this.criteriaRequestId;

        let apiUrl = `/api/diff-timeline/${encodeURIComponent(this.rootName)}`;
        if (this.filePath?.trim()) {
            apiUrl += `/-/${this.filePath.split('/').map(encodeURIComponent).join('/')}`;
        }
        if (!isAll) apiUrl += `?attributes=${encodeURIComponent(attrs.join(','))}`;

        let html;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`Timeline API failed with status ${response.status}`);
            html = await response.text();
        } catch (err) {
            console.error('[DifferHost] Failed reloading timeline:', err);
            return;
        }
        if (requestId !== this.criteriaRequestId) return;

        const previousGroupIds = (this.groups[this.activeGroupIndex] || []).map((s) => s.id).join(',');

        this.segmentsGroup.innerHTML = html;
        this.readSegments();
        if (this.hideUnchanged) this.remapSelectionToRepresentatives();
        this.layoutTimeline();
        this.updateSnapshotGroups();
        // Stay on the pair being viewed if it still exists under the new grouping.
        const sameGroupIdx = this.groups.findIndex((g) => g.map((s) => s.id).join(',') === previousGroupIds);
        this.activeGroupIndex = Math.max(0, sameGroupIdx);
        this.updateTimelineUI();
        this.updateStepperUI();
        this.loadCurrentGroup();
    }

    registerPlugin(id, plugin) {
        this.plugins.set(id, plugin);
        this.updatePluginSelector();
        if (!this.activePlugin) {
            this.setActivePlugin(id);
        }
    }

    setActivePlugin(id) {
        if (this.activePlugin?.destroy) {
            this.activePlugin.destroy();
        }
        const plugin = this.plugins.get(id);
        if (!plugin) return;

        this.activePlugin = plugin;
        this.updatePluginSelector();
        this.pluginControlsSlot.innerHTML = '';
        plugin.mountControls(this.pluginControlsSlot, this);

        // Update group size input visibility
        if (this.groupSizeInput) {
            if (this.activePlugin.maxSnapshots === Infinity || this.activePlugin.maxSnapshots > 2) {
                this.groupSizeInput.style.display = 'inline-block';
                this.groupSizeInput.value = this.activePlugin.minSnapshots || 2;
            } else {
                this.groupSizeInput.style.display = 'none';
            }
        }

        this.updateSnapshotGroups();
        this.loadCurrentGroup();
    }

    updatePluginSelector() {
        if (!this.pluginSelector) return;
        this.pluginSelector.innerHTML = '';
        for (const [id, plugin] of this.plugins.entries()) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = plugin.name || id;
            opt.selected = this.activePlugin?.id === id;
            this.pluginSelector.appendChild(opt);
        }
    }

    initPluginSelector() {
        this.pluginSelector?.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            if (selectedId && this.plugins.has(selectedId)) {
                this.setActivePlugin(selectedId);
            }
        });

        this.groupSizeInput?.addEventListener('change', () => {
            let val = parseInt(this.groupSizeInput.value, 10);
            if (Number.isNaN(val) || val < (this.activePlugin?.minSnapshots || 2)) {
                val = this.activePlugin?.minSnapshots || 2;
                this.groupSizeInput.value = val;
            }
            this.updateSnapshotGroups();
            this.loadCurrentGroup();
        });
    }

    computeVersionBlocks() {
        const blocks = [];
        let current = null;

        for (const seg of this.segments) {
            const colorKey = `${seg.color}_${seg.isMissing}`;
            if (!current || current.colorKey !== colorKey) {
                current = {
                    index: blocks.length,
                    colorKey,
                    color: seg.color,
                    isMissing: seg.isMissing,
                    segments: [seg],
                };
                blocks.push(current);
            } else {
                current.segments.push(seg);
            }
        }

        for (const block of blocks) {
            for (const seg of block.segments) {
                seg.versionBlockIndex = block.index;
            }
        }

        return blocks;
    }

    // (Re)builds segment state from the server-rendered segment elements. Called on
    // load and again whenever a criteria change swaps in freshly colored segments.
    readSegments() {
        const segmentNodes = this.segmentsGroup.querySelectorAll('.timeline-segment');
        this.segments = Array.from(segmentNodes).map((node, index) => {
            const pillEl = node.querySelector('.segment-pill');
            const rectEl = node.querySelector('.segment-focus-rect');
            const lineEls = Array.from(node.querySelectorAll('line'));
            return {
                id: node.dataset.snapId || '',
                name: node.dataset.snapName || '',
                time: node.dataset.snapTime || '',
                isMissing: node.dataset.isMissing === 'true',
                color: node.dataset.color || '',
                index,
                versionBlockIndex: 0,
                element: node,
                pillEl,
                rectEl,
                lineEls,
                currentX: 0,
                // Cached so "show all" can restore the server-rendered (possibly
                // merged-run) layout exactly, instead of trying to recompute it.
                origPillD: pillEl ? pillEl.getAttribute('d') : '',
                origRectX: rectEl ? rectEl.getAttribute('x') : '0',
                origLineCoords: lineEls.map((l) => ({
                    x1: l.getAttribute('x1'),
                    x2: l.getAttribute('x2'),
                    y1: l.getAttribute('y1'),
                    y2: l.getAttribute('y2'),
                })),
            };
        });

        this.versionBlocks = this.computeVersionBlocks();
    }

    initTimeline() {
        if (!this.timelineSvg) return;

        this.readSegments();
        // Criteria changes only recolor, never add or remove snapshots, so the
        // server-rendered sizing stays valid for the page's whole lifetime.
        this.origViewBox = this.timelineSvg.getAttribute('viewBox');
        this.origMinWidth = this.timelineSvg.style.minWidth;
        this.origMaxWidth = this.timelineSvg.style.maxWidth;

        this.hideUnchanged = localStorage.getItem('use_diff_hide_unchanged') !== 'false';

        if (this.initialSnapshots.length > 0) {
            this.initialSnapshots.forEach((id) => this.selectedSnapshotIds.add(id));
        }
        if (this.selectedSnapshotIds.size < 2 && this.segments.length >= 2) {
            this.selectedSnapshotIds.add(this.segments[0].id);
            this.selectedSnapshotIds.add(this.segments[1].id);
        }
        if (this.hideUnchanged) this.remapSelectionToRepresentatives();

        this.timelineSvg.addEventListener('mousedown', (e) => this.onTimelineMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onTimelineMouseMove(e));
        window.addEventListener('mouseup', () => this.onTimelineMouseUp());
        this.timelineSvg.addEventListener('mouseleave', () => this.clearVersionHover());

        this.layoutTimeline();
        this.updateSnapshotGroups();

        if (this.initialSnapshots.length > 0 && this.groups.length > 0) {
            const matchIdx = this.groups.findIndex((g) => {
                if (g.length !== this.initialSnapshots.length) return false;
                for (let i = 0; i < g.length; i++) {
                    if (!this.initialSnapshots.includes(g[i].id)) return false;
                }
                return true;
            });
            if (matchIdx >= 0) {
                this.activeGroupIndex = matchIdx;
            }
        }

        this.updateTimelineUI();
    }

    isRepresentative(seg) {
        const block = this.versionBlocks[seg.versionBlockIndex];
        return Boolean(block && block.segments[block.segments.length - 1] === seg);
    }

    // If the current selection includes a snapshot that's about to be hidden (not the
    // most recent one in its unchanged run), snap it to that run's representative
    // instead, so hiding never silently strands the selection on invisible pills.
    remapSelectionToRepresentatives() {
        const remapped = new Set();
        for (const id of this.selectedSnapshotIds) {
            const seg = this.segments.find((s) => s.id === id);
            if (!seg) continue;
            const block = this.versionBlocks[seg.versionBlockIndex];
            const rep = block ? block.segments[block.segments.length - 1] : seg;
            remapped.add(rep.id);
        }
        if (remapped.size < 2) {
            for (const block of this.versionBlocks) {
                remapped.add(block.segments[block.segments.length - 1].id);
                if (remapped.size >= 2) break;
            }
        }
        this.selectedSnapshotIds = remapped;
    }

    pillPathIsolated(x) {
        const r = 5;
        const y = 10;
        const w = 20;
        const h = 16;
        return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    }

    // Lays out the timeline for the current hideUnchanged state. When hiding, only
    // each unchanged run's representative pill is shown, repacked left-to-right with
    // no gaps left by the hidden ones — an actual filter, not just dimming. When
    // showing all, restores the exact server-rendered (possibly merged-run) layout.
    layoutTimeline() {
        const cellW = 20;

        if (!this.hideUnchanged) {
            for (const seg of this.segments) {
                seg.element.style.display = '';
                if (seg.pillEl) seg.pillEl.setAttribute('d', seg.origPillD);
                if (seg.rectEl) seg.rectEl.setAttribute('x', seg.origRectX);
                seg.lineEls.forEach((l, i) => {
                    const c = seg.origLineCoords[i];
                    if (!c) return;
                    l.setAttribute('x1', c.x1);
                    l.setAttribute('x2', c.x2);
                    l.setAttribute('y1', c.y1);
                    l.setAttribute('y2', c.y2);
                });
                seg.currentX = Number(seg.origRectX) || 0;
            }
            if (this.timelineSvg && this.origViewBox) {
                this.timelineSvg.setAttribute('viewBox', this.origViewBox);
                this.timelineSvg.style.minWidth = this.origMinWidth;
                this.timelineSvg.style.maxWidth = this.origMaxWidth;
            }
            return;
        }

        const visible = this.segments.filter((seg) => this.isRepresentative(seg));
        const visibleIds = new Set(visible.map((s) => s.id));
        // this.segments (and therefore `visible`) stays in newest-first order for the
        // pairing/grouping logic elsewhere, but the timeline displays oldest-to-newest
        // (left-to-right), so the x position is the mirrored index.
        visible.forEach((seg, vIdx) => {
            const x = (visible.length - 1 - vIdx) * cellW;
            seg.element.style.display = '';
            seg.currentX = x;
            if (seg.pillEl) seg.pillEl.setAttribute('d', this.pillPathIsolated(x));
            if (seg.rectEl) seg.rectEl.setAttribute('x', String(x));
            if (seg.lineEls.length === 2) {
                seg.lineEls[0].setAttribute('x1', String(x + 3));
                seg.lineEls[0].setAttribute('x2', String(x + 17));
                seg.lineEls[1].setAttribute('x1', String(x + 17));
                seg.lineEls[1].setAttribute('x2', String(x + 3));
            }
        });
        for (const seg of this.segments) {
            if (!visibleIds.has(seg.id)) seg.element.style.display = 'none';
        }

        const totalW = visible.length * cellW;
        if (this.timelineSvg) {
            this.timelineSvg.setAttribute('viewBox', `-1 -6 ${totalW + 2} 34`);
            // Same bounded sizing as the initial render: close to square, a little
            // wider when few pills are visible, squished rather than stretched when many.
            const minCell = 8;
            const maxCell = 28;
            this.timelineSvg.style.minWidth = `${visible.length * minCell}px`;
            this.timelineSvg.style.maxWidth = `${visible.length * maxCell}px`;
        }
    }

    initHideToggle() {
        const checkbox = document.getElementById('diff-hide-unchanged-check');
        if (checkbox) checkbox.checked = this.hideUnchanged;

        checkbox?.addEventListener('change', (e) => {
            this.hideUnchanged = Boolean(e.target.checked);
            localStorage.setItem('use_diff_hide_unchanged', String(this.hideUnchanged));
            if (this.hideUnchanged) this.remapSelectionToRepresentatives();
            this.activeGroupIndex = 0;
            this.layoutTimeline();
            this.updateSnapshotGroups();
            this.updateTimelineUI();
            this.loadCurrentGroup();
        });
    }

    getSegmentFromEvent(e) {
        const target = e.target;
        const segmentEl = target.closest('.timeline-segment');
        if (!segmentEl) return null;
        const idx = Number.parseInt(segmentEl.dataset.snapIndex || '-1', 10);
        return this.segments[idx] || null;
    }

    onTimelineMouseDown(e) {
        const segment = this.getSegmentFromEvent(e);
        if (!segment) return;
        e.preventDefault();
        this.isDragging = true;
        this.dragIsCtrl = Boolean(e.ctrlKey || e.metaKey);
        this.dragStartIndex = segment.index;
        this.dragRange = new Set([segment.index]);
        this.updateDragPreview();
    }

    onTimelineMouseMove(e) {
        const segment = this.getSegmentFromEvent(e);
        if (this.isDragging && this.dragStartIndex >= 0) {
            if (!segment) return;
            const start = Math.min(this.dragStartIndex, segment.index);
            const end = Math.max(this.dragStartIndex, segment.index);
            this.dragRange = new Set();
            for (let i = start; i <= end; i++) {
                this.dragRange.add(i);
            }
            this.updateDragPreview();
        } else if (segment) {
            this.highlightVersionHover(segment.versionBlockIndex);
        } else {
            this.clearVersionHover();
        }
    }

    highlightVersionHover(blockIdx) {
        for (const seg of this.segments) {
            seg.element.classList.toggle('version-hover', seg.versionBlockIndex === blockIdx);
        }
    }

    clearVersionHover() {
        for (const seg of this.segments) {
            seg.element.classList.remove('version-hover');
        }
    }

    onTimelineMouseUp() {
        if (!this.isDragging) return;
        this.isDragging = false;
        for (const seg of this.segments) {
            seg.element.classList.remove('drag-hover');
        }

        if (this.dragRange.size > 1) {
            const touchedIds = this.collectIdsForIndices(this.dragRange);
            if (!this.dragIsCtrl) this.selectedSnapshotIds.clear();
            for (const id of touchedIds) this.selectedSnapshotIds.add(id);
            this.activeGroupIndex = 0;
            this.updateSnapshotGroups();
            this.updateTimelineUI();
            this.loadCurrentGroup();
        } else if (this.dragStartIndex >= 0 && this.segments[this.dragStartIndex]) {
            const touchedIds = this.collectIdsForIndices(new Set([this.dragStartIndex]));
            if (this.dragIsCtrl) {
                const allSelected = touchedIds.every((id) => this.selectedSnapshotIds.has(id));
                for (const id of touchedIds) {
                    if (allSelected) this.selectedSnapshotIds.delete(id);
                    else this.selectedSnapshotIds.add(id);
                }
            } else {
                this.selectedSnapshotIds.clear();
                for (const id of touchedIds) this.selectedSnapshotIds.add(id);
            }
            this.activeGroupIndex = 0;
            this.updateSnapshotGroups();
            this.updateTimelineUI();
            this.loadCurrentGroup();
        }
        this.dragStartIndex = -1;
        this.dragRange.clear();
    }

    // Maps raw segment indices (which may span hidden duplicates) to the snapshot ids
    // that a click/drag should actually select: the whole block's representative when
    // hiding unchanged runs, or the literal snapshots themselves when showing all.
    collectIdsForIndices(indexSet) {
        if (this.hideUnchanged) {
            const blocks = new Set();
            for (const idx of indexSet) {
                const seg = this.segments[idx];
                if (seg) blocks.add(seg.versionBlockIndex);
            }
            return [...blocks].map((bIdx) => {
                const block = this.versionBlocks[bIdx];
                return block.segments[block.segments.length - 1].id;
            });
        }
        return [...indexSet].map((idx) => this.segments[idx]?.id).filter(Boolean);
    }

    updateDragPreview() {
        for (const seg of this.segments) {
            if (this.dragRange.has(seg.index)) seg.element.classList.add('drag-hover');
            else seg.element.classList.remove('drag-hover');
        }
    }

    isSegmentSelected(seg) {
        return this.selectedSnapshotIds.has(seg.id);
    }

    updateSnapshotGroups() {
        this.groups = [];
        let groupSize = 2;
        if (this.activePlugin) {
            if (this.activePlugin.maxSnapshots === Infinity && this.groupSizeInput) {
                groupSize = parseInt(this.groupSizeInput.value, 10) || 2;
            } else {
                groupSize = this.activePlugin.maxSnapshots || 2;
            }
        }

        let selected = this.segments.filter((s) => this.selectedSnapshotIds.has(s.id));

        // When hiding unchanged runs, extend the newest selected block back to its
        // newest member so the first transition compares against the true newest
        // state, not just the oldest snapshot that still had it.
        if (this.hideUnchanged && selected.length > 0) {
            const firstBlock = this.versionBlocks[selected[0].versionBlockIndex];
            if (firstBlock && firstBlock.segments.length > 1 && firstBlock.segments[0] !== selected[0]) {
                selected = [firstBlock.segments[0], ...selected];
            }
        }

        if (selected.length >= groupSize) {
            for (let i = 0; i <= selected.length - groupSize; i++) {
                this.groups.push(selected.slice(i, i + groupSize));
            }
        } else if (selected.length >= 2) {
            this.groups.push(selected);
        }

        // `selected` (and therefore each group's internal newer/older order, which the
        // plugin relies on for left/right diff semantics) stays newest-first, but the
        // step sequence itself should read like the timeline: Step 1 = oldest
        // transition, Step N = newest, and "next" moves forward in time.
        this.groups.reverse();

        if (this.activeGroupIndex >= this.groups.length) {
            this.activeGroupIndex = Math.max(0, this.groups.length - 1);
        }

        this.updateStepperUI();
    }

    updateTimelineUI() {
        const activeGroup = this.groups[this.activeGroupIndex] || [];
        const activeIds = new Set(activeGroup.map((s) => s.id));

        for (const seg of this.segments) {
            const isSelected = this.isSegmentSelected(seg);
            const isActive = activeIds.has(seg.id);

            seg.element.classList.toggle('selected', isSelected);
            seg.element.classList.toggle('active-group-member', isActive);
        }

        const bracket = this.timelineSvg?.querySelector('#active-pair-bracket');
        if (bracket) {
            // Bracket only across segments actually visible on the (possibly
            // compacted) timeline; a hidden group member has no coordinate to
            // bracket, and currentX (not the raw index) reflects any compaction.
            const visibleActive = activeGroup.filter((s) => s.element.style.display !== 'none');
            if (visibleActive.length >= 2) {
                const xs = visibleActive.map((s) => s.currentX + 10);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);

                let d = `M ${minX} 8.5 V 1.5 H ${maxX} V 8.5`;
                // Add middle prongs
                for (let i = 1; i < visibleActive.length - 1; i++) {
                    const prongX = visibleActive[i].currentX + 10;
                    d += ` M ${prongX} 1.5 V 8.5`;
                }

                bracket.setAttribute('d', d);
                bracket.style.display = '';
            } else {
                bracket.setAttribute('d', '');
                bracket.style.display = 'none';
            }
        }
    }

    initStepper() {
        if (!this.stepperPrevBtn || !this.stepperNextBtn) return;
        this.stepperPrevBtn.addEventListener('click', () => {
            if (this.activeGroupIndex > 0) this.setGroupIndex(this.activeGroupIndex - 1);
        });
        this.stepperNextBtn.addEventListener('click', () => {
            if (this.activeGroupIndex < this.groups.length - 1) this.setGroupIndex(this.activeGroupIndex + 1);
        });
    }

    updateStepperUI() {
        if (!this.stepperContainer) return;

        if (this.groups.length > 1) {
            this.stepperContainer.style.display = 'inline-flex';
            this.stepperLabel.textContent = `Step ${this.activeGroupIndex + 1} / ${this.groups.length}`;
            this.stepperPrevBtn.disabled = this.activeGroupIndex === 0;
            this.stepperNextBtn.disabled = this.activeGroupIndex === this.groups.length - 1;
        } else if (this.groups.length === 1) {
            this.stepperContainer.style.display = 'inline-flex';
            this.stepperLabel.textContent = 'Step 1 / 1';
            this.stepperPrevBtn.disabled = true;
            this.stepperNextBtn.disabled = true;
        } else {
            this.stepperContainer.style.display = 'none';
        }
    }

    setGroupIndex(index) {
        if (index < 0 || index >= this.groups.length || index === this.activeGroupIndex) return;
        if (this.activePlugin?.getScrollPosition) {
            this.scrollMemory = this.activePlugin.getScrollPosition();
        }
        this.activeGroupIndex = index;
        this.updateTimelineUI();
        this.updateStepperUI();
        this.loadCurrentGroup();
    }

    initKeyboardNav() {
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if (e.key === 'ArrowLeft' && this.groups.length > 1) {
                e.preventDefault();
                if (this.activeGroupIndex > 0) this.setGroupIndex(this.activeGroupIndex - 1);
            } else if (e.key === 'ArrowRight' && this.groups.length > 1) {
                e.preventDefault();
                if (this.activeGroupIndex < this.groups.length - 1) this.setGroupIndex(this.activeGroupIndex + 1);
            }
        });
    }

    async loadCurrentGroup() {
        if (!this.activePlugin) return;

        if (this.groups.length === 0) {
            const i18n = window.clientI18n || {};
            const hint =
                i18n['diff.select_snapshots_hint'] ||
                `Select at least ${this.activePlugin.minSnapshots || 2} snapshots.`;
            if (this.viewport) {
                this.viewport.innerHTML = `
                    <div class="diff-message-box">
                        <span>${escapeHtml(hint)}</span>
                    </div>
                `;
            }
            return;
        }

        const currentGroup = this.groups[this.activeGroupIndex];
        if (!currentGroup) return;

        if (!this.scrollMemory && this.activePlugin.getScrollPosition) {
            this.scrollMemory = this.activePlugin.getScrollPosition();
        }

        const snapIds = currentGroup.map((s) => s.id).join(',');
        const cacheKey = `${this.rootName}:${this.filePath}:${snapIds}:${this.activePlugin.id}`;

        if (this.diffCache.has(cacheKey)) {
            const data = this.diffCache.get(cacheKey);
            this.renderDiff(data, currentGroup);
            return;
        }

        this.showLoading(true);
        try {
            let apiUrl = `/api/diff/${encodeURIComponent(this.rootName)}`;
            if (this.filePath?.trim()) {
                apiUrl += `/-/${this.filePath.split('/').map(encodeURIComponent).join('/')}`;
            }
            apiUrl += `?snapshots=${encodeURIComponent(snapIds)}&plugin=${encodeURIComponent(this.activePlugin.id)}`;

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Diff API failed with status ${response.status}`);
            }
            const data = await response.json();
            this.diffCache.set(cacheKey, data);
            this.renderDiff(data, currentGroup);
        } catch (err) {
            console.error('[DifferHost] Failed loading diff:', err);
            this.viewport.innerHTML = `
                <div class="diff-message-box">
                    <span style="color: #ef4444; font-weight: 600;">Failed to load diff</span>
                    <span>${escapeHtml(err.message || String(err))}</span>
                </div>
            `;
        } finally {
            this.showLoading(false);
        }
    }

    renderDiff(data, group) {
        if (!this.activePlugin) return;

        // Pass first two as left/right for backwards compatibility with text differ which still expects left/right for 2-way
        this.activePlugin.render(this.viewport, data, {
            leftSnapshot: group[0],
            rightSnapshot: group[1],
            snapshots: group,
            scrollMemory: this.scrollMemory,
        });

        if (this.scrollMemory && this.activePlugin.setScrollPosition) {
            this.activePlugin.setScrollPosition(this.scrollMemory);
        }
    }

    showLoading(show) {
        if (this.loadingIndicator) {
            this.loadingIndicator.style.display = show ? 'flex' : 'none';
        }
    }
}

window.DifferHost = DifferHost;
document.addEventListener('DOMContentLoaded', () => {
    window.differHost = new DifferHost();
});
