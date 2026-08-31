document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.root-header-sticky-container');
    const table = document.getElementById('rootbrowser');
    if (header && table) {
        const updateStickyOffset = () => {
            table.style.setProperty('--index-top-height', `${header.offsetHeight}px`);
        };
        updateStickyOffset();
        window.addEventListener('resize', updateStickyOffset);

        if (typeof TableColumnResizer !== 'undefined') {
            window.rootTableResizer = new TableColumnResizer(table);
        }
    }

    const tbody = document.querySelector('#rootbrowser tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr[data-href]'));
    if (rows.length === 0) return;

    let selectedRow = null;

    function selectRow(row, updateHash = true) {
        rows.forEach(r => r.classList.remove('selected-row'));
        selectedRow = row;
        if (row) {
            row.classList.add('selected-row');
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            if (updateHash) {
                const rootLink = row.querySelector('a.root-link');
                const rootName = rootLink ? rootLink.textContent.trim() : '';
                if (rootName) {
                    history.replaceState(null, '', '#' + encodeURIComponent(rootName));
                }
            }
        }
    }

    function selectRowFromHash() {
        if (!window.location.hash) return;
        const targetName = decodeURIComponent(window.location.hash.substring(1).replace(/\+/g, ' '));
        if (!targetName) return;

        const targetRow = rows.find(r => {
            const rootLink = r.querySelector('a.root-link');
            const name = rootLink ? rootLink.textContent.trim() : '';
            const href = r.dataset.href || '';
            return name === targetName || href.includes(`/list/${encodeURIComponent(targetName)}`) || href.includes(`/list/${targetName}`);
        });

        if (targetRow) {
            selectRow(targetRow, false);
        }
    }

    // Click to select or navigate
    rows.forEach(row => {
        row.addEventListener('click', (e) => {
            if (!e.target.closest('a')) {
                selectRow(row);
            }
        });
    });

    selectRowFromHash();
    window.addEventListener('hashchange', selectRowFromHash);

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea') return;

        if (e.key === 'h' || e.key === '?' || (e.shiftKey && e.key === 'H')) {
            e.preventDefault();
            if (typeof toggleShortcutsModal === 'function') toggleShortcutsModal();
            return;
        }

        if (e.key === 'Escape') {
            const modal = document.getElementById('shortcuts-modal');
            if (modal && modal.style.display !== 'none') {
                if (typeof toggleShortcutsModal === 'function') toggleShortcutsModal(false);
                return;
            }
            selectRow(null);
            return;
        }

        const currentIndex = selectedRow ? rows.indexOf(selectedRow) : -1;

        if (e.key === 'ArrowDown' || e.key === 'j') {
            e.preventDefault();
            const next = currentIndex < rows.length - 1 ? currentIndex + 1 : 0;
            selectRow(rows[next]);
            return;
        }

        if (e.key === 'ArrowUp' || e.key === 'k') {
            e.preventDefault();
            const prev = currentIndex > 0 ? currentIndex - 1 : rows.length - 1;
            selectRow(rows[prev]);
            return;
        }

        if (e.key === 'Home') {
            e.preventDefault();
            selectRow(rows[0]);
            return;
        }

        if (e.key === 'End') {
            e.preventDefault();
            selectRow(rows[rows.length - 1]);
            return;
        }

        if (e.key === 'PageDown') {
            e.preventDefault();
            const pageSize = Math.max(1, Math.floor((window.innerHeight - 180) / 36));
            const baseIdx = currentIndex >= 0 ? currentIndex : 0;
            const next = Math.min(rows.length - 1, baseIdx + pageSize);
            selectRow(rows[next]);
            return;
        }

        if (e.key === 'PageUp') {
            e.preventDefault();
            const pageSize = Math.max(1, Math.floor((window.innerHeight - 180) / 36));
            const baseIdx = currentIndex >= 0 ? currentIndex : 0;
            const prev = Math.max(0, baseIdx - pageSize);
            selectRow(rows[prev]);
            return;
        }

        if (e.key === 'Enter') {
            if (selectedRow) {
                e.preventDefault();
                const link = selectedRow.querySelector('a.root-link');
                if (link) link.click();
            }
        }
    });
});