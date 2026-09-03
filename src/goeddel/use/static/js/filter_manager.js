/**
 * Universal Snapshot Explorer (USE) - FilterManager
 *
 * Dependencies:
 * - TreeTable: Requires a TreeTable instance or pre-indexed rows (row._parent, row._children Set)
 *   for O(1) hierarchy checks, instant upward match propagation, and subtree filtering.
 *
 * Encapsulates all table filtering mechanisms:
 *  1. Column-specific text filter inputs in table headers (`thead tr.column-filter input`).
 *  2. Keyboard interaction within filter inputs (<kbd>Esc</kbd> blur, cyclic <kbd>Tab</kbd>, <kbd>↓</kbd>/<kbd>Enter</kbd> jump to table, sort shortcuts).
 *  3. Toolbar toggle switches (`toggle-hidden`, `toggle-missing`, `toggle-changed`) with LocalStorage persistence.
 *  4. Tree-hierarchy-aware row filtering with parent match propagation.
 *  5. Hierarchy-aware count badge updates for hidden, missing, and changed items.
 *  6. Coordinator interceptor support for global filter focus (<kbd>/</kbd>).
 *  7. Debounced input handling (120ms) and isolated per-column match count badges with clear buttons.
 */

class FilterManager {
    /**
     * Initialize the FilterManager on a target table.
     *
     * @param {HTMLTableElement|string} table - Table DOM element or element ID string.
     * @param {Object} [options={}] - Configuration options.
     * @param {TreeTable|null} [options.treeTable=null] - TreeTable instance for O(1) hierarchy & traversal.
     * @param {HTMLElement} [options.tbody] - Custom <tbody> element (defaults to table.querySelector('tbody')).
     * @param {function(Object): void} [options.onFilterChange] - Callback invoked when filter state changes.
     * @param {function(HTMLTableRowElement|null): void} [options.onSelectRow] - Callback to focus a row in the table.
     * @param {function(number, string=): void} [options.onSortColumn] - Callback to trigger sorting by column index.
     * @param {function(string): void} [options.collapseDescendants] - Callback to collapse child rows when toggles hide items.
     * @param {string} [options.storagePrefix='zfs_explorer_'] - LocalStorage key prefix for toggle states.
     * @param {string} [options.toggleHiddenId='toggle-hidden'] - DOM ID for hidden files toggle.
     * @param {string} [options.toggleMissingId='toggle-missing'] - DOM ID for missing files toggle.
     * @param {string} [options.toggleChangedId='toggle-changed'] - DOM ID for changed files toggle.
     * @param {number} [options.debounceMs=120] - Debounce delay in milliseconds for filter typing.
     */
    constructor(table, options = {}) {
        this.table = typeof table === 'string' ? document.getElementById(table) : table;
        if (!this.table) {
            console.error('[FilterManager] Initialization failed: No table element provided.', table);
            return;
        }
        this.tbody = options.tbody || this.table.querySelector('tbody');
        if (!this.tbody) {
            console.error('[FilterManager] Initialization failed: Table has no <tbody> element.', this.table);
            return;
        }

        this.treeTable = options.treeTable;
        if (!this.treeTable) {
            console.error('[FilterManager] Initialization failed: Mandatory TreeTable instance missing.', this.table);
            return;
        }

        this.debounceMs = options.debounceMs !== undefined ? options.debounceMs : 120;
        this.debounceTimer = null;

        this.onFilterChange = options.onFilterChange || null;
        this.onSelectRow = options.onSelectRow || null;
        this.onSortColumn = options.onSortColumn || null;
        this.collapseDescendants = options.collapseDescendants || null;

        this.storagePrefix = options.storagePrefix || 'zfs_explorer_';
        this.toggleHiddenId = options.toggleHiddenId || 'toggle-hidden';
        this.toggleMissingId = options.toggleMissingId || 'toggle-missing';
        this.toggleChangedId = options.toggleChangedId || 'toggle-changed';

        this.init();
    }

    /**
     * Initialize filter inputs and toolbar toggles.
     */
    init() {
        this.initFiltering();
        this.initToggles();
    }

