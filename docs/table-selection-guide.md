# Multi-Selection & ZIP Batch Export User Guide

**Universal Snapshot Explorer** provides a comprehensive, tree-hierarchy-aware multi-selection and on-the-fly ZIP batch download system.

---

### Key Features & Hotkeys

| Action | Shortcut / Trigger | Description |
| :--- | :--- | :--- |
| **Toggle Row Checkbox** | <kbd>Space</kbd> / Click Checkbox | Selects or deselects the focused / clicked item |
| **Keyboard Range Select** | <kbd>Shift+Space</kbd> | Toggles all rows between the anchor and the current cursor |
| **Mouse Range Select** | <kbd>Shift+Click</kbd> | Toggles all rows between the last clicked item and clicked row |
| **Live Range Preview** | Hold <kbd>Shift</kbd> | Visually highlights the pending selection range (`.range-preview`) |
| **Select All Visible** | <kbd>Ctrl+A</kbd> / Master Checkbox | Selects all currently visible rows in the table |
| **Clear Selection** | <kbd>Esc</kbd> / Clear Button | Clears the current selection and hides the floating action bar |
| **Download ZIP** | Click "Download ZIP" in HUD | Initiates on-the-fly streaming ZIP archive generation |

---

### Features in Detail

#### 1. Hierarchical Tri-State Tree Checkboxes
* **Selecting a Folder:** Automatically marks all loaded and newly expanded descendant files as selected.
* **Partial Selection Indicator (`indeterminate`):** When only some child items inside a directory are selected, the parent folder checkbox displays a visual dash (<kbd>−</kbd>). This allows you to immediately see that items are selected inside a folder, even when it is collapsed!
* **Dynamic AJAX Synchronization:** When expanding a previously unvisited folder whose ancestor is selected, all newly fetched child items automatically inherit the selected state.

#### 2. Floating Action Bar HUD & Smart Breakdown
* **Hierarchical Item Counting:** A fully selected folder that is collapsed counts cleanly as **1 selected item** (the folder entity) with 0 hidden files in the breakdown, preventing confusing counter jumps when collapsing folders.
* **Smart Reveal Link:** If items are hidden (either due to active column filters, toolbar toggles, or inside partially selected collapsed folders), the breakdown displays a clickable button: `(X sichtbar, Y ausgeblendet)`. Clicking it unhides the filtered rows and expands the relevant folders (without needlessly expanding fully selected folders).
* **Archive Structure Options:**
  * **Relative to current folder** (Default)
  * **Full path from root**
  * **Flat** (all files in archive root)

---

### Developer Usage & Action Registry

The `SelectionManager` is fully decoupled from specific export formats:

```javascript
const selectionManager = new SelectionManager(tableElement, {
    tbody: tableElement.querySelector('tbody'),
    getVisibleRows: () => filterManager.getVisibleRows(),
    rootName: 'tank',
    getSnapshot: () => currentSnapshotId,
    getFocusedRow: () => keyboardNavigator.focusedRow,
    onSelectionChange: (selectedPaths, count) => {
        console.log(`Selected: ${count} items`);
    },
});

// Register batch actions with options and i18n support
selectionManager.registerAction({
    id: 'zip',
    labelKey: 'selection.download_zip',
    label: 'Download ZIP',
    icon: 'archive',
    isDefault: true,
    optionsLabelKey: 'selection.structure',
    optionsLabel: 'Folder structure',
    options: [
        { id: 'relative', labelKey: 'selection.structure_relative', label: 'Relative (Default)', default: true },
        { id: 'absolute', labelKey: 'selection.structure_absolute', label: 'Full path from root' },
        { id: 'flat', labelKey: 'selection.structure_flat', label: 'Flat' },
    ],
    execute: (selectedPaths, ctx) => {
        // ctx.option contains 'relative', 'absolute', or 'flat'
    },
});

// Interceptor integration
keyboard.addInterceptor((e) => selectionManager.handleKeyDown(e, keyboard.focusedRow));
```
