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

        this.mode = localStorage.getItem('use_diff_timeline_mode') || 'changes'; // 'changes' | 'all'
        this.segments = [];
        this.versionBlocks = [];
        this.selectedBlockIndices = new Set();
        this.selectedSnapshotIds = new Set();
        this.activeGroupIndex = 0;
        this.groups = [];
        this.diffCache = new Map();
        this.scrollMemory = null;
        this.plugins = new Map();
        this.activePlugin = null;

        this.isDragging = false;
        this.dragStartIndex = -1;
        this.dragRange = new Set();
        this.dragIsCtrl = false;

        this.initTimeline();
        this.initModes();
        this.initStepper();
        this.initPluginSelector();
        this.initKeyboardNav();
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
            if (isNaN(val) || val < (this.activePlugin?.minSnapshots || 2)) {
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

    initTimeline() {
        if (!this.timelineSvg) return;

        const segmentNodes = this.timelineSvg.querySelectorAll('.timeline-segment');
        this.segments = Array.from(segmentNodes).map((node, index) => {
            return {
                id: node.dataset.snapId || '',
                name: node.dataset.snapName || '',
                time: node.dataset.snapTime || '',
                isMissing: node.dataset.isMissing === 'true',
                color: node.dataset.color || '',
                index,
                versionBlockIndex: 0,
                element: node,
            };
        });

        this.versionBlocks = this.computeVersionBlocks();

        this.selectedBlockIndices = new Set(this.versionBlocks.map((b) => b.index));

        if (this.initialSnapshots.length > 0) {
            this.initialSnapshots.forEach((id) => this.selectedSnapshotIds.add(id));
        }
        if (this.selectedSnapshotIds.size < 2 && this.segments.length >= 2) {
            this.selectedSnapshotIds.add(this.segments[0].id);
            this.selectedSnapshotIds.add(this.segments[1].id);
        }

        this.timelineSvg.addEventListener('mousedown', (e) => this.onTimelineMouseDown(e));
        window.addEventListener('mousemove', (e) => this.onTimelineMouseMove(e));
        window.addEventListener('mouseup', () => this.onTimelineMouseUp());
        this.timelineSvg.addEventListener('mouseleave', () => this.clearVersionHover());

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

    initModes() {
        const btnModeChanges = document.getElementById('btn-mode-changes');
        const btnModeAll = document.getElementById('btn-mode-all');

        const setMode = (newMode) => {
            if (this.mode === newMode) return;
            this.mode = newMode;
            localStorage.setItem('use_diff_timeline_mode', newMode);

            if (btnModeChanges) btnModeChanges.classList.toggle('active', newMode === 'changes');
            if (btnModeAll) btnModeAll.classList.toggle('active', newMode === 'all');

            if (newMode === 'changes') {
                this.selectedBlockIndices = new Set(this.versionBlocks.map((b) => b.index));
            } else {
                const currentGroup = this.groups[this.activeGroupIndex] || [];
                this.selectedSnapshotIds.clear();
                if (currentGroup.length > 0) {
                    currentGroup.forEach((s) => this.selectedSnapshotIds.add(s.id));
                } else if (this.segments.length >= 2) {
                    this.selectedSnapshotIds.add(this.segments[0].id);
                    this.selectedSnapshotIds.add(this.segments[1].id);
                }
            }

            this.activeGroupIndex = 0;
            this.updateSnapshotGroups();
            this.updateTimelineUI();
            this.loadCurrentGroup();
        };

        btnModeChanges?.addEventListener('click', () => setMode('changes'));
        btnModeAll?.addEventListener('click', () => setMode('all'));

        if (btnModeChanges) btnModeChanges.classList.toggle('active', this.mode === 'changes');
        if (btnModeAll) btnModeAll.classList.toggle('active', this.mode === 'all');
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
        } else if (this.mode === 'changes' && segment) {
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
            if (this.mode === 'changes') {
                const touchedBlocks = new Set();
                for (const idx of this.dragRange) {
                    if (this.segments[idx]) touchedBlocks.add(this.segments[idx].versionBlockIndex);
                }
                if (!this.dragIsCtrl) this.selectedBlockIndices.clear();
                for (const bIdx of touchedBlocks) this.selectedBlockIndices.add(bIdx);
            } else {
                if (!this.dragIsCtrl) this.selectedSnapshotIds.clear();
                for (const idx of this.dragRange) {
                    if (this.segments[idx]) this.selectedSnapshotIds.add(this.segments[idx].id);
                }
            }
            this.activeGroupIndex = 0;
            this.updateSnapshotGroups();
            this.updateTimelineUI();
            this.loadCurrentGroup();
        } else if (this.dragStartIndex >= 0 && this.segments[this.dragStartIndex]) {
            const seg = this.segments[this.dragStartIndex];
            if (this.mode === 'changes') {
                const blockIdx = seg.versionBlockIndex;
                if (this.dragIsCtrl) {
                    if (this.selectedBlockIndices.has(blockIdx)) this.selectedBlockIndices.delete(blockIdx);
                    else this.selectedBlockIndices.add(blockIdx);
                    this.activeGroupIndex = 0;
                } else {
                    this.selectedBlockIndices.clear();
                    this.selectedBlockIndices.add(blockIdx);
                    this.activeGroupIndex = 0;
                }
            } else {
                if (this.dragIsCtrl) {
                    if (this.selectedSnapshotIds.has(seg.id)) this.selectedSnapshotIds.delete(seg.id);
                    else this.selectedSnapshotIds.add(seg.id);
                    this.activeGroupIndex = 0;
                } else {
                    this.selectedSnapshotIds.clear();
                    this.selectedSnapshotIds.add(seg.id);
                    this.activeGroupIndex = 0;
                }
            }
            this.updateSnapshotGroups();
            this.updateTimelineUI();
            this.loadCurrentGroup();
        }
        this.dragStartIndex = -1;
        this.dragRange.clear();
    }

    updateDragPreview() {
        for (const seg of this.segments) {
            if (this.dragRange.has(seg.index)) seg.element.classList.add('drag-hover');
            else seg.element.classList.remove('drag-hover');
        }
    }

    isSegmentSelected(seg) {
        if (this.mode === 'changes') return this.selectedBlockIndices.has(seg.versionBlockIndex);
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

        let selected = [];
        if (this.mode === 'changes') {
            const activeBlocks = this.versionBlocks.filter((b) => this.selectedBlockIndices.has(b.index));
            if (activeBlocks.length > 0) {
                selected = activeBlocks.map((b) => b.segments[b.segments.length - 1]);
                if (activeBlocks[0].segments.length > 1) {
                    selected.unshift(activeBlocks[0].segments[0]); // to get the full transition
                }
            }
        } else {
            selected = this.segments.filter((s) => this.selectedSnapshotIds.has(s.id));
        }

        if (selected.length >= groupSize) {
            for (let i = 0; i <= selected.length - groupSize; i++) {
                this.groups.push(selected.slice(i, i + groupSize));
            }
        } else if (selected.length >= 2) {
            this.groups.push(selected);
        }

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
            if (activeGroup.length >= 2) {
                const indices = activeGroup.map((s) => s.index);
                const minIdx = Math.min(...indices);
                const maxIdx = Math.max(...indices);

                const minX = minIdx * 20 + 10;
                const maxX = maxIdx * 20 + 10;

                let d = `M ${minX} 8.5 V 1.5 H ${maxX} V 8.5`;
                // Add middle prongs
                for (let i = 1; i < activeGroup.length - 1; i++) {
                    const prongX = activeGroup[i].index * 20 + 10;
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