    /**
     * Bind input and keydown event listeners to the column filter inputs.
     */
    initFiltering() {
        const filterInputs = Array.from(this.table.querySelectorAll('thead tr.column-filter input'));
        filterInputs.forEach((input, idx) => {
            const runFilter = (immediate = false) => {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = null;
                }
                if (immediate) {
                    this.applyFilter();
                } else {
                    this.debounceTimer = setTimeout(() => {
                        this.applyFilter();
                    }, this.debounceMs);
                }
            };

            input.addEventListener('input', () => runFilter(false));

            const wrapper = input.closest('.filter-input-wrapper');
            const clearBtn = wrapper?.querySelector('.filter-clear-btn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    input.value = '';
                    runFilter(true);
                    input.focus();
                });
            }

            input.addEventListener('keydown', (e) => {
                const colIndex = parseInt(input.dataset.col || '1', 10);

                // Escape: Three-step clear and exit
                if (e.key === 'Escape') {
                    e.preventDefault();
                    if (input.value.length > 0) {
                        // Step 1: Clear current input field
                        input.value = '';
                        runFilter(true);
                        input.focus();
                    } else {
                        const hasOtherFilters = filterInputs.some((inp) => inp.value.length > 0);
                        if (hasOtherFilters) {
                            // Step 2: Current input is already empty, but others have text -> clear all filter inputs
                            filterInputs.forEach((inp) => {
                                inp.value = '';
                            });
                            runFilter(true);
                            input.focus();
                        } else {
                            // Step 3: All filter inputs are already empty -> release focus to table
                            input.blur();
                            const visibleRows = this.getVisibleRows();
                            if (visibleRows.length > 0 && this.onSelectRow) {
                                this.onSelectRow(visibleRows[0]);
                            }
                        }
                    }
                    return;
                }

                // Tab cycling across filter inputs
                if (e.key === 'Tab') {
                    runFilter(true);
                    if (e.shiftKey && idx === 0) {
                        e.preventDefault();
                        const last = filterInputs[filterInputs.length - 1];
                        last.focus();
                        last.select();
                        return;
                    }
                    if (!e.shiftKey && idx === filterInputs.length - 1) {
                        e.preventDefault();
                        const first = filterInputs[0];
                        first.focus();
                        first.select();
                        return;
                    }
                }

                // ArrowDown or Enter (without modifiers): Step down into first visible table row
                if (
                    (e.key === 'ArrowDown' && !e.ctrlKey && !e.altKey && !e.metaKey) ||
                    (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey)
                ) {
                    e.preventDefault();
                    runFilter(true);
                    input.blur();
                    const visibleRows = this.getVisibleRows();
                    if (this.onSelectRow) {
                        this.onSelectRow(visibleRows.length > 0 ? visibleRows[0] : null);
                    }
                    return;
                }

                // Sorting shortcuts from filter row
                if (this.onSortColumn) {
                    if (e.key === 'ArrowUp' && (e.ctrlKey || e.altKey)) {
                        e.preventDefault();
                        this.onSortColumn(colIndex, 'asc');
                    } else if (e.key === 'ArrowDown' && (e.ctrlKey || e.altKey)) {
                        e.preventDefault();
                        this.onSortColumn(colIndex, 'desc');
                    } else if (e.key === 'Enter' && e.shiftKey) {
                        e.preventDefault();
                        this.onSortColumn(colIndex);
                    }
                }
            });
        });
    }

    /**
     * Bind toolbar toggle switches and load persisted states from LocalStorage.
     */
    initToggles() {
        const toggleHidden = document.getElementById(this.toggleHiddenId);
        const toggleMissing = document.getElementById(this.toggleMissingId);
        const toggleChanged = document.getElementById(this.toggleChangedId);

        const showHidden = localStorage.getItem(`${this.storagePrefix}show_hidden`) === 'true';
        const showMissing = localStorage.getItem(`${this.storagePrefix}show_missing`) !== 'false';
        const showChangedOnly = localStorage.getItem(`${this.storagePrefix}show_changed_only`) === 'true';

        if (toggleHidden) {
            toggleHidden.checked = showHidden;
            this.table.classList.toggle('hide-hidden', !showHidden);
            toggleHidden.addEventListener('change', () => {
                const isChecked = toggleHidden.checked;
                this.table.classList.toggle('hide-hidden', !isChecked);
                localStorage.setItem(`${this.storagePrefix}show_hidden`, isChecked ? 'true' : 'false');
                if (!isChecked) {
                    this.tbody.querySelectorAll('tr[data-is-hidden="true"]').forEach((row) => {
                        if (row.dataset.path && this.collapseDescendants) {
                            this.collapseDescendants(row.dataset.path);
                        }
                        row.dataset.expanded = 'false';
                        const toggle = row.querySelector('.folder-toggle');
                        if (toggle) toggle.classList.remove('opened');
                    });
                }
                this.applyFilter();
            });
        }

        if (toggleMissing) {
            toggleMissing.checked = showMissing;
            this.table.classList.toggle('hide-missing', !showMissing);
            toggleMissing.addEventListener('change', () => {
                const isChecked = toggleMissing.checked;
                this.table.classList.toggle('hide-missing', !isChecked);
                localStorage.setItem(`${this.storagePrefix}show_missing`, isChecked ? 'true' : 'false');
                if (!isChecked) {
                    this.tbody.querySelectorAll('tr[data-is-missing="true"]').forEach((row) => {
                        if (row.dataset.path && this.collapseDescendants) {
                            this.collapseDescendants(row.dataset.path);
                        }
                        row.dataset.expanded = 'false';
                        const toggle = row.querySelector('.folder-toggle');
                        if (toggle) toggle.classList.remove('opened');
                    });
                }
                this.applyFilter();
            });
        }

        if (toggleChanged) {
            toggleChanged.checked = showChangedOnly;
            this.table.classList.toggle('hide-unchanged', showChangedOnly);
            toggleChanged.addEventListener('change', () => {
                const isChecked = toggleChanged.checked;
                this.table.classList.toggle('hide-unchanged', isChecked);
                localStorage.setItem(`${this.storagePrefix}show_changed_only`, isChecked ? 'true' : 'false');
                if (isChecked) {
                    this.tbody.querySelectorAll('tr[data-is-changed="false"]').forEach((row) => {
                        if (row.dataset.path && this.collapseDescendants) {
                            this.collapseDescendants(row.dataset.path);
                        }
                        row.dataset.expanded = 'false';
                        const toggle = row.querySelector('.folder-toggle');
                        if (toggle) toggle.classList.remove('opened');
                    });
                }
                this.applyFilter();
            });
        }
    }

    /**
     * Apply active column filters and toolbar toggle visibility to table rows.
     */
    applyFilter() {
        const filterInputs = Array.from(this.table.querySelectorAll('thead tr.column-filter input'));
        const allRows = this.treeTable.getAllRows();

        // 1. Update per-input isolated match count badges and clear buttons
        filterInputs.forEach((inp) => {
            const colIndex = parseInt(inp.dataset.col || '1', 10);
            const query = inp.value.trim().toLowerCase();
            const wrapper = inp.closest('.filter-input-wrapper');
            const badge = wrapper?.querySelector('.filter-badge');
            const clearBtn = wrapper?.querySelector('.filter-clear-btn');

            if (query.length > 0) {
                let colMatches = 0;
                allRows.forEach((row) => {
                    if (this.isRowInExpandedHierarchy(row)) {
                        const cell = row.children[colIndex];
                        if (cell) {
                            let text = '';
                            if (colIndex === 1) {
                                text = (row.dataset.filename || cell.dataset.sort || cell.textContent)
                                    .trim()
                                    .toLowerCase();
                            } else {
                                text = (cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent)
                                    .trim()
                                    .toLowerCase();
                            }
                            if (text.includes(query)) colMatches++;
                        }
                    }
                });

                if (badge) {
                    badge.textContent = String(colMatches);
                    badge.style.display = 'inline';
                }
                if (clearBtn) clearBtn.style.display = 'inline-flex';
                wrapper?.classList.add('has-filter');
            } else {
                if (badge) badge.style.display = 'none';
                if (clearBtn) clearBtn.style.display = 'none';
                wrapper?.classList.remove('has-filter');
            }
        });

        const activeFilters = filterInputs
            .map((inp) => ({
                colIndex: parseInt(inp.dataset.col || '1', 10),
                query: inp.value.trim().toLowerCase(),
            }))
            .filter((f) => f.query.length > 0);

        if (activeFilters.length === 0) {
            allRows.forEach((row) => row.classList.remove('filter-hidden'));
            this.updateToggleCounts();
            if (this.onFilterChange) {
                this.onFilterChange({ activeFilters: [], visibleRows: this.getVisibleRows(), matchMap: null });
            }
            return;
        }

        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        const matchMap = new Map();

        allRows.forEach((row) => {
            let matches = true;
            for (const f of activeFilters) {
                const cell = row.children[f.colIndex];
                if (!cell) {
                    matches = false;
                    break;
                }
                let text = '';
                if (f.colIndex === 1) {
                    text = (row.dataset.filename || cell.dataset.sort || cell.textContent).trim().toLowerCase();
                } else {
                    text = (cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent)
                        .trim()
                        .toLowerCase();
                }
                if (!text.includes(f.query)) {
                    matches = false;
                    break;
                }
            }
            matchMap.set(row, matches);
        });

        // Propagate match upward only from rows that are otherwise visible (O(1) pointer traversal)
        allRows.forEach((row) => {
            if (matchMap.get(row)) {
                if (hideHidden && row.dataset.isHidden === 'true') return;
                if (hideMissing && row.dataset.isMissing === 'true') return;
                if (hideUnchanged && row.dataset.isChanged === 'false') return;

                let curr = row._parent || this.treeTable.getParent(row);
                while (curr) {
                    matchMap.set(curr, true);
                    curr = curr._parent || this.treeTable.getParent(curr);
                }
            }
        });

        allRows.forEach((row) => {
            row.classList.toggle('filter-hidden', !matchMap.get(row));
        });

        this.updateToggleCounts();

        if (this.onFilterChange) {
            this.onFilterChange({ activeFilters, visibleRows: this.getVisibleRows(), matchMap });
        }
    }

    /**
     * Check if a row's entire parent chain in the tree is currently expanded.
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @returns {boolean} True if all ancestor folders are expanded.
     */
    isRowInExpandedHierarchy(row) {
        return this.treeTable.isRowInExpandedHierarchy(row);
    }

    /**
     * Update count badges and toolbar status indicators based on active filters and hierarchy.
     */
    updateToggleCounts() {
        const allRows = this.treeTable.getAllRows().filter((r) => this.treeTable.isRowInExpandedHierarchy(r));
        if (allRows.length === 0) return;

        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        let hiddenCount = 0;
        let missingCount = 0;
        let unchangedCount = 0;
        let changedCount = 0;
        const totalRows = allRows.length;
        let visibleRows = 0;

        allRows.forEach((row) => {
            const isHidden = row.dataset.isHidden === 'true';
            const isMissing = row.dataset.isMissing === 'true';
            const isChanged = row.dataset.isChanged === 'true';
            const isUnchanged = row.dataset.isChanged === 'false';

            if (isHidden) hiddenCount++;
            if (isMissing) missingCount++;
            if (isUnchanged) unchangedCount++;
            if (isChanged) changedCount++;

            let isVisible = true;
            if (row.classList.contains('filter-hidden') || row.style.display === 'none') isVisible = false;
            else if (hideHidden && isHidden) isVisible = false;
            else if (hideMissing && isMissing) isVisible = false;
            else if (hideUnchanged && isUnchanged) isVisible = false;

            if (isVisible) visibleRows++;
        });

        const badgeHidden = document.getElementById('badge-hidden-count');
        if (badgeHidden) {
            badgeHidden.textContent = String(hiddenCount);
            badgeHidden.style.display = hiddenCount > 0 ? 'inline-block' : 'none';
            badgeHidden.classList.toggle('is-filtering', hideHidden && hiddenCount > 0);
            badgeHidden.title = hideHidden
                ? `${hiddenCount} versteckte Dateien ausgeblendet`
                : `${hiddenCount} versteckte Dateien eingeblendet`;
        }

        const badgeMissing = document.getElementById('badge-missing-count');
        if (badgeMissing) {
            badgeMissing.textContent = String(missingCount);
            badgeMissing.style.display = missingCount > 0 ? 'inline-block' : 'none';
            badgeMissing.classList.toggle('is-filtering', hideMissing && missingCount > 0);
            badgeMissing.title = hideMissing
                ? `${missingCount} fehlende Dateien ausgeblendet`
                : `${missingCount} fehlende Dateien eingeblendet`;
        }

        const badgeChanged = document.getElementById('badge-changed-count');
        if (badgeChanged) {
            if (unchangedCount + changedCount > 0) {
                badgeChanged.textContent = `${changedCount}/${totalRows}`;
                badgeChanged.style.display = 'inline-block';
                badgeChanged.classList.toggle('is-filtering', hideUnchanged && unchangedCount > 0);
                badgeChanged.title = hideUnchanged
                    ? `${unchangedCount} statische Dateien ausgeblendet (${changedCount} sichtbar)`
                    : `${changedCount} geändert von ${totalRows}`;
            } else {
                badgeChanged.style.display = 'none';
            }
        }

        const stats = document.getElementById('toolbar-stats');
        if (stats) {
            const hiddenTotal = totalRows - visibleRows;
            if (hiddenTotal > 0) {
                const hiddenLabel = window.clientI18n?.['filter.stats_hidden'] || 'ausgeblendet';
                stats.innerHTML = `<span>${visibleRows} / ${totalRows}</span> <span style="opacity: 0.7;">(${hiddenTotal} ${hiddenLabel})</span>`;
            } else {
                stats.textContent = `${totalRows}`;
            }
        }
    }

    /**
     * Get array of all currently visible rows in the table.
     *
     * @returns {HTMLTableRowElement[]}
     */
    getVisibleRows() {
        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        return this.treeTable.getVisibleRows().filter((row) => {
            if (hideHidden && row.dataset.isHidden === 'true') {
                return false;
            }
            if (hideMissing && row.dataset.isMissing === 'true') {
                return false;
            }
            if (hideUnchanged && row.dataset.isChanged === 'false') {
                return false;
            }
            return true;
        });
    }

    /**
     * Focus and select a specific column's filter input.
     *
     * @param {number} [colIndex=1] - Target column index.
     */
    focusFilter(colIndex = 1) {
        const input = this.table.querySelector(`.column-filter input[data-col="${colIndex}"]`);
        if (input) {
            input.focus();
            input.select();
        }
    }

    /**
     * Clear all column filter inputs and reapply filters.
     */
    clearAllFilters() {
        const inputs = Array.from(this.table.querySelectorAll('thead tr.column-filter input'));
        inputs.forEach((input) => {
            input.value = '';
        });
        this.applyFilter();
    }

    /**
     * Interceptor method to handle global filter hotkeys (e.g. '/' to focus filter).
     *
     * @param {KeyboardEvent} e - Keyboard event.
     * @returns {boolean} True if event was consumed.
     */
    handleKeyDown(e) {
        const activeElem = document.activeElement;
        const activeTag = activeElem ? activeElem.tagName.toLowerCase() : '';
        const isTextInput =
            (activeTag === 'input' &&
                activeElem.type !== 'checkbox' &&
                activeElem.type !== 'radio' &&
                activeElem.type !== 'button') ||
            activeTag === 'textarea' ||
            activeTag === 'select';

        if (!isTextInput && e.key === '/') {
            e.preventDefault();
            this.focusFilter(1);
            return true;
        }

        return false;
    }
}

window.FilterManager = FilterManager;
