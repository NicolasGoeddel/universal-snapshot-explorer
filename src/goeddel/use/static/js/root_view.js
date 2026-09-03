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

    // TreeTable Component Initialization
    const treeTable = typeof TreeTable !== 'undefined' ? new TreeTable(table) : null;

    // Generic Keyboard Navigation
    const keyboard = new KeyboardNavigator(table, {
        tbody,
        getRows: () => Array.from(tbody.querySelectorAll('tr:not([style*="display: none"])')),
        onFocusChange: (row, options) => {
            if (row && options.updateHash !== false) {
                const rootLink = row.querySelector('a.root-link');
                const rootName = rootLink ? rootLink.getAttribute('title') || rootLink.textContent.trim() : '';
                if (rootName) {
                    history.replaceState(null, '', `#${encodeURIComponent(rootName)}`);
                }
            } else if (!row && options.updateHash !== false) {
                if (window.location.hash) {
                    history.replaceState(null, '', window.location.pathname + window.location.search);
                }
            }
        },
    });

    if (treeTable) {
        treeTable.options.onExpand = () => keyboard.sanitizeFocus();
        treeTable.options.onCollapse = () => keyboard.sanitizeFocus();
    }

    // Generic Typeahead HUD
    const typeahead = new TypeaheadHUD(table, {
        tbody,
        getRows: () => keyboard.getRows(),
        getSearchText: (row) => {
            const groupTitle = row.querySelector('.group-title');
            if (groupTitle) return groupTitle.textContent.trim();
            const rootLink = row.querySelector('a.root-link');
            if (!rootLink) return row.textContent.trim();
            const title = rootLink.getAttribute('title') || '';
            const text = rootLink.textContent.trim();
            return text !== title ? `${text} ${title}` : text;
        },
        onSelect: (row) => keyboard.focusRow(row),
    });
    keyboard.addInterceptor((e) => typeahead.handleKeyDown(e));

    // Toggle folder/group on click
    table.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.folder-toggle');
        if (toggleBtn && treeTable) {
            e.stopPropagation();
            const row = toggleBtn.closest('tr');
            if (row) {
                treeTable.toggleFolder(row);
                keyboard.sanitizeFocus();
            }
            return;
        }

        const groupRow = e.target.closest('tr.root-group-row');
        if (groupRow && treeTable) {
            treeTable.toggleFolder(groupRow);
            keyboard.sanitizeFocus();
        }
    });

    // Register Enter action on Root rows
    keyboard.register('Enter', (row) => {
        if (!row) return;
        if (row.classList.contains('root-group-row') || (row.dataset.isFolder === 'true' && !row.dataset.href)) {
            if (treeTable) {
                treeTable.toggleFolder(row);
                keyboard.sanitizeFocus();
            }
            return;
        }
        const link = row.querySelector('a.root-link');
        if (link) link.click();
    });

    // ArrowRight: Expand folder/group or step into first child
    keyboard.register('ArrowRight', (row) => {
        if (!row || !treeTable) return;
        const isFolder = row.dataset.isFolder === 'true';
        const isExpanded = row.dataset.expanded === 'true';
        if (isFolder) {
            if (!isExpanded) {
                treeTable.expandFolder(row);
                keyboard.sanitizeFocus();
            } else {
                const children = Array.from(treeTable.getChildren(row)).filter((r) => r.style.display !== 'none');
                if (children.length > 0) {
                    keyboard.focusRow(children[0]);
                }
            }
        }
    });

    // ArrowLeft: Collapse folder/group or jump to parent
    keyboard.register('ArrowLeft', (row) => {
        if (!row || !treeTable) return;
        const isFolder = row.dataset.isFolder === 'true';
        const isExpanded = row.dataset.expanded === 'true';
        if (isFolder && isExpanded) {
            treeTable.collapseFolder(row);
            keyboard.sanitizeFocus();
        } else if (row._parent && row._parent instanceof HTMLTableRowElement) {
            keyboard.focusRow(row._parent);
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
            const name = rootLink ? rootLink.getAttribute('title') || rootLink.textContent.trim() : '';
            const href = r.dataset.href || '';
            const path = r.dataset.path || '';
            return (
                name === targetName ||
                path === targetName ||
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
