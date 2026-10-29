/**
 * Universal Snapshot Explorer (USE) - TableSortOrder
 *
 * The non-interactive half of table sorting, small enough to load before a page's first paint:
 *  1. Restores the persisted (or initial) sort state and marks its header.
 *  2. Sorts the rows, flat or as a tree, through pluggable column and row comparators.
 * `TableSorter` adds the header clicks and keyboard shortcuts on top of it.
 */

class TableSortOrder {
    /**
     * @param {HTMLTableElement|string} table - Table DOM element or element ID string.
     * @param {Object} [options={}] - Configuration options.
     * @param {HTMLElement} [options.tbody] - Custom <tbody> element (defaults to table.querySelector('tbody')).
     * @param {string} [options.storageKey] - Key used for LocalStorage persistence (defaults to table.id or dataset.storageKey).
     * @param {boolean} [options.treeSort=false] - Whether to maintain hierarchical tree structure during sorting.
     * @param {function(HTMLTableRowElement): string} [options.getTreeParent] - Extractor for row's parent path.
     * @param {function(HTMLTableRowElement): string} [options.getTreeId] - Extractor for row's unique identifier/path.
     * @param {function(): string} [options.getTreeRoot] - Returns top-level parent path for root rows.
     * @param {function(HTMLTableRowElement, number): (string|undefined)} [options.getSortValue] - A row's value in a column, when not the cell's `data-sort` or text.
     * @param {Object<string, function(string, string, HTMLElement, HTMLElement, string): number>} [options.customComparators={}] - Map of custom comparator functions keyed by sort-type.
     * @param {function(HTMLTableRowElement, HTMLTableRowElement, number, number, string): number} [options.rowComparator] - Optional high-priority row comparator (e.g. for keeping directories on top).
     * @param {function(number, string, string): void} [options.onSort] - Callback triggered after sorting is applied.
     * @param {Object} [options.initialSort] - Optional initial sort configuration.
     * @param {number} [options.initialSort.colIndex=0] - Column index to sort initially.
     * @param {'asc'|'desc'} [options.initialSort.direction='asc'] - Initial sort direction.
     * @param {boolean} [options.initialSort.triggerSort=false] - Whether to execute row sorting during init.
     */
    constructor(table, options = {}) {
        this.table = typeof table === 'string' ? document.getElementById(table) : table;
        if (!this.table) {
            console.error('[TableSortOrder] Initialization failed: No table element provided.', table);
            return;
        }
        this.tbody = options.tbody || this.table.querySelector('tbody');
        if (!this.tbody) {
            console.error('[TableSortOrder] Initialization failed: Table has no <tbody> element.', this.table);
            return;
        }
        this.storageKey = options.storageKey || this.table.id || this.table.dataset.storageKey || null;
        this.treeSort = options.treeSort ?? false;
        this.getTreeParent = options.getTreeParent || ((row) => row.dataset.parent || '');
        this.getTreeId = options.getTreeId || ((row) => row.dataset.path || '');
        this.getTreeRoot = options.getTreeRoot || (() => this.table.dataset.subpath || '');
        this.getSortValue = options.getSortValue || (() => undefined);
        this.customComparators = options.customComparators || {};
        this.rowComparator = options.rowComparator || null;
        this.onSort = options.onSort || null;
        this.initialSort = options.initialSort || null;
        this.currentSort = null;

        this.init();
    }

