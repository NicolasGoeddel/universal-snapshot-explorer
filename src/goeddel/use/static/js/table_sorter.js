/**
 * Universal Snapshot Explorer (USE) - TableSorter
 *
 * Standalone, reusable table sorting engine supporting:
 *  1. Pluggable custom column comparators (`customComparators`).
 *  2. Hierarchical tree sorting (with folder-first and recursive subtree preservation).
 *  3. Multi-type data extraction (text, number, date/timestamps, octal permissions, custom types).
 *  4. HTML5 declarative configuration via `data-sort`, `data-sort-type`, and `data-default-dir`.
 *  5. LocalStorage state persistence across page visits.
 *  6. Seamless integration with `TableColumnResizer` (suppressing drag-triggered sorts).
 *  7. Complete programmatic sorting API (`sortByColumnIndex`, `setSortState`, `getSortState`).
 */

class TableSorter {
    /**
     * Initialize the table sorter on a target table element.
     *
     * @param {HTMLTableElement|string} table - Table DOM element or element ID string.
     * @param {Object} [options={}] - Configuration options.
     * @param {HTMLElement} [options.tbody] - Custom <tbody> element (defaults to table.querySelector('tbody')).
     * @param {string} [options.storageKey] - Key used for LocalStorage persistence (defaults to table.id or dataset.storageKey).
     * @param {boolean} [options.treeSort=false] - Whether to maintain hierarchical tree structure during sorting.
     * @param {function(HTMLTableRowElement): string} [options.getTreeParent] - Extractor for row's parent path.
     * @param {function(HTMLTableRowElement): string} [options.getTreeId] - Extractor for row's unique identifier/path.
     * @param {function(): string} [options.getTreeRoot] - Returns top-level parent path for root rows.
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
            console.error('[TableSorter] Initialization failed: No table element provided.', table);
            return;
        }
        this.tbody = options.tbody || this.table.querySelector('tbody');
        if (!this.tbody) {
            console.error('[TableSorter] Initialization failed: Table has no <tbody> element.', this.table);
            return;
        }
        this.storageKey = options.storageKey || this.table.id || this.table.dataset.storageKey || null;
        this.treeSort = options.treeSort ?? false;
        this.getTreeParent = options.getTreeParent || ((row) => row.dataset.parent || '');
        this.getTreeId = options.getTreeId || ((row) => row.dataset.path || '');
        this.getTreeRoot = options.getTreeRoot || (() => this.table.dataset.subpath || '');
        this.customComparators = options.customComparators || {};
        this.rowComparator = options.rowComparator || null;
        this.onSort = options.onSort || null;
        this.initialSort = options.initialSort || null;
        this.currentSort = null;

        this.init();
    }

    /**
     * Attach click and keyboard listeners to sortable header elements and restore saved sort state.
     */
    init() {
        const headerRow = this.table.querySelector('thead tr.header-row, thead tr:first-child');
        if (!headerRow) {
            console.warn('[TableSorter] Table has no <thead> header row.', this.table);
            return;
        }

        const sortElements = headerRow.querySelectorAll('th.sortable, th .sortable');
        sortElements.forEach((el) => {
            el.setAttribute('tabindex', '0');
            el.setAttribute('role', 'button');

            el.addEventListener('click', (e) => {
                if (e.target.closest('a') || e.target.closest('svg') || e.target.closest('.col-resizer')) {
                    return;
                }
                const th = el.closest('th');
                if (!th?.parentNode) return;
                const cellIndex = Array.from(th.parentNode.children).indexOf(th);
                this.sortByColumnIndex(cellIndex);
            });

            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const th = el.closest('th');
                    if (!th?.parentNode) return;
                    const cellIndex = Array.from(th.parentNode.children).indexOf(th);
                    this.sortByColumnIndex(cellIndex);
                }
            });
        });

        // Add visual shortcut hint numbers (Alt+1..Alt+N) to sortable headers
        let sortIndex = 1;
        Array.from(headerRow.children).forEach((th) => {
            const isSortable = th.classList.contains('sortable') || th.querySelector('.sortable');
            if (isSortable) {
                if (!th.querySelector('.col-shortcut-hint')) {
                    const badge = document.createElement('span');
                    badge.className = 'col-shortcut-hint';
                    badge.textContent = String(sortIndex);
                    badge.title = `Alt+${sortIndex}`;
                    th.appendChild(badge);
                }
                sortIndex++;
            }
        });

        // Global Alt release/blur listener
        if (!window._tableSorterAltReleaseBound) {
            window._tableSorterAltReleaseBound = true;
            window.addEventListener('keyup', (e) => {
                if (e.key === 'Alt') {
                    document.body.classList.remove('show-alt-hints');
                }
            });
            window.addEventListener('blur', () => {
                document.body.classList.remove('show-alt-hints');
            });
        }

        // Restore initial sort or saved state
        if (this.storageKey) {
            try {
                const saved = localStorage.getItem(`tablesort-${this.storageKey}`);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed && typeof parsed.colIndex === 'number' && parsed.direction) {
                        this.sortByColumnIndex(parsed.colIndex, parsed.direction, false);
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
     * Toggle or set the sort direction of a specified column and trigger re-sorting.
     *
     * @param {number} cellIndex - 0-indexed column position.
     * @param {'asc'|'desc'|null} [forcedDirection=null] - Forced direction or null to toggle.
     * @param {boolean} [persist=true] - Whether to persist sort state to LocalStorage.
     */
    sortByColumnIndex(cellIndex, forcedDirection = null, persist = true) {
        const headerRow = this.table.querySelector('thead tr.header-row, thead tr:first-child');
        if (!headerRow) return;
        const th = headerRow.children[cellIndex];
        if (!th) return;

        const sortEl = th.matches('.sortable') ? th : th.querySelector('.sortable');
        if (!sortEl) return;

        let direction = forcedDirection || sortEl.dataset.defaultDir || th.dataset.defaultDir || 'asc';
        if (!forcedDirection && this.currentSort && this.currentSort.colIndex === cellIndex) {
            direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
        }

        th.classList.remove('sort-flash');
        void th.offsetWidth;
        th.classList.add('sort-flash');

        this.setSortState(cellIndex, direction, { triggerSort: true, persist });
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

            const valA = cellA.dataset.sort !== undefined ? cellA.dataset.sort : cellA.textContent.trim();
            const valB = cellB.dataset.sort !== undefined ? cellB.dataset.sort : cellB.textContent.trim();

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

    /**
     * Get array of 0-based cell indices for all sortable columns in this table.
     *
     * @returns {number[]}
     */
    getSortableColumnIndices() {
        const headerRow = this.table.querySelector('thead tr.header-row, thead tr:first-child');
        if (!headerRow) return [];
        const indices = [];
        Array.from(headerRow.children).forEach((th, idx) => {
            if (th.classList.contains('sortable') || th.querySelector('.sortable')) {
                indices.push(idx);
            }
        });
        return indices;
    }

    /**
     * Interceptor method to handle Alt-key shortcut overlay and Alt+1..Alt+N column sorting.
     *
     * @param {KeyboardEvent} e - Keyboard event.
     * @returns {boolean} True if the event was handled/consumed.
     */
    handleKeyDown(e) {
        // Show column shortcut badges when Alt is pressed
        if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey) {
            document.body.classList.add('show-alt-hints');
            return false;
        }

        // Handle Alt+1 .. Alt+9 column sorting
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '9') {
            const colNum = parseInt(e.key, 10);
            const sortableIndices = this.getSortableColumnIndices();
            if (colNum >= 1 && colNum <= sortableIndices.length) {
                e.preventDefault();
                this.sortByColumnIndex(sortableIndices[colNum - 1]);
                return true;
            }
        }

        return false;
    }
}

window.TableSorter = TableSorter;
