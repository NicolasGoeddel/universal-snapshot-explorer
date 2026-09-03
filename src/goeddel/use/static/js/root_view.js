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

    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    // Generic Keyboard Navigation
    const keyboard = new KeyboardNavigator(table, {
        tbody,
        getRows: () => Array.from(tbody.querySelectorAll('tr[data-href]')),
        onFocusChange: (row, options) => {
            if (row && options.updateHash !== false) {
                const rootLink = row.querySelector('a.root-link');
                const rootName = rootLink ? rootLink.textContent.trim() : '';
                if (rootName) {
                    history.replaceState(null, '', '#' + encodeURIComponent(rootName));
                }
            } else if (!row && options.updateHash !== false) {
                if (window.location.hash) {
                    history.replaceState(null, '', window.location.pathname + window.location.search);
                }
            }
        },
    });

    // Generic Typeahead HUD
    const typeahead = new TypeaheadHUD(table, {
        tbody,
        getRows: () => keyboard.getRows(),
        getSearchText: (row) => {
            const rootLink = row.querySelector('a.root-link');
            return (rootLink ? rootLink.textContent.trim() : '') || row.textContent.trim();
        },
        onSelect: (row) => keyboard.focusRow(row),
    });
    keyboard.addInterceptor((e) => typeahead.handleKeyDown(e));

    // Register Enter action on Root rows
    keyboard.register('Enter', (row) => {
        if (row) {
            const link = row.querySelector('a.root-link');
            if (link) link.click();
        }
    });

    // Vim-style j / k navigation support on roots dashboard
    keyboard.register('J', () => keyboard.stepFocus(1));
    keyboard.register('K', () => keyboard.stepFocus(-1));

    function selectRowFromHash() {
        if (!window.location.hash) return;
        const targetName = decodeURIComponent(window.location.hash.substring(1).replace(/\+/g, ' '));
        if (!targetName) return;

        const rows = keyboard.getRows();
        const targetRow = rows.find((r) => {
            const rootLink = r.querySelector('a.root-link');
            const name = rootLink ? rootLink.textContent.trim() : '';
            const href = r.dataset.href || '';
            return (
                name === targetName ||
                href.includes(`/list/${encodeURIComponent(targetName)}`) ||
                href.includes(`/list/${targetName}`)
            );
        });

        if (targetRow) {
            keyboard.focusRow(targetRow, { updateHash: false });
        }
    }

    selectRowFromHash();
    window.addEventListener('hashchange', selectRowFromHash);
});
