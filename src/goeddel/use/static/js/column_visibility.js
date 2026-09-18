/**
 * Universal Snapshot Explorer (USE) - ColumnVisibilityManager
 *
 * Lets the user show/hide table columns from either a dedicated toolbar button or a
 * right-click on a column header, and persists the choice in LocalStorage, keyed per
 * table (by table id).
 *
 * The two triggers work differently by design:
 *  - Toolbar button: a standard `.dropdown` / `.dropdown-content` pair (same generic,
 *    CSS-only, zero-JS-lag hover mechanism the language/theme switcher and Snapshot Bar
 *    Criteria buttons already use - `.dropdown:hover .dropdown-content { display: block }`).
 *    The checkbox list lives inside that content div and is kept in sync via JS whenever
 *    visibility state changes; open/close itself needs no JS at all.
 *  - Column header right-click: a floating context menu, positioned at the cursor,
 *    opened/closed via JS (there's no header element to CSS-hover into for this one).
 *
 * Integrates with:
 *  - TableSorter: if the column currently being sorted on gets hidden, sorting reverts
 *    to the table's locked/primary column (see below) in ascending order.
 *  - TableColumnResizer: saved column-width percentages are rescaled so the currently
 *    visible columns always sum to 100%, avoiding a blank gap where a hidden column's
 *    reserved width used to be.
 *
 * Columns are hidden via CSS only (`hide-col-<index>` classes on the <table> element),
 * never removed from the DOM. This keeps column indices stable for the sorter/resizer
 * and for rows added later (e.g. lazily-loaded folder children in the tree table).
 *
 * The table's `data-elastic="true"` column (the primary identity column - "Name" in the
 * file browser, "Snapshot" in the details view) is always treated as locked: it can
 * never be hidden, and it's what sorting falls back to when a sorted column is hidden.
 */
class ColumnVisibilityManager {
    /**
     * @param {HTMLTableElement|string} table - Table element or its id.
     * @param {Object} [options={}]
     * @param {string} [options.storageKey] - LocalStorage key (defaults to `use_col_visibility_<table.id>`).
     * @param {TableSorter} [options.sorter] - Sorter instance sharing this table, for sort-fallback on hide.
     * @param {TableColumnResizer} [options.resizer] - Resizer instance sharing this table, for width rescaling.
     * @param {HTMLElement|string|Array<HTMLElement|string>} [options.toolbarButton] - Dedicated button(s), each
     *   expected to sit inside a `.dropdown` container alongside a sibling `.dropdown-content` element.
     */
    constructor(table, options = {}) {
        this.table = typeof table === 'string' ? document.getElementById(table) : table;
        if (!this.table) {
            console.error('[ColumnVisibilityManager] Initialization failed: Table element not found.', table);
            return;
        }

        this.storageKey = options.storageKey || `use_col_visibility_${this.table.id || 'table'}`;
        this.sorter = options.sorter || null;
        this.resizer = options.resizer || null;
        this.i18n = window.clientI18n || {};

        this.headerRow = this.table.querySelector('thead tr.header-row') || this.table.querySelector('thead tr:first-child');
        if (!this.headerRow) {
            console.warn('[ColumnVisibilityManager] Table has no header row.', this.table);
            return;
        }

        this.ths = Array.from(this.headerRow.children);
        this.columns = this.ths
            .map((th, index) => ({ th, index, key: th.dataset.colKey }))
            .filter((c) => c.key && !c.th.hasAttribute('data-fixed-width'));

        const elasticCol = this.columns.find((c) => c.th.hasAttribute('data-elastic'));
        this.lockedKey = elasticCol ? elasticCol.key : this.columns[0]?.key || null;

        this.hiddenKeys = new Set(this.loadFromStorage().filter((k) => k !== this.lockedKey));

        this.toolbarPanels = this.normalizeButtons(options.toolbarButton)
            .map((button) => ({ button, content: button.closest('.dropdown')?.querySelector(':scope > .dropdown-content') }))
            .filter((p) => p.content);

        this.contextMenu = null;
        this.contextColumnKey = null;

        this.applyVisibility();
        // Only rescale saved widths on load if a previous session actually hid something -
        // avoids nudging the untouched default column-width distribution for everyone else.
        if (this.hiddenKeys.size > 0) {
            this.syncColumnWidths();
        }
        this.bindColumnContextMenu();
        this.renderToolbarPanels();
    }

