/**
 * TreeTable Component
 *
 * Standalone hierarchical table manager that maintains a high-performance
 * tree index (Map<string, HTMLTableRowElement> path lookup, row._parent,
 * and row._children = Set<HTMLTableRowElement>).
 *
 * Provides O(1) parent/child queries, O(depth) ancestor traversals,
 * and O(subtree) descendant operations without scanning the full table DOM.
 */
class TreeTable {
    /**
     * @param {HTMLTableElement} table - Target table DOM element.
     * @param {Object} [options={}] - Configuration options.
     * @param {string} [options.subpath=''] - Base subpath of the directory.
     * @param {Function} [options.onExpand=null] - Optional callback when folder expands: (row, path).
     * @param {Function} [options.onCollapse=null] - Optional callback when folder collapses: (row, path).
     */
    constructor(table, options = {}) {
        this.table = table;
        this.tbody = table.querySelector('tbody');
        this.options = options;
        this.subpath = options.subpath || table.dataset.subpath || '';

        /** @type {Map<string, HTMLTableRowElement>} */
        this.rowMap = new Map();

        this.init();
    }

    /**
     * Build the initial tree index from rows currently in the tbody.
     */
    init() {
        if (!this.tbody) return;
        const rows = Array.from(this.tbody.querySelectorAll('tr'));
        this.indexRows(rows);
    }

    /**
     * Index an array or Set of rows into the tree hierarchy.
     *
     * @param {HTMLTableRowElement[]|Set<HTMLTableRowElement>} rows - Rows to index.
     * @param {HTMLTableRowElement|null} [explicitParent=null] - Known parent row if inserted via AJAX.
     */
    indexRows(rows, explicitParent = null) {
        if (!rows) return;

        const rowList = Array.isArray(rows) ? rows : Array.from(rows);

        // Pass 1: Initialize row data structures and register all paths in rowMap
        rowList.forEach((row) => {
            if (!(row instanceof HTMLTableRowElement)) return;

            if (!row._children) {
                row._children = new Set();
            }
            if (row._parent === undefined) {
                row._parent = null;
            }

            const path = row.dataset.path || row.dataset.filename;
            if (path) {
                this.rowMap.set(path, row);
            }

            if (explicitParent) {
                row._parent = explicitParent;
                explicitParent._children.add(row);
            }
        });

        // Pass 2: If no explicitParent, resolve parent relationships now that ALL rows are indexed in rowMap
        if (!explicitParent) {
            rowList.forEach((row) => {
                if (!(row instanceof HTMLTableRowElement)) return;
                const parentPath = row.dataset.parent;
                if (parentPath && parentPath !== this.subpath) {
                    const parentRow = this.rowMap.get(parentPath);
                    if (parentRow) {
                        row._parent = parentRow;
                        if (!parentRow._children) parentRow._children = new Set();
                        parentRow._children.add(row);
                    }
                }
            });
        }
    }

    /**
     * Retrieve all indexed rows in the table in O(1).
     *
     * @returns {HTMLTableRowElement[]}
     */
    getAllRows() {
        return Array.from(this.rowMap.values());
    }

    /**
     * Unregister a row and remove it from the tree index and its parent's children set.
     *
     * @param {HTMLTableRowElement} row - Row to unregister.
     */
    unregisterRow(row) {
        if (!row) return;
        const path = row.dataset.path || row.dataset.filename;
        if (path) {
            this.rowMap.delete(path);
        }
        if (row._parent && row._parent._children) {
            row._parent._children.delete(row);
        }
        if (row._children) {
            row._children.forEach((child) => this.unregisterRow(child));
            row._children.clear();
        }
    }

    /**
     * Retrieve a row by its path or filename.
     *
     * @param {string} path - Target path.
     * @returns {HTMLTableRowElement|undefined}
     */
    getRowByPath(path) {
        return this.rowMap.get(path);
    }

    /**
     * Get the direct parent row of a given row in O(1).
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @returns {HTMLTableRowElement|null}
     */
    getParent(row) {
        if (!row) return null;
        if (row._parent !== undefined) return row._parent;
        const parentPath = row.dataset.parent;
        return parentPath ? this.rowMap.get(parentPath) || null : null;
    }

    /**
     * Get the direct children of a row in O(1).
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @returns {Set<HTMLTableRowElement>}
     */
    getChildren(row) {
        if (!row) return new Set();
        if (!row._children) row._children = new Set();
        return row._children;
    }