    /**
     * Restore the saved sort state, or the initial one when nothing was saved.
     */
    init() {
        if (this.storageKey) {
            try {
                const saved = localStorage.getItem(`tablesort-${this.storageKey}`);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed && typeof parsed.colIndex === 'number' && parsed.direction) {
                        this.setSortState(parsed.colIndex, parsed.direction, { persist: false });
                        return;
                    }
                }
            } catch (_e) {}
        }

        if (this.initialSort && typeof this.initialSort.colIndex === 'number') {
            this.setSortState(this.initialSort.colIndex, this.initialSort.direction || 'asc', {
                triggerSort: this.initialSort.triggerSort ?? false,
                persist: false,
            });
        }
    }

    /**
     * Programmatically set the sort state, update header classes, and optionally trigger row sorting.
     *
     * @param {number} cellIndex - 0-indexed column position.
     * @param {'asc'|'desc'} [direction='asc'] - Target sort direction.
     * @param {Object} [options={}] - Options object.
     * @param {boolean} [options.triggerSort=true] - Whether to re-sort and re-append table rows immediately.
     * @param {boolean} [options.persist=true] - Whether to save the state to LocalStorage.
     */
    setSortState(cellIndex, direction = 'asc', { triggerSort = true, persist = true } = {}) {
        const headerRow = this.table.querySelector('thead tr.header-row, thead tr:first-child');
        if (!headerRow) return;
        const th = headerRow.children[cellIndex];
        if (!th) return;

        const sortEl = th.matches('.sortable') ? th : th.querySelector('.sortable');
        const sortType = sortEl?.dataset.sortType || th.dataset.sortType || 'text';

        const allHeaderElements = this.table.querySelectorAll(
            'thead tr.header-row th, thead tr.header-row th .sortable, thead tr:first-child th, thead tr:first-child th .sortable',
        );
        allHeaderElements.forEach((h) => h.classList.remove('sort-asc', 'sort-desc'));

        if (sortEl) {
            sortEl.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
        th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');

        this.currentSort = { colIndex: cellIndex, direction, type: sortType };

        if (persist && this.storageKey) {
            try {
                localStorage.setItem(`tablesort-${this.storageKey}`, JSON.stringify(this.currentSort));
            } catch (_e) {}
        }

        if (triggerSort) {
            this.sort();
            if (typeof this.onSort === 'function') {
                this.onSort(cellIndex, direction, sortType);
            }
        }
    }

    /**
     * Compare two cell values based on the column's data type.
     *
     * @param {*} valA - Value from row A.
     * @param {*} valB - Value from row B.
     * @param {string} type - Data type ('text', 'number', 'date', 'octal', or custom).
     * @param {HTMLElement} cellA - DOM cell element of row A.
     * @param {HTMLElement} cellB - DOM cell element of row B.
     * @param {string} direction - Active sort direction ('asc' or 'desc').
     * @returns {number} Negative if A < B, positive if A > B, 0 if equal.
     */
    compareValues(valA, valB, type, cellA, cellB, direction) {
        if (this.customComparators[type]) {
            return this.customComparators[type](valA, valB, cellA, cellB, direction);
        }

        if (type === 'number') {
            const numA = parseFloat(valA) || 0;
            const numB = parseFloat(valB) || 0;
            return numA - numB;
        }
        if (type === 'date') {
            const numA = Number(valA);
            const numB = Number(valB);
            const tA = !Number.isNaN(numA) ? numA : Date.parse(valA);
            const tB = !Number.isNaN(numB) ? numB : Date.parse(valB);
            if (!Number.isNaN(tA) && !Number.isNaN(tB)) {
                return tA - tB;
            }
            return String(valA).localeCompare(String(valB));
        }
        if (type === 'octal') {
            return parseInt(String(valA), 8) - parseInt(String(valB), 8);
        }

        return String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
    }

    /**
     * Re-sort all rows currently in the <tbody> according to active sort state.
     */
    sort() {
        if (!this.currentSort || !this.tbody) return;
        const { colIndex, direction, type } = this.currentSort;
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        if (allRows.length === 0) return;

        const compareRows = (a, b) => {
            const cellA = a.children[colIndex];
            const cellB = b.children[colIndex];
            if (!cellA || !cellB) return 0;

            const value = (row, cell) =>
                this.getSortValue(row, colIndex) ?? cell.dataset.sort ?? cell.textContent.trim();
            const valA = value(a, cellA);
            const valB = value(b, cellB);

            let cmp = this.compareValues(valA, valB, type, cellA, cellB, direction);
            cmp = direction === 'asc' ? cmp : -cmp;

            if (typeof this.rowComparator === 'function') {
                return this.rowComparator(a, b, colIndex, cmp, direction);
            }
            return cmp;
        };

        if (this.treeSort) {
            const groups = new Map();
            allRows.forEach((row) => {
                const parent = this.getTreeParent(row);
                if (!groups.has(parent)) groups.set(parent, []);
                groups.get(parent).push(row);
            });

            const sortedRows = [];
            const appendSubtree = (parentPath) => {
                const children = groups.get(parentPath) || [];
                children.sort(compareRows);
                children.forEach((child) => {
                    sortedRows.push(child);
                    appendSubtree(this.getTreeId(child));
                });
            };

            const topLevelParent = this.getTreeRoot();
            appendSubtree(topLevelParent);

            allRows.forEach((row) => {
                if (!sortedRows.includes(row)) {
                    sortedRows.push(row);
                }
            });

            sortedRows.forEach((row) => this.tbody.appendChild(row));
        } else {
            allRows.sort(compareRows);
            allRows.forEach((row) => this.tbody.appendChild(row));
        }
    }

    /**
     * Get a copy of the current sort state.
     *
     * @returns {{colIndex: number, direction: 'asc'|'desc', type: string}|null}
     */
    getSortState() {
        return this.currentSort ? { ...this.currentSort } : null;
    }
}

window.TableSortOrder = TableSortOrder;