    normalizeButtons(input) {
        if (!input) return [];
        const list = Array.isArray(input) ? input : [input];
        return list.map((b) => (typeof b === 'string' ? document.getElementById(b) : b)).filter(Boolean);
    }

    // --- Persistence ---------------------------------------------------

    loadFromStorage() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.filter((k) => typeof k === 'string');
            }
        } catch (_e) {}
        return [];
    }

    saveToStorage() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify([...this.hiddenKeys]));
        } catch (_e) {}
    }

    // --- State -----------------------------------------------------------

    isHidden(key) {
        return this.hiddenKeys.has(key);
    }

    isLocked(key) {
        return key === this.lockedKey;
    }

    setHidden(key, hidden) {
        if (this.isLocked(key)) return;
        const col = this.columns.find((c) => c.key === key);
        if (!col || hidden === this.isHidden(key)) return;

        if (hidden) {
            this.hiddenKeys.add(key);
            this.revertSortIfNeeded(col);
        } else {
            this.hiddenKeys.delete(key);
        }

        this.saveToStorage();
        this.applyVisibility();
        this.syncColumnWidths();
        this.renderToolbarPanels();
        if (this.contextMenu?.classList.contains('open')) {
            this.renderContextMenu(this.contextColumnKey);
        }
    }

    resetAll() {
        if (this.hiddenKeys.size === 0) return;
        this.hiddenKeys.clear();
        this.saveToStorage();
        this.applyVisibility();
        this.syncColumnWidths();
        this.renderToolbarPanels();
        if (this.contextMenu?.classList.contains('open')) {
            this.renderContextMenu(this.contextColumnKey);
        }
    }

    revertSortIfNeeded(hiddenCol) {
        if (!this.sorter || typeof this.sorter.getSortState !== 'function') return;
        const state = this.sorter.getSortState();
        if (!state || state.colIndex !== hiddenCol.index) return;
        const lockedCol = this.columns.find((c) => c.key === this.lockedKey);
        if (lockedCol && typeof this.sorter.setSortState === 'function') {
            this.sorter.setSortState(lockedCol.index, 'asc');
        }
    }

    // --- Visibility + layout ----------------------------------------------

    applyVisibility() {
        Array.from(this.table.classList).forEach((cls) => {
            if (/^hide-col-\d+$/.test(cls)) this.table.classList.remove(cls);
        });
        this.columns.forEach((col) => {
            if (this.isHidden(col.key)) {
                this.table.classList.add(`hide-col-${col.index}`);
            }
        });
    }

    /** Rescales saved column-width percentages so the currently visible columns sum to 100%. */
    syncColumnWidths() {
        if (!this.resizer || !this.resizer.savedPercentages) return;
        const sp = this.resizer.savedPercentages;
        const visibleKeys = this.columns.filter((c) => !this.isHidden(c.key)).map((c) => c.key);
        if (visibleKeys.length === 0) return;

        let sum = 0;
        visibleKeys.forEach((key) => {
            if (sp[key] === undefined) {
                const col = this.columns.find((c) => c.key === key);
                const def = col ? parseFloat(col.th.getAttribute('data-default-pct')) : NaN;
                sp[key] = !Number.isNaN(def) ? def : 100 / visibleKeys.length;
            }
            sum += sp[key];
        });

        if (sum > 0) {
            visibleKeys.forEach((key) => {
                sp[key] = (sp[key] / sum) * 100;
            });
        }

        this.resizer.savedPercentages = sp;
        if (typeof this.resizer.savePercentages === 'function') this.resizer.savePercentages();
        if (typeof this.resizer.applySavedPercentages === 'function') this.resizer.applySavedPercentages();
    }

    getLabel(col) {
        const clone = col.th.cloneNode(true);
        clone.querySelectorAll('.col-resizer, .col-shortcut-hint').forEach((el) => el.remove());
        return clone.textContent.trim();
    }

    // --- Shared list rendering ---------------------------------------------

    renderHeader(container) {
        const header = document.createElement('div');
        header.className = 'col-visibility-header';
        const title = document.createElement('span');
        title.textContent = this.i18n['columns.title'] || 'Columns';
        header.appendChild(title);
        if (this.hiddenKeys.size > 0) {
            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.className = 'col-visibility-reset-btn';
            resetBtn.textContent = this.i18n['columns.reset'] || 'Show all';
            resetBtn.addEventListener('click', () => this.resetAll());
            header.appendChild(resetBtn);
        }
        container.appendChild(header);
    }

    renderCheckboxList(container) {
        this.columns.forEach((col) => {
            const locked = this.isLocked(col.key);
            const item = document.createElement('label');
            item.className = 'col-visibility-item' + (locked ? ' locked' : '');

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'custom-checkbox';
            cb.checked = locked || !this.isHidden(col.key);
            cb.disabled = locked;
            cb.addEventListener('change', () => this.setHidden(col.key, !cb.checked));

            const span = document.createElement('span');
            span.textContent = this.getLabel(col);

            item.appendChild(cb);
            item.appendChild(span);
            container.appendChild(item);
        });
    }

    // --- Toolbar panel: plain CSS-hover `.dropdown-content` ------------------

    renderToolbarPanels() {
        this.toolbarPanels.forEach(({ content }) => {
            content.innerHTML = '';
            this.renderHeader(content);
            this.renderCheckboxList(content);
        });
    }

    // --- Per-column trigger: right-click on the header -----------------------

    bindColumnContextMenu() {
        this.columns.forEach((col) => {
            col.th.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openContextMenu(e.clientX, e.clientY, col.key);
            });
        });
    }

    ensureContextMenu() {
        if (this.contextMenu) return this.contextMenu;

        const menu = document.createElement('div');
        menu.className = 'col-visibility-menu col-visibility-context-menu';
        menu.addEventListener('click', (e) => e.stopPropagation());
        document.body.appendChild(menu);
        this.contextMenu = menu;

        document.addEventListener('click', (e) => {
            if (this.contextMenu?.classList.contains('open') && !this.contextMenu.contains(e.target)) {
                this.closeContextMenu();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.contextMenu?.classList.contains('open')) {
                this.closeContextMenu();
            }
        });
        window.addEventListener('resize', () => this.closeContextMenu());
        window.addEventListener(
            'scroll',
            (e) => {
                if (this.contextMenu && !this.contextMenu.contains(e.target)) this.closeContextMenu();
            },
            true,
        );

        return menu;
    }

    renderContextMenu(contextKey) {
        const menu = this.ensureContextMenu();
        menu.innerHTML = '';

        if (contextKey && !this.isLocked(contextKey)) {
            const hideBtn = document.createElement('button');
            hideBtn.type = 'button';
            hideBtn.className = 'col-visibility-hide-action';
            hideBtn.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>' +
                `<span>${this.i18n['columns.hide_this'] || 'Hide this column'}</span>`;
            hideBtn.addEventListener('click', () => {
                this.setHidden(contextKey, true);
                this.closeContextMenu();
            });
            menu.appendChild(hideBtn);
            menu.appendChild(Object.assign(document.createElement('div'), { className: 'col-visibility-separator' }));
        }

        this.renderHeader(menu);
        this.renderCheckboxList(menu);

        return menu;
    }

    positionContextMenu(x, y) {
        if (!this.contextMenu) return;
        const menuWidth = this.contextMenu.offsetWidth || 220;
        const menuHeight = this.contextMenu.offsetHeight || 0;
        let left = x;
        let top = y;
        if (left + menuWidth > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - menuWidth - 8);
        }
        if (menuHeight && top + menuHeight > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - menuHeight - 8);
        }
        this.contextMenu.style.top = `${top}px`;
        this.contextMenu.style.left = `${left}px`;
    }

    openContextMenu(x, y, contextKey) {
        this.contextColumnKey = contextKey;
        const menu = this.renderContextMenu(contextKey);
        menu.classList.add('open');
        this.positionContextMenu(x, y);
    }

    closeContextMenu() {
        this.contextMenu?.classList.remove('open');
    }
}

window.ColumnVisibilityManager = ColumnVisibilityManager;
