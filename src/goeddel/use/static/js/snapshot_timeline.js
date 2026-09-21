/**
 * Universal Snapshot Explorer (USE) - SnapshotTimelinePanel
 *
 * Sticky bottom panel with two coordinated timelines:
 *  - Filter timeline: the full snapshot history for the current root/file, with two
 *    draggable delimiters marking a date range (Chrome DevTools Network-panel style).
 *  - Selection timeline: only the snapshots inside that filtered range, stretched to
 *    fill the available width (the filter acts as a zoom). Blocks are clickable.
 *
 * Supports 3 layout variants (side-by-side / stacked / scrollbar-zoom), a draggable
 * height resizer (collapsible down to just the grab handle), density-aware grouping
 * (snapshots too close together at the current zoom level merge into a vertical
 * "stack" bucketed by hour/day/week), smart date axis labels, quick-range presets,
 * and wheel-based zoom (vertical scroll) / pan (horizontal scroll) of the filter window.
 */
(() => {
    const SECOND = 1000;
    const MINUTE = 60000;
    const HOUR = 3600000;
    const DAY = 86400000;
    const WEEK = 7 * DAY;

    const MIN_TICK_SPACING_PX = 6;
    const MIN_AXIS_LABEL_SPACING_PX = 70;

    const PANEL_MIN_HEIGHT = 80;
    const PANEL_MAX_HEIGHT = 420;
    const PANEL_DEFAULT_HEIGHT = 160;
    const PANEL_COLLAPSE_THRESHOLD = 50;

    const SCALE_MIN = 0.6;
    const SCALE_MAX = 2;
    const SCALE_STEP = 0.1;

    /**
     * Compute tick/stack placement for a set of chronologically-sorted entries within
     * [domainStart, domainEnd] across a track of `widthPx` pixels. Pure function of its
     * inputs so it can be re-run on every resize/zoom/layout change.
     */
    function computeTickLayout(entries, domainStart, domainEnd, widthPx) {
        if (!entries.length || widthPx <= 0) return [];
        const span = Math.max(1, domainEnd - domainStart);

        const toX = (ts) => {
            const clamped = Math.min(Math.max(ts, domainStart), domainEnd);
            return ((clamped - domainStart) / span) * widthPx;
        };

        const minSpacingTs = (MIN_TICK_SPACING_PX / widthPx) * span;
        let needsGrouping = false;
        for (let i = 1; i < entries.length; i++) {
            if (entries[i].ts - entries[i - 1].ts < minSpacingTs) {
                needsGrouping = true;
                break;
            }
        }

        if (!needsGrouping) {
            return entries.map((entry) => ({ type: 'tick', entry, x: toX(entry.ts) }));
        }

        // Bucket granularity is chosen from the CURRENT domain span (zoom level), not
        // total history, so the same dataset groups differently when zoomed in vs out.
        let bucketMs = WEEK;
        if (span <= 2 * DAY) bucketMs = HOUR;
        else if (span <= 60 * DAY) bucketMs = DAY;

        const buckets = new Map();
        entries.forEach((entry) => {
            const key = Math.floor(entry.ts / bucketMs);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(entry);
        });

        const rawItems = Array.from(buckets.values())
            .map((group) => ({
                entries: group,
                ts: group.reduce((s, e) => s + e.ts, 0) / group.length,
            }))
            .sort((a, b) => a.ts - b.ts);

        // Merge adjacent buckets that still end up closer than MIN_TICK_SPACING_PX apart.
        const merged = [];
        rawItems.forEach((item) => {
            const x = toX(item.ts);
            const last = merged[merged.length - 1];
            if (last && x - last.x < MIN_TICK_SPACING_PX) {
                last.entries = last.entries.concat(item.entries);
                last.ts = last.entries.reduce((s, e) => s + e.ts, 0) / last.entries.length;
                last.x = toX(last.ts);
            } else {
                merged.push({ entries: item.entries, ts: item.ts, x });
            }
        });

        return merged.map((item) =>
            item.entries.length === 1
                ? { type: 'tick', entry: item.entries[0], x: item.x }
                : { type: 'stack', entries: item.entries, x: item.x },
        );
    }

    /**
     * Choose a "nice" calendar-aware tick step for a date axis spanning
     * [domainStart, domainEnd] over `widthPx` pixels, and generate aligned tick
     * timestamps. Sub-day steps use fixed millisecond increments; month/year steps
     * walk the calendar (via Date.setMonth/setFullYear) so they land on real month/
     * year boundaries regardless of month length or leap years.
     */
    function generateAxisTicks(domainStart, domainEnd, widthPx) {
        const span = domainEnd - domainStart;
        if (span <= 0 || widthPx <= 0) return [];
        const maxTicks = Math.max(2, Math.floor(widthPx / MIN_AXIS_LABEL_SPACING_PX));

        const fixedSteps = [
            SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
            MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
            HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
            DAY, 2 * DAY, WEEK,
        ];
        for (const step of fixedSteps) {
            if (span / step <= maxTicks) {
                const ticks = [];
                for (let t = Math.ceil(domainStart / step) * step; t <= domainEnd; t += step) {
                    ticks.push({ ts: t, stepMs: step });
                }
                return ticks;
            }
        }

        for (const n of [1, 3, 6]) {
            if (span / (n * 30 * DAY) <= maxTicks) {
                const ticks = [];
                const d = new Date(domainStart);
                d.setHours(0, 0, 0, 0);
                d.setDate(1);
                if (d.getTime() < domainStart) d.setMonth(d.getMonth() + n);
                while (d.getTime() <= domainEnd) {
                    ticks.push({ ts: d.getTime(), stepMs: n * 30 * DAY });
                    d.setMonth(d.getMonth() + n);
                }
                return ticks;
            }
        }

        for (const n of [1, 2, 5, 10, 25, 50, 100]) {
            if (span / (n * 365 * DAY) <= maxTicks || n === 100) {
                const ticks = [];
                const d = new Date(domainStart);
                d.setMonth(0, 1);
                d.setHours(0, 0, 0, 0);
                if (d.getTime() < domainStart) d.setFullYear(d.getFullYear() + n);
                while (d.getTime() <= domainEnd) {
                    ticks.push({ ts: d.getTime(), stepMs: n * 365 * DAY });
                    d.setFullYear(d.getFullYear() + n);
                }
                return ticks;
            }
        }
        return [];
    }

    /** The app's own selected language (set via the language dropdown, `<html lang="...">`),
     * so date formatting follows that choice rather than the browser/OS locale, which may differ. */
    function appLocale() {
        return document.documentElement.lang || undefined;
    }

    /** Minimal-but-understandable label text for an axis tick, adapted to its granularity. */
    function formatAxisLabel(ts, stepMs, domainCrossesYear) {
        const d = new Date(ts);
        const locale = appLocale();
        if (stepMs < HOUR) {
            return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: stepMs < MINUTE ? '2-digit' : undefined });
        }
        if (stepMs < DAY) {
            return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        }
        if (stepMs < 32 * DAY) {
            return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: domainCrossesYear ? 'numeric' : undefined });
        }
        if (stepMs < 366 * DAY) {
            return d.toLocaleDateString(locale, { month: 'short', year: domainCrossesYear ? 'numeric' : undefined });
        }
        return d.toLocaleDateString(locale, { year: 'numeric' });
    }

    class SnapshotTimelinePanel {
        constructor(panel) {
            this.panel = panel;
            this.dataEl = document.getElementById('snapshot-timeline-data');
            this.rootName = this.dataEl?.dataset.root || '';
            this.currentSnapshotId = this.dataEl?.dataset.currentSnapshot || '';
            this.filterTrack = document.getElementById('snapshot-timeline-filter-canvas');
            this.selectionTrack = document.getElementById('snapshot-timeline-selection-canvas');
            this.filterAxis = document.getElementById('snapshot-timeline-filter-axis');
            this.selectionAxis = document.getElementById('snapshot-timeline-selection-axis');
            this.resizer = document.getElementById('snapshot-timeline-resizer');
            this.splitResizer = document.getElementById('snapshot-timeline-split-resizer');
            this.popoverEl = null;
            this._raf = null;
            this._persistRangeTimeout = null;
            this.lastExpandedHeight = PANEL_DEFAULT_HEIGHT;
            this.scale = 1;

            this.parseData();
            this.loadState();
            this.initLayoutToggle();
            this.initQuickActions();
            this.initScaleControl();
            this.initResizer();
            this.initSplitResizer();
            this.initFilterRangeSelect();
            this.initFilterHoverPreview();
            this.initWheelZoom(this.filterTrack, true);
            this.initWheelZoom(this.selectionTrack, false);
            this.render();

            window.addEventListener('resize', () => this.scheduleRender());
            if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(() => this.scheduleRender()).observe(this.panel);
            }

            // Kept in sync with snapshot switches triggered elsewhere (breadcrumb dropdown,
            // per-row snapshot bar clicks), which navigate in-place via explorer.js.
            document.addEventListener('use:snapshot-changed', (e) => {
                const id = e.detail?.snapshotId;
                if (!id || id === this.currentSnapshotId) return;
                this.currentSnapshotId = id;
                this.render();
            });
        }

        parseData() {
            let raw = [];
            try {
                raw = JSON.parse(this.dataEl?.textContent || '[]');
            } catch (e) {
                raw = [];
            }
            this.entries = raw.filter((e) => !e.isOriginal && typeof e.ts === 'number').sort((a, b) => a.ts - b.ts);
            this.original = raw.find((e) => e.isOriginal) || null;
            // "Original" is the backend's internal name for the live filesystem state;
            // "Live" reads more clearly on the timeline itself.
            if (this.original) this.original.name = window.clientI18n?.['badge.live'] || 'Live';

            if (this.entries.length) {
                this.domainStart = this.entries[0].ts;
                this.domainEnd = this.entries[this.entries.length - 1].ts;
            } else {
                const now = Date.now();
                this.domainStart = now - DAY;
                this.domainEnd = now;
            }
            if (this.domainStart === this.domainEnd) {
                this.domainStart -= HOUR;
                this.domainEnd += HOUR;
            } else {
                const pad = (this.domainEnd - this.domainStart) * 0.02;
                this.domainStart -= pad;
                this.domainEnd += pad;
            }
        }

        loadState() {
            try {
                const layout = localStorage.getItem('use_timeline_layout');
                if (layout) this.panel.dataset.layout = layout;
            } catch (e) {
                /* ignore */
            }

            try {
                const scale = parseFloat(localStorage.getItem('use_timeline_scale'));
                if (!Number.isNaN(scale) && scale >= SCALE_MIN && scale <= SCALE_MAX) this.scale = scale;
            } catch (e) {
                /* ignore */
            }
            this.panel.style.setProperty('--tl-scale', this.scale);

            try {
                const splitPct = localStorage.getItem('use_timeline_split_pct');
                if (splitPct) document.documentElement.style.setProperty('--timeline-split-pct', splitPct);
                const stackSplitPct = localStorage.getItem('use_timeline_stack_split_pct');
                if (stackSplitPct) document.documentElement.style.setProperty('--timeline-stack-split-pct', stackSplitPct);
            } catch (e) {
                /* ignore */
            }

            let collapsed = false;
            try {
                const h = parseInt(localStorage.getItem('use_timeline_panel_height'), 10);
                if (h && h >= PANEL_MIN_HEIGHT && h <= PANEL_MAX_HEIGHT) this.lastExpandedHeight = h;
                collapsed = localStorage.getItem('use_timeline_collapsed') === '1';
            } catch (e) {
                /* ignore */
            }
            this.panel.style.height = `${this.lastExpandedHeight}px`;
            if (collapsed) this.setCollapsed(true);

            this.rangeStart = this.domainStart;
            this.rangeEnd = this.domainEnd;
            try {
                const raw = localStorage.getItem(`use_timeline_range_${this.rootName}`);
                if (raw) {
                    const [s, e] = JSON.parse(raw);
                    if (typeof s === 'number' && typeof e === 'number' && e > s) {
                        this.rangeStart = Math.max(this.domainStart, s);
                        this.rangeEnd = Math.min(this.domainEnd, e);
                    }
                }
            } catch (e) {
                /* ignore */
            }

            this.updatePanelHeightVar();
        }

        persistRange() {
            try {
                localStorage.setItem(`use_timeline_range_${this.rootName}`, JSON.stringify([this.rangeStart, this.rangeEnd]));
            } catch (e) {
                /* ignore */
            }
        }

        persistRangeDebounced() {
            if (this._persistRangeTimeout) clearTimeout(this._persistRangeTimeout);
            this._persistRangeTimeout = setTimeout(() => this.persistRange(), 300);
        }

        updatePanelHeightVar() {
            const h = Math.round(this.panel.getBoundingClientRect().height);
            document.documentElement.style.setProperty('--bottom-panel-height', `${h}px`);
        }

        setCollapsed(collapsed, expandedHeightHint) {
            const wasCollapsed = this.panel.classList.contains('is-collapsed');
            if (collapsed === wasCollapsed) return;
            if (collapsed) {
                this.lastExpandedHeight = Math.round(expandedHeightHint || this.panel.getBoundingClientRect().height || this.lastExpandedHeight);
                this.panel.classList.add('is-collapsed');
            } else {
                this.panel.classList.remove('is-collapsed');
                this.panel.style.height = `${this.lastExpandedHeight}px`;
            }
            try {
                localStorage.setItem('use_timeline_collapsed', collapsed ? '1' : '0');
                if (!collapsed) localStorage.setItem('use_timeline_panel_height', String(this.lastExpandedHeight));
            } catch (e) {
                /* ignore */
            }
            this.updatePanelHeightVar();
            if (!collapsed) this.scheduleRender();
        }

        initLayoutToggle() {
            const buttons = Array.from(this.panel.querySelectorAll('.snapshot-timeline-layout-btn'));
            buttons.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.layoutOption === this.panel.dataset.layout);
                btn.addEventListener('click', () => {
                    const val = btn.dataset.layoutOption;
                    this.panel.dataset.layout = val;
                    buttons.forEach((b) => b.classList.toggle('active', b === btn));
                    try {
                        localStorage.setItem('use_timeline_layout', val);
                    } catch (e) {
                        /* ignore */
                    }
                    this.scheduleRender();
                });
            });
        }

        initQuickActions() {
            const now = Date.now();
            const presets = {
                today: () => [now - DAY, now],
                week: () => [now - 7 * DAY, now],
                month: () => [now - 30 * DAY, now],
                all: () => [this.domainStart, this.domainEnd],
            };
            const buttons = Array.from(this.panel.querySelectorAll('.snapshot-timeline-quick-btn'));
            buttons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const fn = presets[btn.dataset.quickRange];
                    if (!fn) return;
                    let [s, e] = fn();
                    s = Math.max(this.domainStart, s);
                    e = Math.min(this.domainEnd, e);
                    if (e <= s) s = e - MINUTE;
                    this.rangeStart = Math.max(this.domainStart, s);
                    this.rangeEnd = e;
                    this.persistRange();
                    this.render();
                });
            });
        }

        /** Continuous element-size control: one CSS var (--tl-scale) that every
         * --tl-* size in the stylesheet is computed from via calc(), so there's no
         * fixed set of "presets" - just a number the "-"/"+" buttons nudge. */
        initScaleControl() {
            const dec = document.getElementById('snapshot-timeline-density-dec');
            const inc = document.getElementById('snapshot-timeline-density-inc');
            const apply = () => {
                this.scale = Math.round(this.scale * 100) / 100;
                this.panel.style.setProperty('--tl-scale', this.scale);
                try {
                    localStorage.setItem('use_timeline_scale', String(this.scale));
                } catch (e) {
                    /* ignore */
                }
            };
            dec?.addEventListener('click', () => {
                this.scale = Math.max(SCALE_MIN, this.scale - SCALE_STEP);
                apply();
            });
            inc?.addEventListener('click', () => {
                this.scale = Math.min(SCALE_MAX, this.scale + SCALE_STEP);
                apply();
            });
        }

        /** Drag-adjustable split between the filter and selection tracks. In
         * side-by-side this is the filter's width %; in stacked it's the filter's
         * height % (it sits at the bottom, under column-reverse). The resizer IS
         * the gap between the tracks, so this reallocates space rather than adding any.
         * Double-click resets to the default split. */
        initSplitResizer() {
            if (!this.splitResizer) return;

            const layoutOf = () => this.panel.dataset.layout;
            const varFor = (layout) => (layout === 'side-by-side' ? '--timeline-split-pct' : '--timeline-stack-split-pct');
            const storageKeyFor = (layout) => (layout === 'side-by-side' ? 'use_timeline_split_pct' : 'use_timeline_stack_split_pct');

            this.splitResizer.addEventListener('dblclick', (e) => {
                const layout = layoutOf();
                if (layout !== 'side-by-side' && layout !== 'stacked') return;
                e.preventDefault();
                document.documentElement.style.removeProperty(varFor(layout));
                try {
                    localStorage.removeItem(storageKeyFor(layout));
                } catch (err) {
                    /* ignore */
                }
                this.scheduleRender();
            });

            this.splitResizer.addEventListener('mousedown', (e) => {
                const layout = layoutOf();
                if (layout !== 'side-by-side' && layout !== 'stacked') return;
                e.preventDefault();
                const bodyEl = this.splitResizer.parentElement;
                const cssVar = varFor(layout);
                const storageKey = storageKeyFor(layout);
                this.splitResizer.classList.add('is-resizing');

                let rafPending = false;
                let pendingCoord = null;
                const move = (ev) => {
                    pendingCoord = layout === 'side-by-side' ? ev.clientX : ev.clientY;
                    if (rafPending) return;
                    rafPending = true;
                    requestAnimationFrame(() => {
                        rafPending = false;
                        // flex-basis percentages resolve against the CONTENT box, not the
                        // border box getBoundingClientRect() returns - subtract the body's
                        // own padding or the split drifts off by exactly that amount.
                        const rect = bodyEl.getBoundingClientRect();
                        const style = getComputedStyle(bodyEl);
                        let pct;
                        if (layout === 'side-by-side') {
                            const padLeft = parseFloat(style.paddingLeft) || 0;
                            const padRight = parseFloat(style.paddingRight) || 0;
                            const contentWidth = rect.width - padLeft - padRight;
                            pct = ((pendingCoord - (rect.left + padLeft)) / contentWidth) * 100;
                        } else {
                            const padTop = parseFloat(style.paddingTop) || 0;
                            const padBottom = parseFloat(style.paddingBottom) || 0;
                            const contentHeight = rect.height - padTop - padBottom;
                            pct = (((rect.bottom - padBottom) - pendingCoord) / contentHeight) * 100;
                        }
                        pct = Math.min(75, Math.max(15, pct));
                        document.documentElement.style.setProperty(cssVar, `${pct}%`);
                        this.scheduleRender();
                    });
                };
                const up = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    this.splitResizer.classList.remove('is-resizing');
                    try {
                        localStorage.setItem(storageKey, document.documentElement.style.getPropertyValue(cssVar));
                    } catch (err) {
                        /* ignore */
                    }
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }

        /** DevTools-style click+drag on empty filter-track space defines a brand new range. */
        initFilterRangeSelect() {
            const canvas = this.filterTrack;
            if (!canvas) return;
            canvas.addEventListener('mousedown', (e) => {
                if (e.target.closest('.snapshot-timeline-handle')) return;
                e.preventDefault();
                this._isDraggingFilter = true;
                this.setFilterHoverVisible(false);
                const rect = canvas.getBoundingClientRect();
                const startX = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
                const startTs = this.xToTs(startX, this.domainStart, this.domainEnd, rect.width);

                let rafPending = false;
                let pendingX = null;
                const move = (ev) => {
                    pendingX = ev.clientX;
                    if (rafPending) return;
                    rafPending = true;
                    requestAnimationFrame(() => {
                        rafPending = false;
                        const x = Math.min(Math.max(pendingX - rect.left, 0), rect.width);
                        const curTs = this.xToTs(x, this.domainStart, this.domainEnd, rect.width);
                        this.rangeStart = Math.max(this.domainStart, Math.min(startTs, curTs));
                        this.rangeEnd = Math.min(this.domainEnd, Math.max(startTs, curTs, this.rangeStart + 1));
                        this.renderFilterTrack();
                        this.renderSelectionTrack();
                    });
                };
                const up = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    this._isDraggingFilter = false;
                    this.persistRange();
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }

        /** A thin guide line that follows the cursor over the filter track, hinting that
         * click-dragging anywhere (outside the handles) starts a brand new range selection. */
        initFilterHoverPreview() {
            const canvas = this.filterTrack;
            if (!canvas) return;
            this.filterHoverEl = document.createElement('div');
            this.filterHoverEl.className = 'snapshot-timeline-hover-indicator';
            canvas.appendChild(this.filterHoverEl);

            canvas.addEventListener('mousemove', (e) => {
                if (this._isDraggingFilter || e.target.closest('.snapshot-timeline-handle')) {
                    this.setFilterHoverVisible(false);
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                this.filterHoverEl.style.left = `${x}px`;
                this.setFilterHoverVisible(true);
            });
            canvas.addEventListener('mouseleave', () => this.setFilterHoverVisible(false));
        }

        setFilterHoverVisible(visible) {
            this.filterHoverEl?.classList.toggle('visible', visible);
        }

        initResizer() {
            if (!this.resizer) return;
            this.resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const startY = e.clientY;
                const wasCollapsed = this.panel.classList.contains('is-collapsed');
                const startHeight = wasCollapsed ? this.lastExpandedHeight : this.panel.getBoundingClientRect().height;
                this.resizer.classList.add('is-resizing');

                let rafPending = false;
                let pendingY = null;
                let moved = false;
                const move = (ev) => {
                    pendingY = ev.clientY;
                    if (Math.abs(pendingY - startY) > 3) moved = true;
                    if (rafPending) return;
                    rafPending = true;
                    requestAnimationFrame(() => {
                        rafPending = false;
                        const rawHeight = startHeight + (startY - pendingY);
                        if (rawHeight < PANEL_COLLAPSE_THRESHOLD) {
                            if (!this.panel.classList.contains('is-collapsed')) {
                                this.panel.classList.add('is-collapsed');
                            }
                        } else {
                            this.panel.classList.remove('is-collapsed');
                            const newHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, rawHeight));
                            this.panel.style.height = `${newHeight}px`;
                            this.lastExpandedHeight = newHeight;
                        }
                        this.updatePanelHeightVar();
                    });
                };
                const up = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    this.resizer.classList.remove('is-resizing');
                    if (!moved) {
                        this.setCollapsed(!wasCollapsed, startHeight);
                    } else {
                        try {
                            const collapsed = this.panel.classList.contains('is-collapsed');
                            localStorage.setItem('use_timeline_collapsed', collapsed ? '1' : '0');
                            if (!collapsed) localStorage.setItem('use_timeline_panel_height', String(Math.round(this.lastExpandedHeight)));
                        } catch (err) {
                            /* ignore */
                        }
                        if (!this.panel.classList.contains('is-collapsed')) this.scheduleRender();
                    }
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }

        /** Vertical wheel = zoom the filter window centered on the cursor; horizontal = pan it. */
        initWheelZoom(canvasEl, isFilterTrack) {
            if (!canvasEl) return;
            canvasEl.addEventListener(
                'wheel',
                (e) => {
                    e.preventDefault();
                    const rect = canvasEl.getBoundingClientRect();
                    if (rect.width <= 0) return;
                    const x = e.clientX - rect.left;
                    const trackDomainStart = isFilterTrack ? this.domainStart : this.rangeStart;
                    const trackDomainEnd = isFilterTrack ? this.domainEnd : this.rangeEnd;
                    const anchorTs = this.xToTs(x, trackDomainStart, trackDomainEnd, rect.width);

                    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                        this.panRange(e.deltaX);
                    } else if (e.deltaY !== 0) {
                        this.zoomRange(anchorTs, e.deltaY);
                    }
                    this.render();
                    this.persistRangeDebounced();
                },
                { passive: false },
            );
        }

        zoomRange(anchorTs, deltaY) {
            const zoomFactor = 1.03;
            const factor = deltaY > 0 ? zoomFactor : 1 / zoomFactor;
            const curSpan = Math.max(1, this.rangeEnd - this.rangeStart);
            const domainSpan = Math.max(1, this.domainEnd - this.domainStart);
            const minSpan = Math.max(MINUTE, domainSpan * 0.0005);
            const newSpan = Math.min(domainSpan, Math.max(minSpan, curSpan * factor));
            const ratio = (anchorTs - this.rangeStart) / curSpan;

            let newStart = anchorTs - ratio * newSpan;
            let newEnd = newStart + newSpan;
            if (newStart < this.domainStart) {
                newEnd += this.domainStart - newStart;
                newStart = this.domainStart;
            }
            if (newEnd > this.domainEnd) {
                newStart -= newEnd - this.domainEnd;
                newEnd = this.domainEnd;
            }
            this.rangeStart = Math.max(this.domainStart, newStart);
            this.rangeEnd = Math.min(this.domainEnd, newEnd);
        }

        panRange(deltaX) {
            const curSpan = this.rangeEnd - this.rangeStart;
            const shift = (deltaX / 300) * curSpan;
            let newStart = this.rangeStart + shift;
            let newEnd = this.rangeEnd + shift;
            if (newStart < this.domainStart) {
                const d = this.domainStart - newStart;
                newStart += d;
                newEnd += d;
            }
            if (newEnd > this.domainEnd) {
                const d = newEnd - this.domainEnd;
                newStart -= d;
                newEnd -= d;
            }
            this.rangeStart = Math.max(this.domainStart, newStart);
            this.rangeEnd = Math.min(this.domainEnd, newEnd);
        }

        scheduleRender() {
            if (this._raf) return;
            this._raf = requestAnimationFrame(() => {
                this._raf = null;
                this.render();
            });
        }

        render() {
            this.renderFilterTrack();
            this.renderSelectionTrack();
        }

        tsToX(ts, domainStart, domainEnd, widthPx) {
            const span = Math.max(1, domainEnd - domainStart);
            const clamped = Math.min(Math.max(ts, domainStart), domainEnd);
            return ((clamped - domainStart) / span) * widthPx;
        }

        xToTs(x, domainStart, domainEnd, widthPx) {
            const span = Math.max(1, domainEnd - domainStart);
            return domainStart + (Math.min(Math.max(x, 0), widthPx) / widthPx) * span;
        }

        renderAxis(axisEl, domainStart, domainEnd, widthPx) {
            if (!axisEl) return;
            axisEl.innerHTML = '';
            if (widthPx <= 0) return;
            const ticks = generateAxisTicks(domainStart, domainEnd, widthPx);
            const crossesYear = new Date(domainStart).getFullYear() !== new Date(domainEnd).getFullYear();
            ticks.forEach((t) => {
                const x = this.tsToX(t.ts, domainStart, domainEnd, widthPx);
                const mark = document.createElement('div');
                mark.className = 'snapshot-timeline-axis-tick';
                mark.style.left = `${x}px`;
                axisEl.appendChild(mark);

                const label = document.createElement('div');
                label.className = 'snapshot-timeline-axis-label';
                label.style.left = `${Math.min(Math.max(x, 20), widthPx - 20)}px`;
                label.textContent = formatAxisLabel(t.ts, t.stepMs, crossesYear);
                axisEl.appendChild(label);
            });
        }

        renderFilterTrack() {
            const track = this.filterTrack;
            if (!track) return;
            track.innerHTML = '';
            const width = track.getBoundingClientRect().width;
            this.renderAxis(this.filterAxis, this.domainStart, this.domainEnd, width);
            if (width <= 0) return;

            const layout = computeTickLayout(this.entries, this.domainStart, this.domainEnd, width);
            this.renderTicksInto(track, layout, false);

            const x1 = this.tsToX(this.rangeStart, this.domainStart, this.domainEnd, width);
            const x2 = this.tsToX(this.rangeEnd, this.domainStart, this.domainEnd, width);

            const selEl = document.createElement('div');
            selEl.className = 'snapshot-timeline-filter-selection';
            selEl.style.left = `${x1}px`;
            selEl.style.width = `${Math.max(2, x2 - x1)}px`;
            track.appendChild(selEl);

            // Full-height boundary lines, independent of the (shorter) handle hit-areas
            // below, so the line is one continuous element top-to-bottom instead of being
            // stitched together from the handle's own line plus the selection rect's border
            // (which never aligned pixel-for-pixel with it).
            const startLine = document.createElement('div');
            startLine.className = 'snapshot-timeline-range-line';
            startLine.style.left = `${x1}px`;
            track.appendChild(startLine);

            const endLine = document.createElement('div');
            endLine.className = 'snapshot-timeline-range-line';
            endLine.style.left = `${x2}px`;
            track.appendChild(endLine);

            const startHandle = document.createElement('div');
            startHandle.className = 'snapshot-timeline-handle';
            startHandle.style.left = `${x1}px`;
            startHandle.appendChild(document.createElement('div')).className = 'snapshot-timeline-handle-grip';
            startHandle.addEventListener('mousedown', (e) => this.onHandleMouseDown(e, startHandle, 'start'));
            track.appendChild(startHandle);

            const endHandle = document.createElement('div');
            endHandle.className = 'snapshot-timeline-handle';
            endHandle.style.left = `${x2}px`;
            endHandle.appendChild(document.createElement('div')).className = 'snapshot-timeline-handle-grip';
            endHandle.addEventListener('mousedown', (e) => this.onHandleMouseDown(e, endHandle, 'end'));
            track.appendChild(endHandle);

            if (this.filterHoverEl) track.appendChild(this.filterHoverEl);
        }

        onHandleMouseDown(e, handleEl, which) {
            e.preventDefault();
            e.stopPropagation();
            const track = this.filterTrack;
            handleEl.classList.add('is-dragging');
            this._isDraggingFilter = true;
            this.setFilterHoverVisible(false);

            let rafPending = false;
            let pendingX = null;
            const move = (ev) => {
                pendingX = ev.clientX;
                if (rafPending) return;
                rafPending = true;
                requestAnimationFrame(() => {
                    rafPending = false;
                    const rect = track.getBoundingClientRect();
                    const x = pendingX - rect.left;
                    const ts = this.xToTs(x, this.domainStart, this.domainEnd, rect.width);
                    const minGap = Math.max(1, (this.domainEnd - this.domainStart) * 0.005);
                    if (which === 'start') {
                        this.rangeStart = Math.min(Math.max(this.domainStart, ts), this.rangeEnd - minGap);
                    } else {
                        this.rangeEnd = Math.max(Math.min(this.domainEnd, ts), this.rangeStart + minGap);
                    }
                    this.renderFilterTrack();
                    this.renderSelectionTrack();
                });
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                handleEl.classList.remove('is-dragging');
                this._isDraggingFilter = false;
                this.persistRange();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        }

        renderSelectionTrack() {
            const track = this.selectionTrack;
            if (!track) return;
            track.innerHTML = '';
            const width = track.getBoundingClientRect().width;
            this.renderAxis(this.selectionAxis, this.rangeStart, this.rangeEnd, width);
            if (width <= 0) return;

            // "Live" only makes sense as a marker when the current zoom/pan actually
            // reaches the newest end of the timeline - not pinned unconditionally.
            const domainSpan = Math.max(1, this.domainEnd - this.domainStart);
            const showLive = !!this.original && this.rangeEnd >= this.domainEnd - domainSpan * 0.001;

            const reserveForOriginal = showLive ? 14 : 0;
            const usableWidth = Math.max(1, width - reserveForOriginal);
            const filtered = this.entries.filter((e) => e.ts >= this.rangeStart && e.ts <= this.rangeEnd);
            const domainEnd = this.rangeEnd > this.rangeStart ? this.rangeEnd : this.rangeStart + 1;

            const layout = computeTickLayout(filtered, this.rangeStart, domainEnd, usableWidth);
            this.renderTicksInto(track, layout, true);

            if (showLive) {
                const el = this.makeTickElement(this.original, width - 6, true);
                el.classList.add('is-original');
                track.appendChild(el);
            }
        }

        renderTicksInto(track, layout, clickable) {
            layout.forEach((item) => {
                if (item.type === 'tick') {
                    track.appendChild(this.makeTickElement(item.entry, item.x, clickable));
                } else {
                    track.appendChild(this.makeStackElement(item.entries, item.x, clickable));
                }
            });
        }

        makeTickElement(entry, x, clickable) {
            const el = document.createElement('div');
            el.className = 'snapshot-timeline-tick';
            el.style.left = `${x}px`;
            if (entry.id === this.currentSnapshotId) el.classList.add('is-current');
            const timeStr = entry.ts ? new Date(entry.ts).toLocaleString(appLocale()) : '';
            el.title = timeStr ? `${entry.name} — ${timeStr}` : entry.name;
            if (clickable) {
                el.addEventListener('click', () => this.navigateTo(entry));
            }
            return el;
        }

        makeStackElement(entries, x, clickable) {
            const el = document.createElement('div');
            const isCurrent = entries.some((e) => e.id === this.currentSnapshotId);
            el.className = 'snapshot-timeline-stack' + (isCurrent ? ' is-current' : '');
            el.style.left = `${x}px`;

            const shown = Math.min(entries.length, 6);
            for (let i = 0; i < shown; i++) {
                const t = document.createElement('div');
                t.className = 'snapshot-timeline-stack-tick' + (entries[i].id === this.currentSnapshotId ? ' is-current' : '');
                el.appendChild(t);
            }

            const countEl = document.createElement('div');
            countEl.className = 'snapshot-timeline-stack-count';
            countEl.textContent = String(entries.length);
            el.appendChild(countEl);

            const countPattern = window.clientI18n?.['timeline.stack_count'] || '{count} snapshots';
            el.title = countPattern.replace('{count}', String(entries.length));
            if (clickable) {
                el.addEventListener('click', (e) => this.showStackPopover(e, entries));
            }
            return el;
        }

        navigateTo(entry) {
            if (!entry || !entry.id || entry.id === this.currentSnapshotId) return;
            this.currentSnapshotId = entry.id;
            if (window.explorerView && typeof window.explorerView.navigateToSnapshot === 'function') {
                window.explorerView.navigateToSnapshot(entry.id);
                this.renderSelectionTrack();
            } else if (entry.url) {
                window.location.href = entry.url;
            }
        }

        showStackPopover(e, entries) {
            e.stopPropagation();
            this.hidePopover();

            const pop = document.createElement('div');
            pop.className = 'snapshot-timeline-popover visible';
            entries
                .slice()
                .sort((a, b) => a.ts - b.ts)
                .forEach((entry) => {
                    const item = document.createElement('div');
                    item.className = 'snapshot-timeline-popover-item' + (entry.id === this.currentSnapshotId ? ' is-current' : '');
                    const timeStr = entry.ts ? new Date(entry.ts).toLocaleString(appLocale()) : '';
                    item.textContent = timeStr ? `${timeStr} — ${entry.name}` : entry.name;
                    item.addEventListener('click', () => {
                        this.navigateTo(entry);
                        this.hidePopover();
                    });
                    pop.appendChild(item);
                });

            document.body.appendChild(pop);
            const rect = e.currentTarget.getBoundingClientRect();
            const popRect = pop.getBoundingClientRect();
            pop.style.left = `${Math.min(rect.left, window.innerWidth - popRect.width - 8)}px`;
            pop.style.top = `${Math.max(8, rect.top - popRect.height - 6)}px`;
            this.popoverEl = pop;

            const onDocClick = (ev) => {
                if (!pop.contains(ev.target)) {
                    this.hidePopover();
                    document.removeEventListener('click', onDocClick);
                }
            };
            setTimeout(() => document.addEventListener('click', onDocClick), 0);
        }

        hidePopover() {
            if (this.popoverEl) {
                this.popoverEl.remove();
                this.popoverEl = null;
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const panel = document.getElementById('snapshot-timeline-panel');
        if (panel) {
            window.snapshotTimelinePanel = new SnapshotTimelinePanel(panel);
        }
    });

    window.SnapshotTimelinePanel = SnapshotTimelinePanel;
})();
