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
        this.isRowVisible =
            options.isRowVisible ||
            ((row) => {
                return (
                    row &&
                    row.tagName?.toLowerCase() === 'tr' &&
                    !row.classList.contains('filter-hidden') &&
                    row.style.display !== 'none'
                );
            });
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
            if (row && this.tbody.contains(row) && !e.target.closest('a')) {
                this.focusRow(row);
                // If a checkbox was clicked, blur it so keyboard navigation takes precedence
                if (e.target.closest('.custom-checkbox') || e.target.closest('input[type="checkbox"]')) {
                    if (document.activeElement && typeof document.activeElement.blur === 'function') {
                        document.activeElement.blur();
                    }
                }
            }
        });

        // Global keydown event dispatcher
        window.addEventListener('keydown', (e) => {
            const activeElem = document.activeElement;
            const activeTag = activeElem ? activeElem.tagName.toLowerCase() : '';
            const isTextInput =
                (activeTag === 'input' &&
                    activeElem.type !== 'checkbox' &&
                    activeElem.type !== 'radio' &&
                    activeElem.type !== 'button') ||
                activeTag === 'textarea' ||
                activeTag === 'select';

            // Run interceptors first (e.g. TypeaheadHUD, modals)
            for (const interceptor of this.interceptors) {
                if (interceptor(e, this.focusedRow)) {
                    return;
                }
            }

            // If text input is active, allow native input behaviour
            if (isTextInput) {
                return;
            }

            // If a checkbox or button is active, blur it so table navigation takes priority
            if (activeElem && (activeElem.type === 'checkbox' || activeElem.tagName.toLowerCase() === 'button')) {
                activeElem.blur();
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

        if (this.focusedRow) {
            this.focusedRow.classList.remove(this.focusedRowClass);
        } else {
            const prev = this.tbody.querySelector(`.${this.focusedRowClass}`);
            if (prev) prev.classList.remove(this.focusedRowClass);
        }

        this.focusedRow = row;
        if (row) {
            row.classList.add(this.focusedRowClass);
            if (scrollIntoView) {
                row.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }
        }

        // Defocus any checkboxes or buttons so that keyboard navigation remains active on table
        const active = document.activeElement;
        if (active && (active.type === 'checkbox' || active.tagName.toLowerCase() === 'button')) {
            active.blur();
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
        if (!this.focusedRow) {
            const visibleRows = this.getRows();
            if (visibleRows.length > 0) {
                this.focusRow(delta > 0 ? visibleRows[0] : visibleRows[visibleRows.length - 1]);
            }
            return;
        }

        // Fast-path: Walk DOM sibling pointers in O(1) without re-evaluating or copying the entire table
        if (delta === 1) {
            let next = this.focusedRow.nextElementSibling;
            while (next && !this.isRowVisible(next)) {
                next = next.nextElementSibling;
            }
            if (next) {
                this.focusRow(next);
                return;
            }
            // End of table reached: wrap to the first visible row
            let first = this.tbody.firstElementChild;
            while (first && !this.isRowVisible(first)) {
                first = first.nextElementSibling;
            }
            if (first) {
                this.focusRow(first);
            }
            return;
        }

        if (delta === -1) {
            let prev = this.focusedRow.previousElementSibling;
            while (prev && !this.isRowVisible(prev)) {
                prev = prev.previousElementSibling;
            }
            if (prev) {
                this.focusRow(prev);
                return;
            }
            // Top of table reached: wrap to the last visible row
            let last = this.tbody.lastElementChild;
            while (last && !this.isRowVisible(last)) {
                last = last.previousElementSibling;
            }
            if (last) {
                this.focusRow(last);
            }
            return;
        }

        // Generic fallback for larger deltas
        const visibleRows = this.getRows();
        if (visibleRows.length === 0) return;
        const currentIndex = visibleRows.indexOf(this.focusedRow);
        if (currentIndex >= 0) {
            const nextIndex = (currentIndex + delta + visibleRows.length) % visibleRows.length;
            this.focusRow(visibleRows[nextIndex]);
        }
    }

    /**
     * Step the focus by an entire page height, dynamically calculated based on table row height.
     *
     * @param {number} direction - +1 for page down, -1 for page up.
     */
    stepPage(direction) {
        if (!this.focusedRow) {
            this.stepFocus(direction > 0 ? 1 : -1);
            return;
        }

        // Dynamically determine single row height and visible viewport space
        const rowHeight = this.focusedRow.offsetHeight || 28;
        const tbodyRect = this.tbody.getBoundingClientRect();
        const availableHeight = Math.max(100, window.innerHeight - (tbodyRect.top > 0 ? tbodyRect.top : 100));
        const pageSize = Math.max(1, Math.floor(availableHeight / rowHeight));

        let target = this.focusedRow;
        for (let i = 0; i < pageSize; i++) {
            let sibling = direction > 0 ? target.nextElementSibling : target.previousElementSibling;
            while (sibling && !this.isRowVisible(sibling)) {
                sibling = direction > 0 ? sibling.nextElementSibling : sibling.previousElementSibling;
            }
            if (!sibling) break;
            target = sibling;
        }

        if (target && target !== this.focusedRow) {
            this.focusRow(target);
        }
    }

    /**
     * Ensure the focused row remains valid and visible.
     * If the focused row became hidden (e.g. through filtering or parent folder collapse),
     * moves focus to the closest visible row above it (previous visible sibling or parent),
     * or the next visible row below it, or clears focus if no rows are visible.
     */
    sanitizeFocus() {
        if (!this.focusedRow) return;

        if (!this.isRowVisible(this.focusedRow)) {
            // 1. Walk upwards in DOM order to find the nearest preceding visible row (sibling or parent)
            let candidate = this.focusedRow.previousElementSibling;
            while (candidate && !this.isRowVisible(candidate)) {
                candidate = candidate.previousElementSibling;
            }

            // 2. If no preceding visible row, search downwards for the nearest following visible row
            if (!candidate) {
                candidate = this.focusedRow.nextElementSibling;
                while (candidate && !this.isRowVisible(candidate)) {
                    candidate = candidate.nextElementSibling;
                }
            }

            // 3. Focus the candidate row or clear focus if nothing is visible
            this.focusRow(candidate || null, { updateHash: false });
        }
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
