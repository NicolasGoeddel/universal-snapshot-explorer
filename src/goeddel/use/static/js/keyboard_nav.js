/**
 * Universal Snapshot Explorer (USE) - KeyboardNavigator
 *
 * Generic, reusable keyboard navigation engine supporting:
 *  1. Row focus management and smooth scrolling (`↑`, `↓`, `PageUp`, `PageDown`, `Home`, `End`).
 *  2. Dynamic keybinding registry API (`register(keyCombo, handler)`).
 *  3. Pluggable interceptor chain (`addInterceptor(fn)`).
 *  4. Click-to-focus row synchronization.
 */

class KeyboardNavigator {
    /**
     * Initialize the keyboard navigator on a target table element.
     *
     * @param {HTMLTableElement|string} table - Table DOM element or element ID string.
     * @param {Object} [options={}] - Configuration options.
     * @param {HTMLElement} [options.tbody] - Custom <tbody> element (defaults to table.querySelector('tbody')).
     * @param {function(): Array<HTMLTableRowElement>} [options.getRows] - Function returning list of navigable/visible rows.
     * @param {function(HTMLTableRowElement|null, Object): void} [options.onFocusChange] - Callback when focused row changes.
     * @param {string} [options.focusedRowClass='selected-row'] - CSS class applied to currently focused row.
     */
    constructor(table, options = {}) {
        this.table = typeof table === 'string' ? document.getElementById(table) : table;
        if (!this.table) {
            console.error('[KeyboardNavigator] Initialization failed: No table element provided.', table);
            return;
        }
        this.tbody = options.tbody || this.table.querySelector('tbody');
        if (!this.tbody) {
            console.error('[KeyboardNavigator] Initialization failed: Table has no <tbody> element.', this.table);
            return;
        }

        this.getRows =
            options.getRows ||
            (() => {
                return Array.from(this.tbody.querySelectorAll('tr')).filter((row) => {
                    return (
                        !row.classList.contains('filter-hidden') &&
                        row.style.display !== 'none' &&
                        row.offsetParent !== null
                    );
                });
            });
        this.onFocusChange = options.onFocusChange || null;
        this.focusedRowClass = options.focusedRowClass || 'selected-row';
        this.focusedRow = null;

        this.handlers = new Map();
        this.interceptors = [];

        this.init();
    }

