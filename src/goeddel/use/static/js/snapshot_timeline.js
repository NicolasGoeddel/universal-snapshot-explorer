/**
 * Universal Snapshot Explorer (USE) - SnapshotTimelinePanel
 *
 * Sticky bottom panel with two coordinated timelines:
 *  - Filter timeline: the full snapshot history for the current root/file, with two
 *    draggable delimiters marking a date range (Chrome DevTools Network-panel style).
 *  - Selection timeline: the filtered range, shown through a natively scrolling
 *    viewport (the filter acts as a zoom). Blocks are clickable.
 *
 * Both timelines lay snapshots out once, positioned in percent of the whole history.
 * Zooming only changes the selection content's width (--tl-zoom) and scroll position,
 * and panning is native scrolling; markup is rebuilt only when the zoom level changes
 * how snapshots group, so the browser does the per-frame work.
 *
 * Supports 3 layout variants (side-by-side / stacked / scrollbar-zoom), a draggable
 * height resizer (collapsible down to just the grab handle), density-aware grouping
 * (snapshots too close together at the current zoom level merge into a grid "stack"
 * bucketed by hour/day/week), smart date axis labels, quick-range presets, and
 * wheel-based zoom (vertical scroll) / pan (horizontal scroll).
 */
(() => {
    const SECOND = 1000;
    const MINUTE = 60000;
    const HOUR = 3600000;
    const DAY = 86400000;
    const WEEK = 7 * DAY;

    const MIN_TICK_SPACING_PX = 6;
    const MIN_AXIS_LABEL_SPACING_PX = 70;
    const RANGE_GAP_PX = 2;

    const PANEL_MIN_HEIGHT = 80;
    const PANEL_MAX_HEIGHT = 420;
    const PANEL_DEFAULT_HEIGHT = 160;
    const PANEL_COLLAPSE_THRESHOLD = 50;

    const SCALE_MIN = 0.6;
    const SCALE_MAX = 2;
    const SCALE_STEP = 0.1;

    /**
     * Compute range placement for a set of chronologically-sorted entries within
     * [domainStart, domainEnd] across a track of `widthPx` pixels. Each entry spans
     * from its `ts` to its `endTs` (the next snapshot); items get a start `x` and end
     * `x2`. `visibleSpan` is the time range actually on screen, which picks the grouping
     * granularity. Pure function of its inputs, so it can be re-run on every zoom/resize.
     */
    function computeTickLayout(entries, domainStart, domainEnd, widthPx, visibleSpan = domainEnd - domainStart) {
        if (!entries.length || widthPx <= 0) return [];
        const span = Math.max(1, domainEnd - domainStart);

        const toX = (ts) => {
            const clamped = Math.min(Math.max(ts, domainStart), domainEnd);
            return ((clamped - domainStart) / span) * widthPx;
        };
        const groupExtent = (group) => ({
            x: toX(Math.min(...group.map((e) => e.ts))),
            x2: toX(Math.max(...group.map((e) => e.endTs))),
        });

        const minSpacingTs = (MIN_TICK_SPACING_PX / widthPx) * span;
        let needsGrouping = false;
        for (let i = 1; i < entries.length; i++) {
            if (entries[i].ts - entries[i - 1].ts < minSpacingTs) {
                needsGrouping = true;
                break;
            }
        }

        if (!needsGrouping) {
            return entries.map((entry) => ({ type: 'tick', entry, ...groupExtent([entry]) }));
        }

        // Bucket granularity follows the zoom level, not total history, so the same
        // dataset groups differently when zoomed in vs out.
        let bucketMs = WEEK;
        if (visibleSpan <= 2 * DAY) bucketMs = HOUR;
        else if (visibleSpan <= 60 * DAY) bucketMs = DAY;

        const buckets = new Map();
        entries.forEach((entry) => {
            const key = Math.floor(entry.ts / bucketMs);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(entry);
        });

        const rawItems = Array.from(buckets.values())
            .map((group) => ({
                entries: group,
                ts: Math.min(...group.map((e) => e.ts)),
            }))
            .sort((a, b) => a.ts - b.ts);

        // Merge adjacent buckets whose ranges would still be narrower than MIN_TICK_SPACING_PX.
        const merged = [];
        rawItems.forEach((item) => {
            const x = toX(item.ts);
            const last = merged[merged.length - 1];
            if (last && x - last.x < MIN_TICK_SPACING_PX) {
                last.entries = last.entries.concat(item.entries);
            } else {
                merged.push({ entries: item.entries, x });
            }
        });

        return merged.map((item) =>
            item.entries.length === 1
                ? { type: 'tick', entry: item.entries[0], ...groupExtent(item.entries) }
                : { type: 'stack', entries: item.entries, ...groupExtent(item.entries) },
        );
    }

    /**
     * Drag started by pointer event `e` on `el`: pointer capture keeps pointermove
     * arriving on `el` even outside it, and browsers already deliver it at most once
     * per frame, so no document listeners or requestAnimationFrame throttling needed.
     */
    function dragPointer(el, e, onMove, onEnd) {
        el.setPointerCapture(e.pointerId);
        el.addEventListener('pointermove', onMove);
        el.addEventListener(
            'lostpointercapture',
            () => {
                el.removeEventListener('pointermove', onMove);
                onEnd?.();
            },
            { once: true },
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

    /** Axis labels are redrawn every zoom/scroll frame; creating a formatter is the costly
     * part of toLocale*String, so each distinct locale + options formatter is kept. */
    const dateFormatters = new Map();
    function formatDate(ts, options) {
        const key = appLocale() + JSON.stringify(options);
        if (!dateFormatters.has(key)) dateFormatters.set(key, new Intl.DateTimeFormat(appLocale(), options));
        return dateFormatters.get(key).format(ts);
    }

    /** Minimal-but-understandable label text for an axis tick, adapted to its granularity. */
    function formatAxisLabel(ts, stepMs, domainCrossesYear) {
        const year = domainCrossesYear ? 'numeric' : undefined;
        if (stepMs < HOUR) {
            return formatDate(ts, { hour: '2-digit', minute: '2-digit', second: stepMs < MINUTE ? '2-digit' : undefined });
        }
        if (stepMs < DAY) return formatDate(ts, { hour: '2-digit', minute: '2-digit' });
        if (stepMs < 32 * DAY) return formatDate(ts, { month: 'short', day: 'numeric', year });
        if (stepMs < 366 * DAY) return formatDate(ts, { month: 'short', year });
        return formatDate(ts, { year: 'numeric' });
    }

    class SnapshotTimelinePanel {
        constructor(panel) {
            this.panel = panel;
            this.dataEl = document.getElementById('snapshot-timeline-data');
            this.rootName = this.dataEl?.dataset.root || '';
            this.currentSnapshotId = this.dataEl?.dataset.currentSnapshot || '';
            this.filterTrack = document.getElementById('snapshot-timeline-filter-canvas');
            this.viewport = document.getElementById('snapshot-timeline-selection-viewport');
            this.selectionContent = document.getElementById('snapshot-timeline-selection-canvas');
            this.filterAxis = document.getElementById('snapshot-timeline-filter-axis');
            this.selectionAxis = document.getElementById('snapshot-timeline-selection-axis');
            this.resizer = document.getElementById('snapshot-timeline-resizer');
            this.splitResizer = document.getElementById('snapshot-timeline-split-resizer');
            this.popoverEl = document.getElementById('snapshot-timeline-popover');
            this._raf = null;
            this._applyRaf = null;
            this._persistRangeTimeout = null;
            this.lastExpandedHeight = PANEL_DEFAULT_HEIGHT;
            this.scale = 1;
            // Cached so zoom/scroll never have to measure the DOM; refreshed on resize.
            this.filterWidth = 0;
            this.viewportWidth = 0;
            this._expectedScrollLeft = 0;

            this.parseData();
            this.loadState();
            this.filterBars = this.createBarsLayer(this.filterTrack, false);
            this.selectionBars = this.createBarsLayer(this.selectionContent, true);
            this.initLayoutToggle();
            this.initQuickActions();
            this.initScaleControl();
            this.initResizer();
            this.initSplitResizer();
            this.initFilterDrag();
            this.initWheelZoom();
            this.initViewportScroll();
            this.refresh();

            // Covers window resizes, layout switches and split drags alike.
            const observer = new ResizeObserver(() => this.scheduleRefresh());
            observer.observe(this.filterTrack);
            observer.observe(this.viewport);

            // Kept in sync with snapshot switches triggered elsewhere (breadcrumb dropdown,
            // per-row snapshot bar clicks), which navigate in-place via explorer.js.
            document.addEventListener('use:snapshot-changed', (e) => {
                const id = e.detail?.snapshotId;
                if (!id || id === this.currentSnapshotId) return;
                this.currentSnapshotId = id;
                this.markCurrent();
            });
        }

        parseData() {
            let raw = [];
            try {
                raw = JSON.parse(this.dataEl?.textContent || '[]');
            } catch (e) {
                raw = [];
            }
            this.entries = raw.filter((e) => !e.isOriginal && typeof e.ts === 'number');
            // The live filesystem state is a regular timeline entry placed at the present.
            // "Original" is the backend's internal name for it; "Live" reads more clearly here.
            const original = raw.find((e) => e.isOriginal);
            if (original) {
                original.name = window.clientI18n?.['badge.live'] || 'Live';
                original.ts = Date.now();
                this.entries.push(original);
            }
            this.entries.sort((a, b) => a.ts - b.ts);

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

            // Each entry spans until the next one; the last runs to the end of the timeline.
            this.entries.forEach((entry, i) => {
                entry.endTs = i + 1 < this.entries.length ? this.entries[i + 1].ts : this.domainEnd;
            });
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
                    this.scheduleApplyRange();
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
            });

            this.splitResizer.addEventListener('pointerdown', (e) => {
                const layout = layoutOf();
                if (layout !== 'side-by-side' && layout !== 'stacked') return;
                e.preventDefault();
                const bodyEl = this.splitResizer.parentElement;
                const cssVar = varFor(layout);
                this.splitResizer.classList.add('is-resizing');

                // flex-basis percentages resolve against the CONTENT box, not the border
                // box getBoundingClientRect() returns - subtract the body's own padding or
                // the split drifts off by exactly that amount.
                const rect = bodyEl.getBoundingClientRect();
                const style = getComputedStyle(bodyEl);
                const move = (ev) => {
                    let pct;
                    if (layout === 'side-by-side') {
                        const padLeft = parseFloat(style.paddingLeft) || 0;
                        const contentWidth = rect.width - padLeft - (parseFloat(style.paddingRight) || 0);
                        pct = ((ev.clientX - (rect.left + padLeft)) / contentWidth) * 100;
                    } else {
                        const padBottom = parseFloat(style.paddingBottom) || 0;
                        const contentHeight = rect.height - (parseFloat(style.paddingTop) || 0) - padBottom;
                        pct = ((rect.bottom - padBottom - ev.clientY) / contentHeight) * 100;
                    }
                    document.documentElement.style.setProperty(cssVar, `${Math.min(75, Math.max(15, pct))}%`);
                };
                dragPointer(this.splitResizer, e, move, () => {
                    this.splitResizer.classList.remove('is-resizing');
                    try {
                        localStorage.setItem(storageKeyFor(layout), document.documentElement.style.getPropertyValue(cssVar));
                    } catch (err) {
                        /* ignore */
                    }
                });
            });
        }

        /** Dragging a handle moves that end of the range; dragging anywhere else on the
         * filter track selects a brand new range (DevTools Network-panel style). The
         * hover guide line's visibility is pure CSS; this only feeds it the cursor x. */
        initFilterDrag() {
            const track = this.filterTrack;
            track.addEventListener('pointermove', (e) => {
                track.style.setProperty('--tl-hover-x', `${e.clientX - track.getBoundingClientRect().left}px`);
            });
            track.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                const rect = track.getBoundingClientRect();
                const tsAt = (clientX) => this.xToTs(clientX - rect.left, this.domainStart, this.domainEnd, rect.width);
                const anchorTs = tsAt(e.clientX);
                const minGap = Math.max(1, (this.domainEnd - this.domainStart) * 0.005);
                const handle = e.target.closest('.snapshot-timeline-handle');
                handle?.classList.add('is-dragging');
                this.panel.classList.add('is-dragging-range');

                const move = (ev) => {
                    const ts = tsAt(ev.clientX);
                    if (handle?.dataset.handle === 'start') {
                        this.rangeStart = Math.min(ts, this.rangeEnd - minGap);
                    } else if (handle) {
                        this.rangeEnd = Math.max(ts, this.rangeStart + minGap);
                    } else {
                        this.rangeStart = Math.min(anchorTs, ts);
                        this.rangeEnd = Math.max(anchorTs, ts, this.rangeStart + 1);
                    }
                    this.applyRange();
                };
                dragPointer(track, e, move, () => {
                    handle?.classList.remove('is-dragging');
                    this.panel.classList.remove('is-dragging-range');
                    this.persistRange();
                });
            });
        }

        initResizer() {
            if (!this.resizer) return;
            this.resizer.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                const startY = e.clientY;
                const wasCollapsed = this.panel.classList.contains('is-collapsed');
                const startHeight = wasCollapsed ? this.lastExpandedHeight : this.panel.getBoundingClientRect().height;
                this.resizer.classList.add('is-resizing');

                let moved = false;
                const move = (ev) => {
                    if (Math.abs(ev.clientY - startY) > 3) moved = true;
                    const rawHeight = startHeight + (startY - ev.clientY);
                    if (rawHeight < PANEL_COLLAPSE_THRESHOLD) {
                        this.panel.classList.add('is-collapsed');
                    } else {
                        this.panel.classList.remove('is-collapsed');
                        const newHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, rawHeight));
                        this.panel.style.height = `${newHeight}px`;
                        this.lastExpandedHeight = newHeight;
                    }
                    this.updatePanelHeightVar();
                };
                dragPointer(this.resizer, e, move, () => {
                    this.resizer.classList.remove('is-resizing');
                    if (!moved) {
                        this.setCollapsed(!wasCollapsed, startHeight);
                        return;
                    }
                    try {
                        const collapsed = this.panel.classList.contains('is-collapsed');
                        localStorage.setItem('use_timeline_collapsed', collapsed ? '1' : '0');
                        if (!collapsed) localStorage.setItem('use_timeline_panel_height', String(Math.round(this.lastExpandedHeight)));
                    } catch (err) {
                        /* ignore */
                    }
                });
            });
        }

        /** Vertical wheel = zoom centered on the cursor. Horizontal wheel pans: natively
         * (it's a scroll container) on the selection timeline, by hand on the filter one. */
        initWheelZoom() {
            this.viewport.addEventListener(
                'wheel',
                (e) => {
                    if (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
                    e.preventDefault();
                    const x = e.clientX - this.viewport.getBoundingClientRect().left;
                    this.zoomRange(this.xToTs(x, this.rangeStart, this.rangeEnd, this.viewportWidth), e.deltaY);
                    this.scheduleApplyRange();
                },
                { passive: false },
            );
            this.filterTrack.addEventListener(
                'wheel',
                (e) => {
                    e.preventDefault();
                    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                        this.panRange(e.deltaX);
                    } else if (e.deltaY !== 0) {
                        const x = e.clientX - this.filterTrack.getBoundingClientRect().left;
                        this.zoomRange(this.xToTs(x, this.domainStart, this.domainEnd, this.filterWidth), e.deltaY);
                    }
                    this.scheduleApplyRange();
                },
                { passive: false },
            );
        }

        /** Native scrolling of the selection timeline (trackpad, shift+wheel, touch) pans the range. */
        initViewportScroll() {
            this.viewport.addEventListener(
                'scroll',
                () => {
                    const left = this.viewport.scrollLeft;
                    // Ignore the echo of our own programmatic scroll.
                    if (this._applyRaf || Math.abs(left - this._expectedScrollLeft) < 1) return;
                    const domainSpan = this.domainEnd - this.domainStart;
                    const span = this.rangeEnd - this.rangeStart;
                    const contentWidth = this.viewportWidth * (domainSpan / span);
                    if (contentWidth <= 0) return;
                    this.rangeStart = this.domainStart + (left / contentWidth) * domainSpan;
                    this.rangeEnd = this.rangeStart + span;
                    this._expectedScrollLeft = left;
                    this.updateFilterWindow();
                    this.renderAxis(this.selectionAxis, this.rangeStart, this.rangeEnd, this.viewportWidth);
                    this.persistRangeDebounced();
                },
                { passive: true },
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

        scheduleRefresh() {
            if (this._raf) return;
            this._raf = requestAnimationFrame(() => {
                this._raf = null;
                this.refresh();
            });
        }

        /** Coalesces the several wheel events a single frame can receive into one DOM update. */
        scheduleApplyRange() {
            if (this._applyRaf) return;
            this._applyRaf = requestAnimationFrame(() => {
                this._applyRaf = null;
                this.applyRange();
            });
        }

        /** Re-measure after anything that changes the timelines' size (window/panel resize,
         * layout switch, split drag, element scale), then re-apply the range. */
        refresh() {
            this.filterWidth = this.filterTrack.clientWidth;
            this.viewportWidth = this.viewport.clientWidth;
            this.syncBars(this.filterBars, this.filterWidth, this.domainEnd - this.domainStart);
            this.renderAxis(this.filterAxis, this.domainStart, this.domainEnd, this.filterWidth);
            this.applyRange();
        }

        /** Push the current range to the DOM: the selection content's zoom and scroll
         * position, the filter window and the date axis. Snapshot markup is only
         * touched when the new zoom level changes how snapshots group. */
        applyRange() {
            const domainSpan = this.domainEnd - this.domainStart;
            const span = Math.max(1, this.rangeEnd - this.rangeStart);
            const zoom = domainSpan / span;
            const contentWidth = this.viewportWidth * zoom;
            this.selectionContent.style.setProperty('--tl-zoom', zoom);
            this.syncBars(this.selectionBars, contentWidth, span);
            this._expectedScrollLeft = ((this.rangeStart - this.domainStart) / domainSpan) * contentWidth;
            this.viewport.scrollLeft = this._expectedScrollLeft;
            this.updateFilterWindow();
            this.renderAxis(this.selectionAxis, this.rangeStart, this.rangeEnd, this.viewportWidth);
            this.persistRangeDebounced();
        }

        /** Snapshot bars go under the filter window's markup, so they stay beneath it. */
        createBarsLayer(container, clickable) {
            const el = document.createElement('div');
            el.className = 'snapshot-timeline-bars';
            container.prepend(el);
            return { el, clickable, key: null };
        }

        /** Lay a timeline's snapshots out on content `widthPx` wide. Bars are positioned in
         * percent of the whole history, so zooming and resizing move them without any
         * markup change; the markup is only rebuilt when the grouping itself changes. */
        syncBars(bars, widthPx, visibleSpan) {
            if (widthPx <= 0) return;
            const layout = computeTickLayout(this.entries, this.domainStart, this.domainEnd, widthPx, visibleSpan);
            const key = layout
                .map((item) => (item.type === 'tick' ? item.entry.id : item.entries.map((e) => e.id).join(',')))
                .join('|');
            if (key === bars.key) return;
            bars.key = key;
            bars.el.replaceChildren(
                ...layout.map((item) => {
                    const el = item.type === 'tick'
                        ? this.makeTickElement(item.entry, bars.clickable)
                        : this.makeStackElement(item.entries, bars.clickable);
                    el.style.left = `${(item.x / widthPx) * 100}%`;
                    // The gap keeps back-to-back ranges visually distinct.
                    el.style.width = `max(2px, calc(${((item.x2 - item.x) / widthPx) * 100}% - ${RANGE_GAP_PX}px))`;
                    return el;
                }),
            );
        }

        /** The filter window's markup lives in the template and is placed by CSS from these two vars. */
        updateFilterWindow() {
            const pct = (ts) => `${((ts - this.domainStart) / (this.domainEnd - this.domainStart)) * 100}%`;
            this.filterTrack.style.setProperty('--tl-range-start', pct(this.rangeStart));
            this.filterTrack.style.setProperty('--tl-range-end', pct(this.rangeEnd));
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

        /** One snapshot's element (a bar, or a cell inside a group), tagged for markCurrent. */
        makeEntryElement(entry, className) {
            const el = document.createElement('div');
            el.className = className;
            el.dataset.id = entry.id;
            el.classList.toggle('is-current', entry.id === this.currentSnapshotId);
            el.classList.toggle('is-original', !!entry.isOriginal);
            el.title = `${entry.name} — ${new Date(entry.ts).toLocaleString(appLocale())}`;
            return el;
        }

        makeTickElement(entry, clickable) {
            const el = this.makeEntryElement(entry, 'snapshot-timeline-tick');
            if (clickable) el.addEventListener('click', () => this.navigateTo(entry));
            return el;
        }

        makeStackElement(entries, clickable) {
            const el = document.createElement('div');
            el.className = 'snapshot-timeline-stack';
            const grid = el.appendChild(document.createElement('div'));
            grid.className = 'snapshot-timeline-stack-grid';
            grid.style.setProperty('--n', entries.length);
            grid.append(...entries.map((entry) => this.makeEntryElement(entry, 'snapshot-timeline-stack-tick')));

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
                this.markCurrent();
            } else if (entry.url) {
                window.location.href = entry.url;
            }
        }

        /** Move the current-snapshot highlight in both timelines without rebuilding anything
         * (a group rings itself via CSS :has() when one of its cells is current). */
        markCurrent() {
            this.panel.querySelectorAll('[data-id]').forEach((el) => {
                el.classList.toggle('is-current', el.dataset.id === this.currentSnapshotId);
            });
        }

        /** Native popover: the browser handles top-layer display and closing on an outside click. */
        showStackPopover(e, entries) {
            const pop = this.popoverEl;
            pop.replaceChildren(
                ...entries.map((entry) => {
                    const item = document.createElement('div');
                    item.className = 'snapshot-timeline-popover-item' + (entry.id === this.currentSnapshotId ? ' is-current' : '');
                    item.textContent = `${new Date(entry.ts).toLocaleString(appLocale())} — ${entry.name}`;
                    item.addEventListener('click', () => {
                        pop.hidePopover();
                        this.navigateTo(entry);
                    });
                    return item;
                }),
            );
            pop.showPopover();
            const rect = e.currentTarget.getBoundingClientRect();
            const popRect = pop.getBoundingClientRect();
            pop.style.left = `${Math.min(rect.left, window.innerWidth - popRect.width - 8)}px`;
            pop.style.top = `${Math.max(8, rect.top - popRect.height - 6)}px`;
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
