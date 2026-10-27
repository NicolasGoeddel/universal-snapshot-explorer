/**
 * Universal Snapshot Explorer (USE) - ExplorerBoot
 *
 * The part of the explorer that runs while its page is still being parsed, before the deferred
 * scripts: it sizes the table's columns, and shows the first folder's rows as soon as they
 * arrive, already filtered, sorted and striped. Everything interactive attaches to those rows
 * once the deferred scripts have run.
 */

const ExplorerBoot = {
    FILTER_TOGGLE_KEYS: {
        showHidden: 'zfs_explorer_show_hidden',
        showMissing: 'zfs_explorer_show_missing',
        showChangedOnly: 'zfs_explorer_show_changed_only',
    },

    /**
     * @returns {{showHidden: boolean, showMissing: boolean, showChangedOnly: boolean}} The saved toolbar toggles.
     */
    loadFilterToggles() {
        const read = (toggle) => {
            try {
                return localStorage.getItem(this.FILTER_TOGGLE_KEYS[toggle]);
            } catch (_e) {
                return null;
            }
        };
        return {
            showHidden: read('showHidden') === 'true',
            showMissing: read('showMissing') !== 'false',
            showChangedOnly: read('showChangedOnly') === 'true',
        };
    },

    /**
     * @param {'showHidden'|'showMissing'|'showChangedOnly'} toggle - Toolbar toggle.
     * @param {boolean} value - Its new state.
     */
    saveFilterToggle(toggle, value) {
        try {
            localStorage.setItem(this.FILTER_TOGGLE_KEYS[toggle], value ? 'true' : 'false');
        } catch (_e) {}
    },

    /**
     * Hide the row categories the toggles exclude; the hiding itself is done by CSS.
     *
     * @param {HTMLTableElement} table - Explorer table.
     * @param {{showHidden: boolean, showMissing: boolean, showChangedOnly: boolean}} toggles - Toolbar toggles.
     */
    applyFilterToggles(table, toggles) {
        table.classList.toggle('hide-hidden', !toggles.showHidden);
        table.classList.toggle('hide-missing', !toggles.showMissing);
        table.classList.toggle('hide-unchanged', toggles.showChangedOnly);
    },

    /**
     * How a snapshot bar orders: by number of changes between existing versions, then number of
     * snapshots the entry exists in, then number of runs of identical versions, then their lengths.
     *
     * @param {string} bar - One version character per snapshot, newest first ('x' when missing).
     * @returns {[number, number, number, number[]]} Sort key.
     */
    barSortKey(bar) {
        if (!bar) return [0, 0, 0, []];
        let changes = 0;
        let exists = 0;
        const lengths = [];
        let currentLen = 0;
        let lastChar = null;

        for (let i = 0; i < bar.length; i++) {
            const c = bar[i];
            if (c !== 'x') exists++;
            if (lastChar === null) {
                lastChar = c;
                currentLen = 1;
            } else if (c === lastChar) {
                currentLen++;
            } else {
                lengths.push(currentLen);
                if (lastChar !== 'x' && c !== 'x') changes++;
                lastChar = c;
                currentLen = 1;
            }
        }
        if (currentLen > 0) {
            lengths.push(currentLen);
        }

        return [changes, exists, lengths.length, lengths];
    },

    compareBarKeys(keyA, keyB) {
        if (keyA[0] !== keyB[0]) return keyA[0] - keyB[0];
        if (keyA[1] !== keyB[1]) return keyA[1] - keyB[1];
        if (keyA[2] !== keyB[2]) return keyA[2] - keyB[2];
        for (let i = 0; i < Math.min(keyA[3].length, keyB[3].length); i++) {
            if (keyA[3][i] !== keyB[3][i]) return keyA[3][i] - keyB[3][i];
        }
        return 0;
    },

    /**
     * @param {HTMLTableElement} table - Explorer table.
     * @returns {Object} The explorer's `TableSortOrder` options.
     */
    sortOptions(table) {
        return {
            tbody: table.tBodies[0],
            treeSort: true,
            storageKey: table.id || 'explorer',
            customComparators: {
                'snapshot-bar': (_valA, _valB, cellA, cellB) =>
                    this.compareBarKeys(
                        this.barSortKey(cellA?.dataset?.barStr || ''),
                        this.barSortKey(cellB?.dataset?.barStr || ''),
                    ),
            },
            // Folders stay above files when sorting by name
            rowComparator: (a, b, colIndex, baseCmp) => {
                if (colIndex === 1) {
                    const isDirLike = (row) =>
                        row.dataset.isFolder === 'true' ||
                        row.dataset.isSubDataset === 'true' ||
                        row.querySelector('.sub-dataset-name') !== null ||
                        row.querySelector('.folder-toggle') !== null;
                    const isDirA = isDirLike(a);
                    const isDirB = isDirLike(b);
                    if (isDirA !== isDirB) {
                        return isDirA ? -1 : 1;
                    }
                }
                return baseCmp;
            },
        };
    },

    /**
     * Whether a row is displayed, decided from the rules that hide rows rather than from its
     * layout, which the browser would have to compute for every row first.
     *
     * @param {HTMLTableElement} table - Explorer table.
     * @param {HTMLTableRowElement} row - One of its rows.
     * @returns {boolean} False when the row is hidden.
     */
    isRowShown(table, row) {
        if (row.style.display === 'none' || row.classList.contains('filter-hidden')) return false;
        if (table.classList.contains('hide-hidden') && row.dataset.isHidden === 'true') return false;
        // The selected row stays displayed even when its category is hidden
        if (row.classList.contains('selected-row')) return true;
        if (table.classList.contains('hide-missing') && row.dataset.isMissing === 'true') return false;
        if (table.classList.contains('hide-unchanged') && row.dataset.isChanged === 'false') return false;
        return true;
    },

    /**
     * Stripe the displayed rows. Without hidden rows CSS alternates them by itself.
     *
     * @param {HTMLTableElement} table - Explorer table.
     */
    stripeRows(table) {
        const rows = Array.from(table.tBodies[0].rows);
        const rendered = rows.filter((row) => this.isRowShown(table, row));
        const isFiltered = rendered.length !== rows.length;
        table.classList.toggle('is-filtered', isFiltered);
        rows.forEach((row) => row.classList.remove('odd', 'even'));
        if (!isFiltered) return;
        rendered.forEach((row, i) => row.classList.add(i % 2 === 0 ? 'odd' : 'even'));
    },

    /**
     * @param {string} url - URL of a folder's partial listing.
     * @returns {Promise<DocumentFragment>} The parsed response, holding its `data-nav-slot` templates.
     */
    async fetchSlots(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const template = document.createElement('template');
        template.innerHTML = await res.text();
        return template.content;
    },

    /**
     * Replace the content of every `data-nav-slot` element with the matching template of `fragment`.
     *
     * @param {DocumentFragment} fragment - Parsed partial listing.
     */
    applySlots(fragment) {
        fragment.querySelectorAll('template[data-nav-slot]').forEach((slot) => {
            document.querySelector(`[data-nav-slot="${slot.dataset.navSlot}"]`)?.replaceChildren(slot.content);
        });
    },

    /**
     * Apply the saved column widths and hidden columns, then reveal the table. Must run before any
     * row is laid out.
     *
     * @param {HTMLTableElement} table - Explorer table, parsed up to its header.
     */
    initColumns(table) {
        const resizer = new TableColumnResizer(table);
        this.columns = {
            resizer,
            visibility: new ColumnVisibilityManager(table, { resizer, toolbarButton: 'btn-column-visibility' }),
        };
        table.classList.add('is-sized');
    },

    /**
     * Show the rows of the folder the page was opened on as soon as they arrive. Rows sorted by
     * their snapshot bars wait for the bars instead, which only the deferred scripts load.
     *
     * @param {HTMLTableElement} table - Explorer table.
     * @param {Promise<DocumentFragment>} slots - The folder's partial listing, from the page or requested.
     */
    showFirstFolder(table, slots) {
        this.applyFilterToggles(table, this.loadFilterToggles());
        // Resolves to the listing when it is left for the deferred scripts to show
        this.firstFolder = slots.then((fragment) => {
            const sortOrder = new TableSortOrder(table, this.sortOptions(table));
            if (sortOrder.currentSort?.type === 'snapshot-bar') return fragment;
            this.applySlots(fragment);
            sortOrder.sort();
            table.querySelector('tbody.rows-skeleton').hidden = true;
            this.stripeRows(table);
            return null;
        });
    },
};

window.ExplorerBoot = ExplorerBoot;