    /**
     * Attach global keydown listeners and table row click delegation.
     */
    init() {
        // Click delegation on tbody rows
        this.tbody.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (
                row &&
                this.tbody.contains(row) &&
                !e.target.closest('a') &&
                !e.target.closest('.custom-checkbox') &&
                !e.target.closest('.folder-toggle')
            ) {
                this.focusRow(row);
            }
        });

        // Global keydown event dispatcher
        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

            // Run interceptors first (e.g. TypeaheadHUD, modals)
            for (const interceptor of this.interceptors) {
                if (interceptor(e, this.focusedRow)) {
                    return;
                }
            }

            // If input is active, allow native input behaviour
            if (isInputActive) {
                return;
            }

            // Check custom registered handlers first
            const combo = this.getEventKeyCombo(e);
            if (this.handlers.has(combo)) {
                const handlerList = this.handlers.get(combo);
                for (const handler of handlerList) {
                    const res = handler(this.focusedRow, e);
                    if (res !== false) {
                        e.preventDefault();
                        return;
                    }
                }
            }

            // Built-in Navigation: Escape
            if (e.key === 'Escape') {
                if (this.focusedRow) {
                    this.focusRow(null);
                    return;
                }
            }

            // Built-in Navigation: ArrowDown
            if (e.key === 'ArrowDown' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                this.stepFocus(1);
                return;
            }

            // Built-in Navigation: ArrowUp
            if (e.key === 'ArrowUp' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                this.stepFocus(-1);
                return;
            }

            // Built-in Navigation: Home
            if (e.key === 'Home') {
                e.preventDefault();
                const visible = this.getRows();
                if (visible.length > 0) this.focusRow(visible[0]);
                return;
            }

            // Built-in Navigation: End
            if (e.key === 'End') {
                e.preventDefault();
                const visible = this.getRows();
                if (visible.length > 0) this.focusRow(visible[visible.length - 1]);
                return;
            }

            // Built-in Navigation: PageDown
            if (e.key === 'PageDown') {
                e.preventDefault();
                this.stepPage(1);
                return;
            }

            // Built-in Navigation: PageUp
            if (e.key === 'PageUp') {
                e.preventDefault();
                this.stepPage(-1);
                return;
            }
        });
    }

    /**
     * Helper to compute standardized key combination string (e.g. 'Ctrl+ArrowLeft', 'Shift+Space', 'Enter').
     *
     * @param {KeyboardEvent} e - Keyboard event.
     * @returns {string} Standardized combo key string.
     */
    getEventKeyCombo(e) {
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey && e.key !== 'Shift') parts.push('Shift');

        let keyName = e.key;
        if (keyName === ' ') keyName = 'Space';
        else if (keyName.length === 1) keyName = keyName.toUpperCase();

        parts.push(keyName);
        return parts.join('+');
    }

    /**
     * Register a custom key combination handler.
     *
     * @param {string|Array<string>} keyCombos - Key string (e.g. 'Space', 'Shift+Space', 'Ctrl+I', 'Enter') or array of strings.
     * @param {function(HTMLTableRowElement|null, KeyboardEvent): (boolean|void)} handler - Handler callback. Return false to prevent default blocking.
     */
    register(keyCombos, handler) {
        const combos = Array.isArray(keyCombos) ? keyCombos : [keyCombos];
        combos.forEach((combo) => {
            const normalized = combo
                .split('+')
                .map((p) => (p.length === 1 ? p.toUpperCase() : p))
                .join('+');
            if (!this.handlers.has(normalized)) {
                this.handlers.set(normalized, []);
            }
            this.handlers.get(normalized).push(handler);
        });
    }

    /**
     * Add a high-priority event interceptor to the chain.
     *
     * @param {function(KeyboardEvent, HTMLTableRowElement|null): boolean} interceptor - Returns true if the event was consumed.
     */
    addInterceptor(interceptor) {
        this.interceptors.push(interceptor);
    }

    /**
     * Focus a specific row, update focus styling, and dispatch `onFocusChange`.
     *
     * @param {HTMLTableRowElement|null} row - Target table row to focus, or null to clear.
     * @param {Object} [options={}] - Options object.
     * @param {boolean} [options.scrollIntoView=true] - Whether to scroll the row into view.
     * @param {boolean} [options.updateHash=true] - Custom flag passed to onFocusChange callback.
     */
    focusRow(row, options = {}) {
        const { scrollIntoView = true } = options;
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        allRows.forEach((r) => r.classList.remove(this.focusedRowClass));

        this.focusedRow = row;
        if (row) {
            row.classList.add(this.focusedRowClass);
            if (scrollIntoView) {
                row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        if (typeof this.onFocusChange === 'function') {
            this.onFocusChange(this.focusedRow, options);
        }
    }

    /**
     * Step the focus forward or backward by a given row delta.
     *
     * @param {number} delta - +1 for next row, -1 for previous row.
     */
    stepFocus(delta) {
        const visibleRows = this.getRows();
        if (visibleRows.length === 0) return;

        const currentIndex = this.focusedRow ? visibleRows.indexOf(this.focusedRow) : -1;
        if (currentIndex >= 0) {
            const nextIndex = (currentIndex + delta + visibleRows.length) % visibleRows.length;
            this.focusRow(visibleRows[nextIndex]);
        } else if (this.focusedRow) {
            // Focused row might be hidden (e.g. inside a collapsed folder)
            const allRows = Array.from(this.tbody.querySelectorAll('tr'));
            const selectedDomIdx = allRows.indexOf(this.focusedRow);
            if (delta > 0) {
                const nextRow = visibleRows.find((r) => allRows.indexOf(r) > selectedDomIdx) || visibleRows[0];
                this.focusRow(nextRow);
            } else {
                const precedingRows = visibleRows.filter((r) => allRows.indexOf(r) < selectedDomIdx);
                const prevRow =
                    precedingRows.length > 0
                        ? precedingRows[precedingRows.length - 1]
                        : visibleRows[visibleRows.length - 1];
                this.focusRow(prevRow);
            }
        } else {
            this.focusRow(delta > 0 ? visibleRows[0] : visibleRows[visibleRows.length - 1]);
        }
    }

    /**
     * Step the focus by an entire page height, dynamically calculated based on table row height.
     *
     * @param {number} direction - +1 for page down, -1 for page up.
     */
    stepPage(direction) {
        const visibleRows = this.getRows();
        if (visibleRows.length === 0) return;

        // Dynamically determine single row height and visible viewport space
        const rowHeight = visibleRows[0]?.offsetHeight || 28;
        const tbodyRect = this.tbody.getBoundingClientRect();
        const availableHeight = Math.max(100, window.innerHeight - (tbodyRect.top > 0 ? tbodyRect.top : 100));
        const pageSize = Math.max(1, Math.floor(availableHeight / rowHeight));

        let baseIdx = this.focusedRow ? visibleRows.indexOf(this.focusedRow) : -1;
        if (baseIdx < 0) {
            baseIdx = direction > 0 ? 0 : visibleRows.length - 1;
        }

        const targetIdx = Math.max(0, Math.min(visibleRows.length - 1, baseIdx + direction * pageSize));
        this.focusRow(visibleRows[targetIdx]);
    }

    /**
     * Get currently focused row element.
     *
     * @returns {HTMLTableRowElement|null}
     */
    getFocusedRow() {
        return this.focusedRow;
    }
}

window.KeyboardNavigator = KeyboardNavigator;