    /**
     * Retrieve direct children for a given parent path (or root if parentPath matches table subpath).
     *
     * @param {string} parentPath - Parent path or empty string for root.
     * @returns {HTMLTableRowElement[]}
     */
    getChildrenOfPath(parentPath) {
        if (!parentPath || parentPath === this.subpath) {
            return this.getAllRows().filter((r) => r._parent === null);
        }
        const parentRow = this.getRowByPath(parentPath);
        return parentRow ? Array.from(this.getChildren(parentRow)) : [];
    }

    /**
     * Get all descendants of a row in O(subtree) using BFS.
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @returns {Set<HTMLTableRowElement>} All loaded descendant rows.
     */
    getDescendants(row) {
        const descendants = new Set();
        if (!row || !row._children || row._children.size === 0) return descendants;

        const queue = Array.from(row._children);
        while (queue.length > 0) {
            const curr = queue.shift();
            if (!descendants.has(curr)) {
                descendants.add(curr);
                if (curr._children && curr._children.size > 0) {
                    queue.push(...curr._children);
                }
            }
        }
        return descendants;
    }

    /**
     * Get all ancestor rows of a given row up to the tree root in O(depth).
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @returns {HTMLTableRowElement[]}
     */
    getAncestors(row) {
        const ancestors = [];
        let curr = this.getParent(row);
        while (curr) {
            ancestors.push(curr);
            curr = this.getParent(curr);
        }
        return ancestors;
    }

    /**
     * Check if a row's entire ancestor chain in the tree is currently expanded.
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @returns {boolean} True if all ancestor folders are expanded.
     */
    isRowInExpandedHierarchy(row) {
        let curr = this.getParent(row);
        while (curr) {
            if (curr.dataset.expanded !== 'true') {
                return false;
            }
            curr = this.getParent(curr);
        }
        return true;
    }

    /**
     * Retrieve all currently visible rows in the table (expanded hierarchy,
     * not hidden by column filter or toggle switches).
     *
     * @returns {HTMLTableRowElement[]}
     */
    getVisibleRows() {
        if (!this.tbody) return [];
        const result = [];
        const rows = this.tbody.rows;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (r.classList.contains('filter-hidden')) continue;
            if (r.style.display === 'none') continue;
            if (this.isRowInExpandedHierarchy(r)) {
                result.push(r);
            }
        }
        return result;
    }

    /**
     * Collapse a folder row and hide all its descendants.
     *
     * @param {HTMLTableRowElement} row - Target folder row.
     */
    collapseFolder(row) {
        if (!row || row.dataset.isFolder !== 'true') return;
        row.dataset.expanded = 'false';

        const toggleBtn = row.querySelector('.folder-toggle');
        if (toggleBtn) toggleBtn.classList.remove('opened');

        const descendants = this.getDescendants(row);
        descendants.forEach((desc) => {
            desc.style.display = 'none';
        });

        if (typeof this.options.onCollapse === 'function') {
            this.options.onCollapse(row, row.dataset.path || row.dataset.filename);
        }
    }

    /**
     * Expand a folder row and restore visibility for its direct children
     * (and nested children whose parent folders are also expanded).
     *
     * @param {HTMLTableRowElement} row - Target folder row.
     */
    expandFolder(row) {
        if (!row || row.dataset.isFolder !== 'true') return;
        row.dataset.expanded = 'true';

        const toggleBtn = row.querySelector('.folder-toggle');
        if (toggleBtn) toggleBtn.classList.add('opened');

        // Re-show descendants whose immediate parent hierarchy is expanded
        const descendants = this.getDescendants(row);
        descendants.forEach((desc) => {
            if (this.isRowInExpandedHierarchy(desc)) {
                desc.style.display = '';
            }
        });

        if (typeof this.options.onExpand === 'function') {
            this.options.onExpand(row, row.dataset.path || row.dataset.filename);
        }
    }

    /**
     * Toggle a folder row between expanded and collapsed states.
     *
     * @param {HTMLTableRowElement} row - Target folder row.
     * @returns {boolean} New expanded state (true if expanded, false if collapsed).
     */
    toggleFolder(row) {
        if (!row || row.dataset.isFolder !== 'true') return false;
        const isExpanded = row.dataset.expanded === 'true';
        if (isExpanded) {
            this.collapseFolder(row);
            return false;
        } else {
            this.expandFolder(row);
            return true;
        }
    }
}

if (typeof window !== 'undefined') {
    window.TreeTable = TreeTable;
}
