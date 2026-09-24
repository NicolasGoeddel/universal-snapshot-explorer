/**
 * Universal Snapshot Explorer (USE) - TableColumnResizer
 *
 * Provides responsive, proportional table column resizing with:
 *  1. Two-Stage Sliding Accordion ("Shower Door") Physics during manual drag interactions.
 *  2. Dynamic Content-Aware Soft-Min Threshold Caching (preserving full cell legibility during drag).
 *  3. Isolated Off-screen Dummy Table Content Measurement Context for unclipped rendering.
 *  4. High-Performance O(N log N) Text-Length Heuristic for instant measurement on large tables.
 *  5. Autonomous MutationObserver lifecycle monitoring with debounced cache invalidation.
 *  6. Idempotent, Content-Aware Auto-Fit Reset on double-click.
 *  7. HTML5 Declarative Dataset Configuration (zero hardcoded CSS selectors in JS).
 *  8. LocalStorage Persistence of per-column weights, independent of viewport and visible set.
 *
 * =================================================================================================
 * ARCHITECTURAL OVERVIEW & ALGORITHM SPECIFICATIONS
 * =================================================================================================
 *
 * 1. DECLARATIVE HTML ATTRIBUTES:
 * -------------------------------------------------------------------------------------------------
 * The resizer is completely generic and is configured entirely via `data-*` attributes on `<th>`:
 *  - `data-fixed-width="[px]"` : Strict pixel width (e.g. 32px select checkbox, 60px actions).
 *                               Fixed columns NEVER participate in accordion dragging or auto-fit.
 *  - `data-elastic="true"`     : Designates the primary flexible column (e.g. Name) that absorbs
 *                               surplus space on auto-fit and is the shock absorber during drags.
 *  - `data-ignore-content="true"`: Bypasses DOM cell content measurement entirely for elastic columns
 *                               (such as responsive SVG timelines) that adapt dynamically to column width.
 *  - `data-min-width="[px]"`   : Stage 2 hard minimum floor in pixels (default: 45px).
 *  - `data-soft-min="[px]"`    : Explicit Stage 1 soft threshold override.
 *  - `data-default-pct="[%]"`  : Proportional share used when resetting uninitialized tables.
 *  - `data-col-key="[string]"` : Unique column identifier for atomic LocalStorage serialization.
 *  - `data-resizer-tooltip`    : Localized hover tooltip on the parent `<table>` element.
 *
 * 2. TWO-STAGE SLIDING ACCORDION PHYSICS (DRAG RESIZING):
 * -------------------------------------------------------------------------------------------------
 * When a user drags the border divider between column `k` and `k+1`:
 *  - Dragging Right (ΔX > 0): Column `k` expands. Non-fixed columns to the right (`k+1 ... N-1`) shrink.
 *  - Dragging Left (ΔX < 0) : Column `k+1` expands. Non-fixed columns to the left (`k ... 0`) shrink.
 *
 * Compression occurs in two distinct, sequential phases ("Shower Door" physics):
 *  - STAGE 1 (Soft Compression / Text & Content Legibility):
 *    Columns shrink only down to `softMinWidth` (the cached optimal width required to render header
 *    text, sort indicators, AND all visible row cell content without ellipsis truncation).
 *    To avoid rigidity with excessively long values, dynamic `soft-min` is capped at min(optimal, max(350px, 30%)).
 *    The `data-elastic` column sets its soft-min equal to hard-min to remain fully flexible.
 *  - STAGE 2 (Hard Compression / Minimum Floor):
 *    Only if the user continues dragging beyond what Stage 1 can absorb across all reducible
 *    columns, the columns enter Stage 2 and compress down to `hardMinWidth` (truncating with `...`).
 *
 * 3. OFF-SCREEN DUMMY MEASUREMENT & HIGH-SPEED HEURISTIC:
 * -------------------------------------------------------------------------------------------------
 * In fixed table layouts (`table-layout: fixed`), native DOM APIs clamp measurements to truncated widths.
 * To obtain the true, unclipped, intrinsic content width of headers and cells:
 *  - Clones are evaluated inside an isolated off-screen table inheriting parent CSS styles.
 *  - For O(N log N) performance with thousands of rows, all visible rows are first ranked by
 *    `textContent.length` in memory, and only the Top 40 widest candidate cells undergo DOM measurement.
 *
 * 4. AUTONOMOUS MUTATION OBSERVER & LIFECYCLE:
 * -------------------------------------------------------------------------------------------------
 * A `MutationObserver` automatically watches the table `<tbody>` for child additions (e.g. folder expansion)
 * or attribute changes (e.g. filter/search toggles) and executes debounced (150ms) background cache
 * recalculation so that dragging constraints always match the currently visible dataset.
 *
 * 5. COLUMN WEIGHTS (PERSISTENCE & COLUMN VISIBILITY):
 * -------------------------------------------------------------------------------------------------
 * Each flexible column persists a `weight`: how much room it wants COMPARED TO ITS VISIBLE PEERS.
 * Weights are never normalized, and `resolveWidths()` is the only place one becomes a pixel width:
 *
 *      available = tableWidth - Σ(width of VISIBLE fixed columns)
 *      width[j]  = available × weight[j] / Σ(weight of VISIBLE flexible columns)
 *
 * Columns hidden by `column_visibility.js` (via `display: none`) drop out of both sums and keep
 * their stored weight, so hiding one lets its peers absorb the freed space and showing it again
 * reproduces the earlier layout exactly - including a width the user set by dragging. Rescaling
 * the stored weights to match the visible set instead would discard the hidden columns' sizes and
 * make repeated toggling drift.
 *
 * Leaving a hidden column IN the sums is the failure this rules out: it renders nothing, so its
 * share goes missing from the table and `table-layout: fixed` makes up the shortfall by inflating
 * every column that IS rendered - `data-fixed-width` ones included, which then visibly exceed
 * their declared pixel size (min/max-width do not constrain cells under fixed layout).
 *
 * 6. IDEMPOTENT CONTENT-AWARE AUTO-FIT RESET (DOUBLE-CLICK):
 * -------------------------------------------------------------------------------------------------
 * Double-clicking any resizer handle computes an optimal, content-preserving width distribution:
 *  - `minRequiredWidth[j]`: Intrinsic width required so that header and all visible data rows fit
 *    without any ellipses.
 *  - `targetWidths[j] = Math.max(currentWidths[j], minRequiredWidth[j])`:
 *    Columns that the user previously widened beyond their content RETAIN their wide width.
 *    Columns that were too small EXPAND to `minRequiredWidth`.
 *  - Surplus Distribution: Any remaining table width is routed to the `data-elastic` column.
 *  - Deficit Handling: If target widths exceed viewport width:
 *      Phase 1: Columns wider than their content give that surplus back, proportionally. No text
 *               is lost yet, so every column contributes its slack regardless of position.
 *      Phase 2: If it still overflows, content must be truncated - so columns now give in from
 *               RIGHT TO LEFT, each down to `hardMinWidth`. Leading columns are the important
 *               ones (Name, Snapshots), so the trailing ones absorb the whole deficit first and
 *               the leading ones only start truncating once everything to their right is at its
 *               floor.
 *  - Idempotence Guarantee: `currentWidths` is what the weights resolve to, never what the DOM
 *    measures. A rendered width is only an approximation of the `width: X%` that produced it, so
 *    feeding it back in would leave a rounding residue for the surplus step to hand to the elastic
 *    column again on every call, drifting a little further each time.
 */
