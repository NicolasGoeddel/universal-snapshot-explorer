let cachedMimeMap = null;

function applyCategoricalColors() {
    const table = document.getElementById('details');
    if (!table) return;

    const colSelectors = [
        '.browser-cell-size',
        '.browser-cell-type',
        '.browser-cell-owner',
        '.browser-cell-mode',
        '.browser-cell-mtime',
        '.browser-cell-ctime',
    ];

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    // Sort from newest snapshot to oldest snapshot (matching ExplorerView color order)
    const orderedRows = [...rows].sort((a, b) => {
        const idxA = parseInt(a.dataset.chronologicalIndex || '0', 10);
        const idxB = parseInt(b.dataset.chronologicalIndex || '0', 10);
        return idxB - idxA;
    });

    colSelectors.forEach((selector) => {
        // Clear previous categorical classes
        rows.forEach((tr) => {
            const cell = tr.querySelector(selector);
            if (cell) {
                cell.classList.remove('cat-val-1', 'cat-val-2', 'cat-val-3', 'cat-val-4', 'cat-val-5', 'cat-val-6');
            }
        });

        // Collect unique values in order from newest snapshot to oldest
        const uniqueValues = [];
        orderedRows.forEach((tr) => {
            if (tr.dataset.doesExist !== 'true') return;
            const cell = tr.querySelector(selector);
            if (!cell) return;

            const val = (cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent).trim();
            if (val && !uniqueValues.includes(val)) {
                uniqueValues.push(val);
            }
        });

        // Only apply categorical colors if there are 2 or more distinct values across snapshots
        if (uniqueValues.length >= 2) {
            orderedRows.forEach((tr) => {
                if (tr.dataset.doesExist !== 'true') return;
                const cell = tr.querySelector(selector);
                if (!cell) return;

                const val = (cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent).trim();
                const valIndex = uniqueValues.indexOf(val);
                if (valIndex >= 0) {
                    const colorIndex = (valIndex % 6) + 1;
                    cell.classList.add(`cat-val-${colorIndex}`);
                }
            });
        }
    });
}

function refreshMimeDiffs() {
    if (!cachedMimeMap) return;
    const rows = Array.from(document.querySelectorAll('#details tbody tr'));
    // Sort chronologically for diff evaluation
    const chronoRows = [...rows].sort((a, b) => {
        const idxA = parseInt(a.dataset.chronologicalIndex || '0', 10);
        const idxB = parseInt(b.dataset.chronologicalIndex || '0', 10);
        return idxA - idxB;
    });

    let prevMime = null;
    chronoRows.forEach((tr) => {
        const snapId = tr.dataset.snapshotId;
        const exists = tr.dataset.doesExist === 'true';
        const cell = tr.querySelector('.browser-cell-type');
        if (!cell || !exists) {
            prevMime = null;
            return;
        }

        const isFolder = cell.dataset.isFolder === 'true';
        if (isFolder) {
            const typeText = cell.textContent.trim();
            if (prevMime !== null && typeText !== prevMime) {
                cell.classList.add('cell-changed');
                const i18nChangedFrom = window.clientI18n ? window.clientI18n['action.changed_from'] : 'Geändert von';
                cell.title = `${i18nChangedFrom}: ${prevMime} → ${typeText}`;
            } else {
                cell.classList.remove('cell-changed');
                cell.removeAttribute('title');
            }
            prevMime = typeText;
            return;
        }

        const isSymlink = cell.dataset.isSymlink === 'true';
        if (isSymlink) {
            prevMime = 'inode/symlink';
            return;
        }

        const mime = cachedMimeMap[snapId] || 'file';
        cell.dataset.sort = mime;
        if (prevMime !== null && mime !== prevMime) {
            cell.classList.add('cell-changed');

            const i18nChangedFrom = window.clientI18n ? window.clientI18n['action.changed_from'] : 'Geändert von';
            cell.title = `${i18nChangedFrom}: ${prevMime} → ${mime}`;
            cell.textContent = mime;
        } else {
            cell.classList.remove('cell-changed');
            cell.removeAttribute('title');
            cell.textContent = mime;
        }
        prevMime = mime;
    });

    // Update categorical colors once MIME types are resolved
    applyCategoricalColors();
}

function encodePath(p) {
    if (!p) return '';
    return p.split('/').map(encodeURIComponent).join('/');
}

async function loadMimeTypes() {
    const table = document.getElementById('details');
    if (!table) return;

    const hasFiles = table.querySelector(
        '.browser-cell-type:not([data-is-folder="true"]):not([data-is-symlink="true"])',
    );
    if (!hasFiles) {
        applyCategoricalColors();
        return;
    }

    const rootName = table.dataset.root;
    const filePath = table.dataset.subpath;
    if (!rootName) return;

    try {
        let url = `/api/file-mimetypes/${encodeURIComponent(rootName)}`;
        if (filePath && filePath.trim()) {
            url += `/-/${encodePath(filePath)}`;
        }
        const res = await fetch(url);
        if (!res.ok) return;
        cachedMimeMap = await res.json();
        refreshMimeDiffs();
    } catch (err) {
        console.error('Failed to load MIME types:', err);
    }
}

class DetailTable {
    constructor(table) {
        this.table = table;
        this.tbody = table.querySelector('tbody');
        if (typeof TableColumnResizer !== 'undefined') {
            this.columnResizer = new TableColumnResizer(this.table);
        }
        this.initSorting();
        this.initKeyboard();
    }

    initSorting() {
        if (typeof TableSorter === 'undefined') return;
        this.sorter = new TableSorter(this.table, {
            tbody: this.tbody,
            treeSort: false,
            storageKey: this.table.id || 'details',
            initialSort: { colIndex: 0, direction: 'desc', triggerSort: false },
            onSort: () => {
                const rows = Array.from(this.tbody.querySelectorAll('tr'));
                rows.forEach((row, idx) => {
                    row.classList.toggle('even', idx % 2 === 0);
                    row.classList.toggle('odd', idx % 2 !== 0);
                });
                applyCategoricalColors();
            },
        });
    }

    initKeyboard() {
        if (typeof KeyboardNavigator === 'undefined') return;
        this.keyboard = new KeyboardNavigator(this.table, {
            tbody: this.tbody,
        });

        // TableSorter Column Sorting Interceptor (Alt+1..Alt+N)
        this.keyboard.addInterceptor((e) => this.sorter?.handleKeyDown(e));
    }

    get currentSort() {
        return this.sorter?.getSortState() || null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const table = document.getElementById('details');
    if (table) new DetailTable(table);
    applyCategoricalColors();
    loadMimeTypes();
});
