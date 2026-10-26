/**
 * Universal Snapshot Explorer (USE) - TableSorter
 *
 * Interactive table sorting on top of `TableSortOrder`:
 *  1. Click / Enter / Space on sortable headers (`th.sortable`), toggling the direction.
 *  2. Alt+1..Alt+N column shortcuts, with their hint badges shown while Alt is held.
 *  3. Seamless integration with `TableColumnResizer` (suppressing drag-triggered sorts).
 */

class TableSorter extends TableSortOrder {
    /**
     * Attach click and keyboard listeners to sortable header elements, then restore the sort state.
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

        super.init();
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

        // Handle Alt+1 .. Alt+9 column sorting. Uses the physical key code (Digit1..Digit9)
        // rather than e.key, since on AZERTY (and other) layouts the top-row digits sit
        // on the shifted position and e.key would report the unshifted symbol instead.
        // Numpad1..Numpad9 are also honored (matching the old e.key-based check, which
        // browsers normalize to "1".."9" for numpad presses too) - but only when NumLock
        // is actually producing a digit: with NumLock off those same physical keys send
        // navigation (End, ArrowDown, ...) via e.key, which we don't want to hijack.
        const digitMatch = e.code.match(/^Digit([1-9])$/);
        const numpadMatch = !digitMatch && e.key >= '1' && e.key <= '9' ? e.code.match(/^Numpad([1-9])$/) : null;
        const match = digitMatch || numpadMatch;

        if (e.altKey && !e.ctrlKey && !e.metaKey && match) {
            const colNum = parseInt(match[1], 10);
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
