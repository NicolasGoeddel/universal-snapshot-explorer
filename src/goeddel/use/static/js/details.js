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
    // Sort chronologically (oldest snapshot to newest) to assign consistent color palettes
    const chronoRows = [...rows].sort((a, b) => {
        const idxA = parseInt(a.dataset.chronologicalIndex || '0', 10);
        const idxB = parseInt(b.dataset.chronologicalIndex || '0', 10);
        return idxA - idxB;
    });

    colSelectors.forEach((selector) => {
        // Clear previous categorical classes
        rows.forEach((tr) => {
            const cell = tr.querySelector(selector);
            if (cell) {
                cell.classList.remove('cat-val-1', 'cat-val-2', 'cat-val-3', 'cat-val-4', 'cat-val-5', 'cat-val-6');
            }
        });

        // Collect unique values in chronological order from existing entries
        const uniqueValues = [];
        chronoRows.forEach((tr) => {
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
            chronoRows.forEach((tr) => {
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
    const rootName = table.dataset.root;
    const filePath = table.dataset.subpath;
    if (!rootName || !filePath) return;

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
        this.currentSort = { colIndex: 0, direction: 'desc', type: 'number' };
        if (typeof TableColumnResizer !== 'undefined') {
            this.columnResizer = new TableColumnResizer(this.table);
        }
        this.initSorting();
    }

    initSorting() {
        const headers = this.table.querySelectorAll('thead tr th.sortable');
        headers.forEach((th) => {
            th.addEventListener('click', (e) => {
                if (e.target.closest('.col-resizer')) {
                    return;
                }
                if (this.columnResizer && this.columnResizer.justResized) {
                    return;
                }
                const cellIndex = Array.from(th.parentNode.children).indexOf(th);
                const sortType = th.dataset.sortType || 'text';
                let direction = th.dataset.defaultDir || 'asc';
                if (this.currentSort && this.currentSort.colIndex === cellIndex) {
                    direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
                }

                headers.forEach((h) => h.classList.remove('sort-asc', 'sort-desc'));
                th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');

                this.currentSort = { colIndex: cellIndex, direction, type: sortType };
                this.sortRows();
            });
        });
    }

    sortRows() {
        if (!this.currentSort) return;
        const { colIndex, direction, type } = this.currentSort;
        const rows = Array.from(this.tbody.querySelectorAll('tr'));

        rows.sort((a, b) => {
            const cellA = a.children[colIndex];
            const cellB = b.children[colIndex];
            if (!cellA || !cellB) return 0;

            const valA = cellA.dataset.sort !== undefined ? cellA.dataset.sort : cellA.textContent.trim();
            const valB = cellB.dataset.sort !== undefined ? cellB.dataset.sort : cellB.textContent.trim();

            let cmp = 0;
            if (type === 'number') {
                cmp = (parseFloat(valA) || 0) - (parseFloat(valB) || 0);
            } else if (type === 'date') {
                cmp = valA.localeCompare(valB);
            } else if (type === 'octal') {
                cmp = parseInt(valA, 8) - parseInt(valB, 8);
            } else {
                cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
            }

            return direction === 'asc' ? cmp : -cmp;
        });

        rows.forEach((row, idx) => {
            row.classList.toggle('even', idx % 2 === 0);
            row.classList.toggle('odd', idx % 2 !== 0);
            this.tbody.appendChild(row);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.clientI18nStr) {
        try {
            window.clientI18n = JSON.parse(window.clientI18nStr);
        } catch (e) {}
    }
    const table = document.getElementById('details');
    if (table) new DetailTable(table);
    applyCategoricalColors();
    loadMimeTypes();
});