(() => {
    class TableColumnResizer {
        /**
         * Initialize the column resizer on a target table element.
         * @param {HTMLTableElement|string} table - Table DOM element or element ID.
         * @param {Object} [options={}] - Configuration options.
         * @param {string} [options.storageKey] - Custom LocalStorage persistence key.
         * @param {string} [options.resizerTitle] - Custom tooltip string for resizer handles.
         */
        constructor(table, options = {}) {
            this.table = typeof table === 'string' ? document.getElementById(table) : table;
            if (!this.table) {
                console.error('[TableColumnResizer] Initialization failed: Table element not found.', table);
                return;
            }

            this.options = options;
            this.observeMutations = options.observeMutations === true;
            this.storageKey = options.storageKey || `use_col_widths_${this.table.id || 'table'}`;
            this.isResizing = false;
            this.activeResizerIndex = -1;
            this.startX = 0;
            this.startWidths = [];
            this.hardMinWidths = [];
            this.softMinWidths = [];
            this.isFixedColumn = [];
            this.totalTableWidth = 0;
            this.justResized = false;
            this.columnWeights = {};
            this.optimalWidths = [];
            this.elasticColIndex = -1;
            this.ths = [];

            this.init();
        }

        /**
         * Scan table headers, load saved states, attach DOM resizers, and bind event handlers.
         */
        init() {
            const thead = this.table.querySelector('thead');
            if (!thead) {
                console.warn('[TableColumnResizer] Table has no <thead> element.', this.table);
                return;
            }

            const headerRow = thead.querySelector('tr.header-row') || thead.querySelector('tr:first-child');
            if (!headerRow) {
                console.warn('[TableColumnResizer] Table <thead> has no header row.', this.table);
                return;
            }

            this.ths = Array.from(headerRow.querySelectorAll('th'));
            if (this.ths.length <= 1) {
                console.warn('[TableColumnResizer] Table has fewer than 2 columns; resizing skipped.', this.table);
                return;
            }

            this.loadWeights();

            // Set table to fixed layout
            this.table.style.tableLayout = 'fixed';

            // Identify columns and apply generic properties based on data-* attributes
            this.isFixedColumn = this.ths.map((th) => th.hasAttribute('data-fixed-width'));

            this.ths.forEach((th, index) => {
                let colKey = th.dataset.colKey;
                if (!colKey) {
                    const headerClass = Array.from(th.classList).find(
                        (c) =>
                            c.startsWith('browser-header-') ||
                            c.startsWith('root-header-') ||
                            c.startsWith('details-cell-'),
                    );
                    colKey = headerClass || `col-${index}`;
                    th.dataset.colKey = colKey;
                }

                if (this.isFixedColumn[index]) {
                    const fw = th.getAttribute('data-fixed-width');
                    th.style.width = `${fw}px`;
                    th.style.minWidth = `${fw}px`;
                    th.style.maxWidth = `${fw}px`;
                }

                if (th.hasAttribute('data-elastic')) {
                    this.elasticColIndex = index;
                }
            });

            if (this.elasticColIndex < 0) {
                const flexIndices = [];
                this.ths.forEach((_th, idx) => {
                    if (!this.isFixedColumn[idx]) flexIndices.push(idx);
                });
                this.elasticColIndex = flexIndices.length > 0 ? flexIndices[0] : -1;
            }

            // Setup MutationObserver only if explicitly enabled (disabled by default to prevent layout thrashing)
            if (this.observeMutations) {
                const tbody = this.table.querySelector('tbody');
                if (tbody) {
                    this.observer = new MutationObserver(() => {
                        this.recalculateOptimalWidthsDebounced();
                    });
                    this.observer.observe(tbody, {
                        childList: true,
                        subtree: false,
                    });
                }
            }

            // Render from stored weights; columns without one fall back to their data-default-pct
            this.applyWidths();

            const defaultTooltip =
                window.clientI18n?.['table.resizer_tooltip'] || 'Drag to resize, double-click to reset';
            const tooltip =
                this.table.dataset.resizerTooltip || this.table.getAttribute('data-resizer-tooltip') || defaultTooltip;

            // Attach resize handles to resizable columns (excluding fixed and terminal columns)
            const lastIndex = this.ths.length - 1;
            this.ths.forEach((th, index) => {
                // Do not place handle on last column or fixed columns
                if (index === lastIndex || this.isFixedColumn[index]) return;

                // If next column is fixed utility column (e.g. actions), skip handle
                if (this.isFixedColumn[index + 1]) return;

                let resizer = th.querySelector(':scope > .col-resizer');
                if (!resizer) {
                    resizer = document.createElement('span');
                    resizer.className = 'col-resizer';
                    resizer.setAttribute('aria-hidden', 'true');
                    resizer.setAttribute('title', tooltip);
                    th.appendChild(resizer);
                } else {
                    resizer.setAttribute('title', tooltip);
                }

                resizer.addEventListener('mousedown', (e) => this.onMouseDown(e, index));
                resizer.addEventListener('touchstart', (e) => this.onTouchStart(e, index), { passive: false });
                resizer.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
                resizer.addEventListener('dblclick', (e) => this.onDoubleClick(e));
            });

            // Global mouse/touch interaction listeners
            this.boundOnMouseMove = (e) => this.onMouseMove(e);
            this.boundOnMouseUp = () => this.onMouseUp();
            this.boundOnTouchMove = (e) => this.onTouchMove(e);
            this.boundOnTouchEnd = () => this.onTouchEnd();
        }

        /**
         * Create an off-screen dummy table environment to measure true, unclipped intrinsic dimensions.
         * @returns {{measureTh: Function, measureTd: Function, destroy: Function}}
         */
        createMeasurementContext() {
            const tableClass = this.table.className || '';
            const dummyTable = document.createElement('table');
            if (tableClass) dummyTable.className = tableClass;
            dummyTable.style.cssText =
                'position: absolute; visibility: hidden; table-layout: auto; width: auto; left: -9999px; top: -9999px;';

            const dummyThead = document.createElement('thead');
            const dummyHeaderRow = document.createElement('tr');
            dummyHeaderRow.className = 'header-row';
            dummyThead.appendChild(dummyHeaderRow);
            dummyTable.appendChild(dummyThead);

            const dummyTbody = document.createElement('tbody');
            const dummyBodyRow = document.createElement('tr');
            dummyTbody.appendChild(dummyBodyRow);
            dummyTable.appendChild(dummyTbody);

            document.body.appendChild(dummyTable);

            return {
                measureTh(th) {
                    const clone = th.cloneNode(true);
                    clone.style.cssText =
                        'width: auto !important; min-width: 0 !important; max-width: none !important; white-space: nowrap !important; overflow: visible !important;';
                    const resizer = clone.querySelector('.col-resizer');
                    if (resizer) resizer.remove();
                    // Ignore elastic elements like the snapshot SVG timeline during measurement
                    const elasticElements = clone.querySelectorAll('svg');
                    elasticElements.forEach((el) => el.remove());
                    dummyHeaderRow.appendChild(clone);
                    let width = clone.getBoundingClientRect().width;
                    if (th.classList.contains('sortable') || th.querySelector('.sortable')) {
                        width += 20; // Room for ::after sort indicator (⇅)
                    }
                    width += 6; // Safety padding
                    dummyHeaderRow.removeChild(clone);
                    return Math.ceil(width);
                },
                measureTd(td) {
                    const clone = td.cloneNode(true);
                    clone.style.cssText =
                        'width: auto !important; min-width: 0 !important; max-width: none !important; white-space: nowrap !important; overflow: visible !important;';
                    // Remove any max-width truncation from inner links/spans
                    const innerElements = clone.querySelectorAll('a, span, div');
                    innerElements.forEach((el) => {
                        el.style.cssText +=
                            '; max-width: none !important; overflow: visible !important; text-overflow: clip !important;';
                    });
                    dummyBodyRow.appendChild(clone);
                    const width = clone.getBoundingClientRect().width + 8; // Safety buffer
                    dummyBodyRow.removeChild(clone);
                    return Math.ceil(width);
                },
                destroy() {
                    document.body.removeChild(dummyTable);
                },
            };
        }

        /**
         * Measure natural soft width of a single TH element in table rendering context.
         * @param {HTMLTableCellElement} th - Header element.
         * @returns {number} Width in pixels.
         */
        recalculateOptimalWidthsDebounced() {
            if (this.recalcTimeout) clearTimeout(this.recalcTimeout);
            this.recalcTimeout = setTimeout(() => {
                this.recalculateOptimalWidths();
                this.updateConstraintThresholds();
            }, 150);
        }

        measureNaturalSoftWidth(th) {
            return this.optimalWidths[this.ths.indexOf(th)] || 45;
        }

        /**
         * Recalculate optimal width for all columns based on visible data rows.
         * Stores the result in this.optimalWidths.
         */
        recalculateOptimalWidths() {
            const ctx = this.createMeasurementContext();
            const allRows = this.table.querySelectorAll('tbody tr');
            const visibleRows = [];
            for (let i = 0; i < allRows.length && visibleRows.length < 50; i++) {
                const tr = allRows[i];
                if (
                    tr.style.display !== 'none' &&
                    !tr.classList.contains('row-hidden') &&
                    !tr.classList.contains('filter-hidden')
                ) {
                    visibleRows.push(tr);
                }
            }

            this.optimalWidths = this.ths.map((th, colIdx) => {
                if (this.isFixedColumn[colIdx]) {
                    return parseInt(th.getAttribute('data-fixed-width'), 10) || 32;
                }

                if (th.hasAttribute('data-ignore-content')) {
                    let maxW = 0;
                    if (th.hasAttribute('data-soft-min')) {
                        maxW = parseInt(th.getAttribute('data-soft-min'), 10);
                    }
                    const hard = parseInt(th.getAttribute('data-min-width'), 10) || 45;
                    return Math.max(hard, maxW);
                }

                let maxW = ctx.measureTh(th);

                const cellCandidates = [];
                for (let r = 0; r < visibleRows.length; r++) {
                    const tr = visibleRows[r];
                    const td = tr.children[colIdx];
                    if (!td) continue;

                    let len = td.textContent.trim().length;

                    if (colIdx === this.elasticColIndex) {
                        const level = parseInt(tr.dataset.level || '0', 10);
                        len += level * 3;
                    }

                    cellCandidates.push({ td: td, len: len });
                }

                cellCandidates.sort((a, b) => b.len - a.len);
                const candidatesToMeasure = Math.min(cellCandidates.length, 5);

                for (let i = 0; i < candidatesToMeasure; i++) {
                    const cellW = ctx.measureTd(cellCandidates[i].td);
                    if (cellW > maxW) maxW = cellW;
                }

                if (th.hasAttribute('data-soft-min')) {
                    maxW = Math.max(maxW, parseInt(th.getAttribute('data-soft-min'), 10));
                }

                const hard = parseInt(th.getAttribute('data-min-width'), 10) || 45;
                return Math.max(hard, Math.ceil(maxW));
            });

            ctx.destroy();
        }

        /**
         * Recompute hard and soft minimum constraints across all table columns.
         */
        updateConstraintThresholds() {
            const tableWidth = this.table.getBoundingClientRect().width;
            const maxSoftMin = Math.max(350, tableWidth * 0.3);

            this.ths.forEach((th, i) => {
                const hardMin = parseInt(th.getAttribute('data-min-width'), 10) || 45;
                this.hardMinWidths[i] = hardMin;

                // For the elastic column, soft-min is the hard-min so it compresses fully in stage 1
                if (i === this.elasticColIndex) {
                    this.softMinWidths[i] = hardMin;
                } else {
                    // Soft-min is the optimal content width, capped at maxSoftMin so it doesn't become rigid
                    const optimal = this.optimalWidths[i] || hardMin;
                    this.softMinWidths[i] = Math.max(hardMin, Math.min(optimal, maxSoftMin));
                }
            });
        }

        /**
         * Resolve each visible flexible column's stored weight into a pixel width.
         *
         * A weight says how much room a column wants COMPARED TO ITS VISIBLE PEERS, so hidden
         * columns are simply left out of both sums: they render nothing, and any width handed
         * to them would go missing from the table (the browser then makes up the shortfall by
         * inflating every column that IS rendered, `data-fixed-width` ones included).
         *
         * @returns {{tableWidth: number, available: number, flexibleIndices: number[], widths: Object<number, number>}}
         */
        resolveWidths() {
            const tableWidth = this.table.getBoundingClientRect().width;
            const flexibleIndices = [];
            let fixedWidthSum = 0;

            this.ths.forEach((th, idx) => {
                if (window.getComputedStyle(th).display === 'none') return;
                if (this.isFixedColumn[idx]) {
                    fixedWidthSum += parseInt(th.getAttribute('data-fixed-width'), 10) || 0;
                } else {
                    flexibleIndices.push(idx);
                }
            });

            const available = Math.max(0, tableWidth - fixedWidthSum);
            const weightOf = (idx) => {
                const stored = parseFloat(this.columnWeights[this.ths[idx].dataset.colKey]);
                if (stored > 0) return stored;
                const declared = parseFloat(this.ths[idx].getAttribute('data-default-pct'));
                return declared > 0 ? declared : 10;
            };
            const totalWeight = flexibleIndices.reduce((sum, idx) => sum + weightOf(idx), 0) || 1;

            const widths = {};
            flexibleIndices.forEach((idx) => {
                widths[idx] = (available * weightOf(idx)) / totalWeight;
            });

            return { tableWidth, available, flexibleIndices, widths };
        }

        /**
         * Render the resolved widths. They go out as a percentage of the table because a cell's
         * `width: X%` always resolves against the whole table (never against the flexible columns
         * alone), which keeps the layout scaling with the viewport without any JS. Fixed columns
         * are never touched here - `init()` pins them to their declared pixel width once.
         */
        applyWidths() {
            const { tableWidth, flexibleIndices, widths } = this.resolveWidths();
            if (tableWidth <= 0) return;
            flexibleIndices.forEach((idx) => {
                this.ths[idx].style.width = `${((widths[idx] / tableWidth) * 100).toFixed(4)}%`;
            });
        }

        /**
         * Load stored column weights from browser LocalStorage.
         */
        loadWeights() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                const parsed = raw ? JSON.parse(raw) : null;
                if (parsed && typeof parsed === 'object') this.columnWeights = parsed;
            } catch (e) {
                console.debug('Failed to load table column widths:', e);
                this.columnWeights = {};
            }
        }

        /**
         * Serialize active column weights to browser LocalStorage.
         */
        saveWeights() {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(this.columnWeights));
            } catch (e) {
                console.debug('Failed to save table column widths:', e);
            }
        }

        /**
         * Content-aware Auto-Fit Reset: every visible column gets at least the width its content
         * needs, columns already wider than that keep their width, and the leftover goes to the
         * elastic column. Hidden columns are left out entirely and keep their stored weight.
         *
         * Idempotent by construction, because the starting point is what the current weights
         * resolve to rather than what the DOM currently measures. Measuring the DOM would feed
         * the rounding error of `width: X%` back in as the next run's baseline, and the surplus
         * step would hand that residue to the elastic column again on every single call.
         */
        autoFitColumns() {
            // Recalculate optimal widths based on current visible rows
            this.recalculateOptimalWidths();
            const minRequiredWidths = this.optimalWidths;

            // 2. Current widths come from the stored weights, not from the DOM
            const { available, flexibleIndices, widths } = this.resolveWidths();
            if (flexibleIndices.length === 0) return;
            const elasticIdx = flexibleIndices.includes(this.elasticColIndex)
                ? this.elasticColIndex
                : flexibleIndices[0];

            // 3. Start target widths: keep current width if already >= minRequired, otherwise expand to minRequired
            const targetWidths = {};
            flexibleIndices.forEach((idx) => {
                targetWidths[idx] = Math.max(widths[idx], minRequiredWidths[idx] || 0);
            });

            // 4. Compare against the space the visible flexible columns actually share
            let sumTargetFlexible = flexibleIndices.reduce((sum, idx) => sum + targetWidths[idx], 0);

            if (sumTargetFlexible <= available) {
                // Surplus table space: distribute to Elastic column
                targetWidths[elasticIdx] += available - sumTargetFlexible;
            } else {
                // Deficit: target widths exceed available table width
                let deficit = sumTargetFlexible - available;

                // Phase 1: Proportional reduction of columns that are currently wider than their minRequiredWidth
                let totalReducible = 0;
                const reducibleCapacities = {};
                for (const idx of flexibleIndices) {
                    const capacity = Math.max(0, targetWidths[idx] - (minRequiredWidths[idx] || 0));
                    reducibleCapacities[idx] = capacity;
                    totalReducible += capacity;
                }

                if (totalReducible > 0) {
                    const reduction = Math.min(deficit, totalReducible);
                    for (const idx of flexibleIndices) {
                        const cap = reducibleCapacities[idx];
                        if (cap > 0) {
                            targetWidths[idx] -= (cap / totalReducible) * reduction;
                        }
                    }
                    deficit -= reduction;
                }

                // Phase 2: Every column is down to its content width and it still overflows, so
                // from here on content has to be truncated. Give in from the RIGHT: trailing
                // columns are the least important ones, so they absorb the whole deficit before
                // the leading columns (Name, Snapshots) lose a single pixel of their content.
                for (let i = flexibleIndices.length - 1; i >= 0 && deficit > 0; i--) {
                    const idx = flexibleIndices[i];
                    const hard = this.hardMinWidths[idx] || 45;
                    const reduction = Math.min(deficit, Math.max(0, targetWidths[idx] - hard));
                    targetWidths[idx] -= reduction;
                    deficit -= reduction;
                }
            }

            // 5. Adopt the targets as the new weights. Only visible columns are written, so a
            // hidden column keeps the weight it had when last visible and returns at that size.
            flexibleIndices.forEach((idx) => {
                const key = this.ths[idx].dataset.colKey;
                if (key) this.columnWeights[key] = Math.max(1, targetWidths[idx]);
            });

            this.saveWeights();
            this.applyWidths();
        }

        /**
         * Initialize mouse/touch drag interaction.
         * @param {number} clientX - Pointer X coordinate.
         * @param {number} colIndex - Column index of the clicked resizer.
         */
        startDragging(clientX, colIndex) {
            this.isResizing = true;
            this.activeResizerIndex = colIndex;
            this.startX = clientX;

            const tableRect = this.table.getBoundingClientRect();
            this.totalTableWidth = tableRect.width;

            if (this.optimalWidths.length === 0) {
                this.recalculateOptimalWidths();
            }
            this.updateConstraintThresholds();
            this.startWidths = this.ths.map((th) => th.getBoundingClientRect().width);

            document.body.classList.add('is-resizing-columns');
            const activeTh = this.ths[colIndex];
            const resizer = activeTh ? activeTh.querySelector(':scope > .col-resizer') : null;
            if (resizer) resizer.classList.add('is-resizing');
        }

        onMouseDown(e, colIndex) {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            this.startDragging(e.clientX, colIndex);
            document.addEventListener('mousemove', this.boundOnMouseMove);
            document.addEventListener('mouseup', this.boundOnMouseUp);
        }

        onTouchStart(e, colIndex) {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            e.stopPropagation();

            this.startDragging(e.touches[0].clientX, colIndex);
            document.addEventListener('touchmove', this.boundOnTouchMove, { passive: false });
            document.addEventListener('touchend', this.boundOnTouchEnd);
        }

        onMouseMove(e) {
            if (!this.isResizing) return;
            e.preventDefault();
            this.pendingClientX = e.clientX;
            if (!this.rafPending) {
                this.rafPending = true;
                requestAnimationFrame(() => {
                    this.rafPending = false;
                    if (this.isResizing && this.pendingClientX !== null) {
                        this.updateWidths(this.pendingClientX);
                    }
                });
            }
        }

        onTouchMove(e) {
            if (!this.isResizing || e.touches.length !== 1) return;
            e.preventDefault();
            this.pendingClientX = e.touches[0].clientX;
            if (!this.rafPending) {
                this.rafPending = true;
                requestAnimationFrame(() => {
                    this.rafPending = false;
                    if (this.isResizing && this.pendingClientX !== null) {
                        this.updateWidths(this.pendingClientX);
                    }
                });
            }
        }

        /**
         * Core 2-stage sliding accordion physics engine.
         * Evaluates pointer delta and distributes compression sequentially across adjacent columns.
         * @param {number} clientX - Current pointer X position.
         */
        updateWidths(clientX) {
            const k = this.activeResizerIndex;
            if (k < 0 || k >= this.ths.length - 1) return;

            const deltaX = clientX - this.startX;
            const N = this.ths.length;
            const widths = [...this.startWidths];

            if (deltaX > 0) {
                // Dragging right: Expand column k, compress rightward non-fixed columns in 2 stages
                const rightIndices = [];
                for (let j = k + 1; j < N; j++) {
                    if (!this.isFixedColumn[j]) rightIndices.push(j);
                }
                if (rightIndices.length === 0) return;

                let maxPossibleReduction = 0;
                for (const j of rightIndices) {
                    maxPossibleReduction += Math.max(0, widths[j] - this.hardMinWidths[j]);
                }

                const effectiveDelta = Math.min(deltaX, maxPossibleReduction);
                widths[k] += effectiveDelta;

                let remaining = effectiveDelta;

                // Stage 1 (Soft compression): reduce rightward columns down to softMinWidths
                for (const j of rightIndices) {
                    const soft = this.softMinWidths[j];
                    const canReduce = Math.max(0, widths[j] - soft);
                    const reduce = Math.min(remaining, canReduce);
                    widths[j] -= reduce;
                    remaining -= reduce;
                    if (remaining <= 0) break;
                }

                // Stage 2 (Hard compression): if still needed, reduce from softMinWidth down to hardMinWidth
                if (remaining > 0) {
                    for (const j of rightIndices) {
                        const hard = this.hardMinWidths[j];
                        const canReduce = Math.max(0, widths[j] - hard);
                        const reduce = Math.min(remaining, canReduce);
                        widths[j] -= reduce;
                        remaining -= reduce;
                        if (remaining <= 0) break;
                    }
                }
            } else if (deltaX < 0) {
                // Dragging left: Expand right column (k+1), compress leftward non-fixed columns (k .. 0) in 2 stages
                // A hidden column measures 0 wide, so skipping those also skips hidden ones
                let targetExpandIdx = k + 1;
                while (targetExpandIdx < N && (this.isFixedColumn[targetExpandIdx] || widths[targetExpandIdx] <= 0)) {
                    targetExpandIdx++;
                }
                if (targetExpandIdx >= N) return;

                const leftIndices = [];
                for (let j = k; j >= 0; j--) {
                    if (!this.isFixedColumn[j]) leftIndices.push(j);
                }
                if (leftIndices.length === 0) return;

                const desiredReduction = -deltaX;
                let maxPossibleReduction = 0;
                for (const j of leftIndices) {
                    maxPossibleReduction += Math.max(0, widths[j] - this.hardMinWidths[j]);
                }

                const effectiveReduction = Math.min(desiredReduction, maxPossibleReduction);
                widths[targetExpandIdx] += effectiveReduction;

                let remaining = effectiveReduction;

                // Stage 1 (Soft compression): reduce leftward columns down to softMinWidths
                for (const j of leftIndices) {
                    const soft = this.softMinWidths[j];
                    const canReduce = Math.max(0, widths[j] - soft);
                    const reduce = Math.min(remaining, canReduce);
                    widths[j] -= reduce;
                    remaining -= reduce;
                    if (remaining <= 0) break;
                }

                // Stage 2 (Hard compression): if still needed, reduce from softMinWidth down to hardMinWidth
                if (remaining > 0) {
                    for (const j of leftIndices) {
                        const hard = this.hardMinWidths[j];
                        const canReduce = Math.max(0, widths[j] - hard);
                        const reduce = Math.min(remaining, canReduce);
                        widths[j] -= reduce;
                        remaining -= reduce;
                        if (remaining <= 0) break;
                    }
                }
            }

            // Adopt the dragged pixel widths as the new weights and render them straight away.
            // Hidden columns measure 0 and are skipped, so they keep the weight they had when
            // last visible. The drag-start table width is reused so a drag frame never forces a
            // fresh layout measurement; weights are persisted once, on release.
            if (this.totalTableWidth > 0) {
                this.ths.forEach((th, idx) => {
                    if (this.isFixedColumn[idx] || widths[idx] <= 0) return;
                    th.style.width = `${((widths[idx] / this.totalTableWidth) * 100).toFixed(4)}%`;
                    const key = th.dataset.colKey;
                    if (key) this.columnWeights[key] = widths[idx];
                });
            }
        }

        onMouseUp() {
            if (!this.isResizing) return;
            this.stopDragging();
            document.removeEventListener('mousemove', this.boundOnMouseMove);
            document.removeEventListener('mouseup', this.boundOnMouseUp);
        }

        onTouchEnd() {
            if (!this.isResizing) return;
            this.stopDragging();
            document.removeEventListener('touchmove', this.boundOnTouchMove);
            document.removeEventListener('touchend', this.boundOnTouchEnd);
        }

        stopDragging() {
            if (this.rafPending && this.pendingClientX !== null) {
                this.updateWidths(this.pendingClientX);
            }
            this.isResizing = false;
            this.pendingClientX = null;
            this.rafPending = false;
            this.justResized = true;
            setTimeout(() => {
                this.justResized = false;
            }, 200);

            // Suppress the trailing ghost click dispatched by browser after drag release
            const suppressGhostClick = (e) => {
                e.stopPropagation();
                e.preventDefault();
            };
            window.addEventListener('click', suppressGhostClick, { capture: true, once: true });
            setTimeout(() => {
                window.removeEventListener('click', suppressGhostClick, { capture: true });
            }, 100);

            if (this.activeResizerIndex >= 0 && this.ths[this.activeResizerIndex]) {
                const resizer = this.ths[this.activeResizerIndex].querySelector(':scope > .col-resizer');
                if (resizer) resizer.classList.remove('is-resizing');
                this.activeResizerIndex = -1;
            }
            document.body.classList.remove('is-resizing-columns');
            this.saveWeights();
        }

        onDoubleClick(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            // Perform idempotent content-aware Auto-Fit
            this.autoFitColumns();
        }
    }

    window.TableColumnResizer = TableColumnResizer;
})();
