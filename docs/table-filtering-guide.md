# Table Filtering & Toggle Switches User Guide

**Universal Snapshot Explorer** includes a high-performance, tree-hierarchy-aware table filtering system.

---

### Key Features & Hotkeys

| Action | Shortcut / Trigger | Description |
| :--- | :--- | :--- |
| **Focus Filter Input** | <kbd>/</kbd> | Instantly jumps focus into the Name column filter input |
| **Exit Filter Input** | <kbd>Esc</kbd> | Blurs the active filter input and returns focus to the table |
| **Cycle Inputs** | <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> | Cyclically navigates forward and backward between column filter inputs |
| **Jump to First Match** | <kbd>↓</kbd> (Arrow Down) / <kbd>Enter</kbd> | Immediately focuses the first visible matching item in the table |
| **Sort from Filter** | <kbd>Ctrl+↑</kbd> / <kbd>Ctrl+↓</kbd> / <kbd>Shift+Enter</kbd> | Sorts the focused column ascending, descending, or toggles sort |
| **Toolbar Toggles** | Click Toggle Switches | Toggles visibility of hidden files, missing snapshot files, or unchanged files |

---

### Features in Detail

#### 1. Smart Tree-Hierarchy Propagation
* When you filter by filename or attribute, matching child items automatically keep their parent directory hierarchy visible so you never lose folder context.
* When a filter hides the currently focused row, focus is automatically sanitized to the first visible matching row to prevent accidental actions on hidden files.

#### 2. Toolbar Badges & Hierarchy-Aware Counters
* Badge counters (`#badge-hidden-count`, `#badge-missing-count`, `#badge-changed-count`) accurately reflect items within the currently expanded folder hierarchy.
* Toggle states are automatically persisted per browser session in `localStorage`.

---

### Developer Usage

The `FilterManager` is modular and standalone:

```javascript
const filterManager = new FilterManager(tableElement, {
    tbody: tableElement.querySelector('tbody'),
    onFilterChange: ({ activeFilters, visibleRows, matchMap }) => {
        console.log(`Active filters: ${activeFilters.length}, Visible rows: ${visibleRows.length}`);
    },
    onSelectRow: (row) => keyboard.focusRow(row),
    onSortColumn: (colIndex, dir) => sorter.sortByColumnIndex(colIndex, dir),
    collapseDescendants: (path) => treeTable.collapseDescendants(path),
});

// Attach to KeyboardNavigator interceptor pipeline
keyboard.addInterceptor((e) => filterManager.handleKeyDown(e));
```
