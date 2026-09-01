# Keyboard Navigation & Typeahead User Guide

**Universal Snapshot Explorer** provides a comprehensive, keyboard-first navigation system across all views (Explorer, Roots Dashboard, and DetailView).

---

### Key Shortcuts Overview

| Category | Shortcut | Description |
| :--- | :--- | :--- |
| **Row Navigation** | <kbd>↑</kbd> / <kbd>↓</kbd> | Move focus up/down one row |
| | <kbd>PageUp</kbd> / <kbd>PageDown</kbd> | Scroll focus by a dynamic viewport page |
| | <kbd>Home</kbd> / <kbd>End</kbd> | Jump to first / last visible row |
| **Typeahead Jump** | <kbd>a</kbd>..<kbd>z</kbd> / <kbd>0</kbd>..<kbd>9</kbd> | Type letters to instantly search and jump to files/folders |
| | <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> or <kbd>↓</kbd> / <kbd>↑</kbd> | Cycle through multiple typeahead search matches |
| | <kbd>Backspace</kbd> / <kbd>Esc</kbd> | Delete typed character / close Typeahead HUD |
| **Tree / Folder** | <kbd>→</kbd> (Arrow Right) | Expand folder or step into its first child row |
| | <kbd>←</kbd> (Arrow Left) | Collapse folder or jump up to parent row |
| | <kbd>Alt+↑</kbd> / <kbd>Backspace</kbd> | Navigate up to parent directory |
| | <kbd>Enter</kbd> | Open folder, follow symlink, or download file |
| **Selection** | <kbd>Space</kbd> | Toggle checkbox selection for the focused row |
| | <kbd>Shift+Space</kbd> | **Range Select:** Select/toggle all rows between anchor and current focus |
| | <kbd>Ctrl+A</kbd> | Select all currently visible rows |
| | <kbd>Esc</kbd> | Clear multi-selection (or deselect focused row) |
| **Timeline & View** | <kbd>Ctrl+←</kbd> / <kbd>Ctrl+→</kbd> | Switch to previous / next snapshot on the timeline |
| | <kbd>Ctrl+I</kbd> / <kbd>Alt+Enter</kbd> | Open file detail inspection view |
| | <kbd>Ctrl+L</kbd> | Focus breadcrumb path input for direct editing |
| | <kbd>/</kbd> | Focus the column filter search row |
| | <kbd>Alt+1</kbd> .. <kbd>Alt+8</kbd> | Sort table by column index 1 through 8 |
| | <kbd>?</kbd> / <kbd>F1</kbd> / <kbd>Shift+H</kbd> | Open interactive Keyboard Shortcuts help modal |

---

### Features in Detail

#### 1. Shift+Space Range Selection & Live Visual Preview
* Pressing <kbd>Space</kbd> toggles the checkbox of the currently focused row and sets it as the range anchor.
* Holding <kbd>Shift</kbd> and navigating with arrow keys activates a **Live Visual Preview** (`.range-preview`), highlighting all rows and checkboxes that would be toggled.
* Pressing <kbd>Shift+Space</kbd> synchronizes all rows in the range to the current state. Pressing it again inverts the entire range.

#### 2. Instant Typeahead HUD
* Start typing any filename or prefix (e.g. `doc` or `2024`). A floating HUD appears showing `Match X of Y`.
* Use <kbd>Tab</kbd> or <kbd>↓</kbd> to cycle between matches, or press <kbd>Enter</kbd> to immediately open the matched item.

#### 3. Alt-Key Column Sorting & Number Badges
* Holding down the <kbd>Alt</kbd> key temporarily displays small badge numbers (`1`, `2`, `3`, ...) on every sortable column header across Explorer and DetailView.
* Pressing <kbd>Alt+1</kbd> through <kbd>Alt+8</kbd> instantly sorts the table by that specific column. Releasing <kbd>Alt</kbd> smoothly hides the badges without causing layout shifts.

---

### Developer Usage

The keyboard engine is modular and reusable on any table:

```javascript
// 1. Initialize KeyboardNavigator
const keyboard = new KeyboardNavigator(tableElement, {
    tbody: tableElement.querySelector('tbody'),
    getRows: () => Array.from(tableElement.querySelectorAll('tbody tr:not([style*="display: none"])')),
    onFocusChange: (row) => console.log('Focused row:', row),
});

// 2. Attach TypeaheadHUD via the interceptor chain
const typeahead = new TypeaheadHUD(tableElement, {
    onSelect: (row) => keyboard.focusRow(row),
});
keyboard.addInterceptor((e) => typeahead.handleKeyDown(e));

// 3. Register custom key actions
keyboard.register('Space', (row) => toggleRowSelection(row));
keyboard.register('Shift+Space', (row) => toggleRangeSelection(row));
```
