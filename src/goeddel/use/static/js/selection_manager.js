/**
 * Universal Snapshot Explorer (USE) - SelectionManager
 *
 * Encapsulates all multi-selection and batch export operations:
 *  1. Checkbox multi-selection with persistent Set of selected paths.
 *  2. Hierarchical Tri-State Folder Checkboxes (checked / indeterminate / unchecked) across tree levels.
 *  3. Dynamic row synchronization on AJAX folder expansion.
 *  4. Range selection (<kbd>Shift+Click</kbd> & <kbd>Shift+Space</kbd>) with persistent anchor.
 *  5. Real-time visual range preview highlighting (`.range-preview`) on cursor movement and mouse hover.
 *  6. Hierarchical item counting: Fully selected collapsed folders count as 1 item (no false hidden breakdown).
 *  7. Smart reveal: Clickable breakdown button to reveal hidden selected files without expanding fully selected folders.
 *  8. Pluggable Action Registry: Decoupled action handlers (ZIP, tar.gz, restore, etc.) with i18n support.
 *  9. Keyboard interceptor integration (<kbd>Space</kbd>, <kbd>Shift+Space</kbd>, <kbd>Ctrl+A</kbd>, <kbd>Esc</kbd>).
 */

class SelectionManager {
    /**
     * Initialize the SelectionManager on a target table.
     *
     * @param {HTMLTableElement|string} table - Table DOM element or element ID string.
     * @param {Object} [options={}] - Configuration options.
     * @param {HTMLElement} [options.tbody] - Custom <tbody> element (defaults to table.querySelector('tbody')).
     * @param {function(): Array<HTMLTableRowElement>} [options.getVisibleRows] - Function returning list of visible rows.
     * @param {function(Set<string>, number): void} [options.onSelectionChange] - Callback when selection changes.
     * @param {string} [options.rootName=''] - Root filesystem identifier.
     * @param {function(): string} [options.getSnapshot] - Function returning active snapshot ID.
     * @param {function(): HTMLTableRowElement|null} [options.getFocusedRow] - Function returning currently focused row.
     */
    constructor(table, options = {}) {
        this.table = typeof table === 'string' ? document.getElementById(table) : table;
        if (!this.table) {
            console.error('[SelectionManager] Initialization failed: No table element provided.', table);
            return;
        }
        this.tbody = options.tbody || this.table.querySelector('tbody');
        if (!this.tbody) {
            console.error('[SelectionManager] Initialization failed: Table has no <tbody> element.', this.table);
            return;
        }

        this.getVisibleRows =
            options.getVisibleRows ||
            (() => {
                return Array.from(this.tbody.querySelectorAll('tr')).filter((row) => {
                    return (
                        !row.classList.contains('filter-hidden') &&
                        row.style.display !== 'none' &&
                        row.offsetParent !== null
                    );
                });
            });

        this.onSelectionChange = options.onSelectionChange || null;
        this.rootName = options.rootName || this.table.dataset.root || '';
        this.getSnapshot = options.getSnapshot || (() => this.table.dataset.snapshot || '');
        this.getFocusedRow = options.getFocusedRow || (() => null);

        this.selectedPaths = new Set();
        this.lastClickedCheckbox = null;
        this.isShiftDown = false;
        this.actions = new Map();
        this.currentActionId = null;

        this.init();
    }

    /**
     * Register a batch action handler (e.g. ZIP download, tarball export, restore).
     *
     * @param {Object} action - Action configuration.
     * @param {string} action.id - Unique identifier for the action (e.g. 'zip').
     * @param {string} [action.label] - Fallback display label.
     * @param {string} [action.labelKey] - i18n translation key.
     * @param {string} [action.icon] - Lucide icon name.
     * @param {boolean} [action.isDefault=false] - Whether this is the default action.
     * @param {string} [action.optionsLabel] - Label for sub-options dropdown.
     * @param {string} [action.optionsLabelKey] - i18n translation key for sub-options label.
     * @param {Array<{id: string, label: string, labelKey?: string, default?: boolean}>} [action.options] - List of configurable options.
     * @param {function(Set<string>, Object): void} action.execute - Callback executed with selected paths.
     */
    registerAction(action) {
        if (!action || !action.id || typeof action.execute !== 'function') {
            console.error('[SelectionManager] Invalid action registration:', action);
            return;
        }
        this.actions.set(action.id, action);
        if (action.isDefault || !this.currentActionId) {
            this.currentActionId = action.id;
        }
        this.renderActionsUI();
    }

    /**
     * Execute a registered action by ID (or the currently selected action).
     *
     * @param {string} [actionId=null] - ID of registered action.
     */
    executeAction(actionId = null) {
        const actId = actionId || this.currentActionId;
        const action = this.actions.get(actId);
        if (!action) {
            console.warn(`[SelectionManager] Action "${actId}" not found.`);
            return;
        }
        const optionSelect = document.getElementById('selection-option-select');
        const selectedOption = optionSelect ? optionSelect.value : null;

        action.execute(this.selectedPaths, {
            option: selectedOption,
            table: this.table,
            rootName: this.rootName,
            snapshot: typeof this.getSnapshot === 'function' ? this.getSnapshot() : '',
            subpath: this.table.dataset.subpath || '',
        });
    }

    /**
     * Dynamically update action selector and sub-options dropdown based on registered actions.
     */
    renderActionsUI() {
        if (this.actions.size === 0) return;
        const i18n = window.clientI18n || {};

        if (!this.currentActionId || !this.actions.has(this.currentActionId)) {
            const defaultAction =
                Array.from(this.actions.values()).find((a) => a.isDefault) || Array.from(this.actions.values())[0];
            this.currentActionId = defaultAction?.id || null;
        }

        const currentAction = this.actions.get(this.currentActionId);
        if (!currentAction) return;

        // 1. Action Dropdown (visible only when multiple actions exist)
        const actionWrapper = document.getElementById('action-select-wrapper');
        const actionSelect = document.getElementById('selection-action-select');
        if (actionWrapper && actionSelect) {
            if (this.actions.size > 1) {
                actionWrapper.style.display = 'inline-flex';
                actionSelect.innerHTML = '';
                this.actions.forEach((act) => {
                    const opt = document.createElement('option');
                    opt.value = act.id;
                    opt.textContent = act.labelKey ? i18n[act.labelKey] || act.label : act.label;
                    if (act.id === this.currentActionId) opt.selected = true;
                    actionSelect.appendChild(opt);
                });
            } else {
                actionWrapper.style.display = 'none';
            }
        }

        // 2. Action Sub-Options Dropdown
        const optionsWrapper = document.getElementById('action-options-wrapper');
        const optionLabel = document.getElementById('action-option-label');
        const optionSelect = document.getElementById('selection-option-select');

        if (optionsWrapper && optionSelect) {
            if (currentAction.options && currentAction.options.length > 0) {
                optionsWrapper.style.display = 'inline-flex';

                if (optionLabel) {
                    const labelText = currentAction.optionsLabelKey
                        ? i18n[currentAction.optionsLabelKey] || currentAction.optionsLabel
                        : currentAction.optionsLabel;
                    optionLabel.textContent = labelText ? `${labelText}:` : '';
                }

                const prevVal = optionSelect.value;
                optionSelect.innerHTML = '';
                currentAction.options.forEach((opt) => {
                    const optElem = document.createElement('option');
                    optElem.value = opt.id;
                    optElem.textContent = opt.labelKey ? i18n[opt.labelKey] || opt.label : opt.label;
                    if (prevVal === opt.id || (!prevVal && opt.default)) {
                        optElem.selected = true;
                    }
                    optionSelect.appendChild(optElem);
                });
            } else {
                optionsWrapper.style.display = 'none';
                optionSelect.innerHTML = '';
            }
        }

        // 3. Primary Button Label
        const btnExecute = document.getElementById('btn-execute-action') || document.getElementById('btn-download-zip');
        const btnLabel = document.getElementById('btn-execute-label') || btnExecute?.querySelector('span');
        if (btnLabel) {
            const labelText = currentAction.labelKey
                ? i18n[currentAction.labelKey] || currentAction.label
                : currentAction.label;
            btnLabel.textContent = labelText;
        }
    }

    /**
     * Helper to select or deselect a row and all its loaded descendant rows.
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @param {boolean} select - Whether to select (true) or deselect (false).
     * @param {HTMLTableRowElement[]} [allRows=null] - Optional pre-queried list of rows for performance.
     */
    setRowSelected(row, select, allRows = null) {
        if (!row) return;
        const path = row.dataset.path || row.dataset.filename;
        if (!path) return;

        if (select) {
            this.selectedPaths.add(path);
        } else {
            this.selectedPaths.delete(path);
        }

        if (row.dataset.isFolder === 'true' && path) {
            const prefix = path + '/';
            const rows = allRows || Array.from(this.tbody.querySelectorAll('tr'));
            rows.forEach((desc) => {
                const dp = desc.dataset.path || '';
                if (dp.startsWith(prefix)) {
                    if (select) {
                        this.selectedPaths.add(dp);
                    } else {
                        this.selectedPaths.delete(dp);
                    }
                }
            });
        }
    }

    /**
     * Bind listeners for checkboxes, action bar, master checkbox, and Shift key preview.
     */
    init() {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));

        // Synchronize initial state from any pre-checked checkboxes (e.g. across F5 page reload)
        this.tbody.querySelectorAll('input.row-checkbox:checked').forEach((cb) => {
            const row = cb.closest('tr');
            if (row) {
                this.setRowSelected(row, true, allRows);
            }
        });
        if (this.selectedPaths.size > 0) {
            this.updateUI();
        }

        // Prevent browser native text selection during Shift+Click range selection
        this.tbody.addEventListener('mousedown', (e) => {
            if (e.shiftKey) {
                e.preventDefault();
            }
        });

        const masterCheckbox = document.getElementById('master-select-checkbox');
        if (masterCheckbox) {
            masterCheckbox.addEventListener('click', () => {
                const visibleRows = this.getVisibleRows();
                const allVisibleChecked =
                    visibleRows.length > 0 &&
                    visibleRows.every((r) => {
                        const cb = r.querySelector('input.row-checkbox');
                        return cb && cb.checked && !cb.indeterminate;
                    });

                const rows = Array.from(this.tbody.querySelectorAll('tr'));
                visibleRows.forEach((r) => this.setRowSelected(r, !allVisibleChecked, rows));
                this.updateUI();
            });
        }

        // Table event delegation for checkbox clicks & Shift+Click range selection
        this.tbody.addEventListener('click', (e) => {
            const checkbox = e.target.closest('input.row-checkbox');
            if (!checkbox) return;

            const row = checkbox.closest('tr');
            if (!row) return;

            const isChecked = checkbox.checked;

            if (e.shiftKey && this.lastClickedCheckbox && this.lastClickedCheckbox !== checkbox) {
                const visibleRows = this.getVisibleRows();
                const lastRow = this.lastClickedCheckbox.closest('tr');
                const lastIdx = visibleRows.indexOf(lastRow);
                const currentIdx = visibleRows.indexOf(row);

                if (lastIdx >= 0 && currentIdx >= 0) {
                    const start = Math.min(lastIdx, currentIdx);
                    const end = Math.max(lastIdx, currentIdx);
                    const rows = Array.from(this.tbody.querySelectorAll('tr'));
                    for (let i = start; i <= end; i++) {
                        this.setRowSelected(visibleRows[i], isChecked, rows);
                    }
                }
            } else {
                this.setRowSelected(row, isChecked);
            }

            this.lastClickedCheckbox = checkbox;
            this.updateUI();
        });

        // Mouse hover with Shift key held updates visual range preview
        this.tbody.addEventListener('mouseover', (e) => {
            if (!this.isShiftDown || !this.lastClickedCheckbox) return;
            const row = e.target.closest('tr');
            if (row) {
                this.updateRangePreview(true, row);
            }
        });

        // Action bar button bindings
        const btnClear = document.getElementById('btn-clear-selection');
        if (btnClear) {
            btnClear.addEventListener('click', () => this.clearSelection());
        }

        // Action selector change listener
        const actionSelect = document.getElementById('selection-action-select');
        if (actionSelect) {
            actionSelect.addEventListener('change', () => {
                this.currentActionId = actionSelect.value;
                this.renderActionsUI();
            });
        }

        // Action execute button
        const btnExecute = document.getElementById('btn-execute-action') || document.getElementById('btn-download-zip');
        if (btnExecute) {
            btnExecute.addEventListener('click', () => {
                this.executeAction();
            });
        }

        // Shift key listener for live visual range preview
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') {
                this.isShiftDown = true;
                this.updateRangePreview(true);
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') {
                this.isShiftDown = false;
                this.updateRangePreview(false);
            }
        });
        window.addEventListener('blur', () => {
            this.isShiftDown = false;
            this.updateRangePreview(false);
        });
    }

    /**
     * Update the visual range selection preview on table rows.
     *
     * @param {boolean} active - Whether the Shift key is actively held.
     * @param {HTMLTableRowElement|null} [targetRow=null] - Specific target row (or currently focused row).
     */
    updateRangePreview(active, targetRow = null) {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        allRows.forEach((r) => r.classList.remove('range-preview'));
        if (!active || !this.lastClickedCheckbox) return;

        const focusedRow = targetRow || this.getFocusedRow();
        if (!focusedRow) return;

        const visibleRows = this.getVisibleRows();
        const lastRow = this.lastClickedCheckbox.closest('tr');
        const lastIdx = visibleRows.indexOf(lastRow);
        const currentIdx = visibleRows.indexOf(focusedRow);

        if (lastIdx >= 0 && currentIdx >= 0 && lastIdx !== currentIdx) {
            const start = Math.min(lastIdx, currentIdx);
            const end = Math.max(lastIdx, currentIdx);
            for (let i = start; i <= end; i++) {
                visibleRows[i].classList.add('range-preview');
            }
        }
    }

    /**
     * Toggle selection state for a specific row, with optional range selection mode.
     *
     * @param {HTMLTableRowElement} row - Target table row.
     * @param {Object} [options={}] - Options object.
     * @param {boolean} [options.range=false] - Whether to perform range selection.
     */
    toggleRow(row, options = {}) {
        if (!row) return;
        const rowPath = row.dataset.path || row.dataset.filename;
        const cb = row.querySelector('input.row-checkbox');

        if (options.range && this.lastClickedCheckbox) {
            const visibleRows = this.getVisibleRows();
            const lastRow = this.lastClickedCheckbox.closest('tr');
            const lastIdx = visibleRows.indexOf(lastRow);
            const currentIdx = visibleRows.indexOf(row);

            if (lastIdx >= 0 && currentIdx >= 0) {
                const start = Math.min(lastIdx, currentIdx);
                const end = Math.max(lastIdx, currentIdx);
                const shouldSelect = !this.selectedPaths.has(rowPath);
                const allRows = Array.from(this.tbody.querySelectorAll('tr'));
                for (let i = start; i <= end; i++) {
                    this.setRowSelected(visibleRows[i], shouldSelect, allRows);
                }
            }
        } else {
            const willSelect = !this.selectedPaths.has(rowPath);
            this.setRowSelected(row, willSelect);
            if (cb) this.lastClickedCheckbox = cb;
        }

        this.updateUI();
    }

    /**
     * Synchronize newly added AJAX child rows with parent selection state.
     *
     * @param {HTMLTableRowElement[]} newRows - Newly inserted table rows.
     */
    onRowsAdded(newRows) {
        if (!newRows || newRows.length === 0) return;

        newRows.forEach((row) => {
            const rowPath = row.dataset.path || '';
            // If any ancestor path is selected, auto-select this child row
            let isParentSelected = false;
            for (const selPath of this.selectedPaths) {
                if (rowPath.startsWith(selPath + '/')) {
                    isParentSelected = true;
                    break;
                }
            }
            if (isParentSelected) {
                this.selectedPaths.add(rowPath);
            }
        });

        this.updateUI();
    }

    /**
     * Select all currently visible rows in the table.
     */
    selectAllVisible() {
        const visibleRows = this.getVisibleRows();
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        visibleRows.forEach((r) => this.setRowSelected(r, true, allRows));
        this.updateUI();
    }

    /**
     * Clear all selected items.
     */
    clearSelection() {
        this.selectedPaths.clear();
        this.lastClickedCheckbox = null;
        this.updateUI();
    }

    /**
     * Compute effective counts taking into account fully selected collapsed folders.
     *
     * A folder that is fully selected and collapsed counts as 1 item, and its hidden
     * children are encapsulated so they do not count as extra hidden items in the breakdown.
     *
     * @returns {{ totalCount: number, visibleCount: number, hiddenCount: number, fullySelectedCollapsedFolders: Set<string> }}
     */
    getSelectionCounts() {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        const visibleRowsSet = new Set(this.getVisibleRows());

        // 1. Identify which folders are fully selected and collapsed
        const fullySelectedCollapsedFolders = new Set();
        allRows.forEach((row) => {
            if (row.dataset.isFolder !== 'true') return;
            const path = row.dataset.path || row.dataset.filename;
            if (!path) return;
            const isExpanded = row.dataset.expanded === 'true';
            if (isExpanded) return; // Only collapsed folders encapsulate their children

            const prefix = path + '/';
            const loadedDescendants = allRows.filter((r) => (r.dataset.path || '').startsWith(prefix));
            const isDirectlySelected = this.selectedPaths.has(path);
            const allLoadedSelected =
                loadedDescendants.length === 0 ||
                loadedDescendants.every((r) => this.selectedPaths.has(r.dataset.path || r.dataset.filename));

            if (isDirectlySelected && allLoadedSelected) {
                fullySelectedCollapsedFolders.add(path);
            }
        });

        // 2. Count items, skipping descendants of fully selected collapsed folders
        let visibleCount = 0;
        let hiddenCount = 0;

        for (const path of this.selectedPaths) {
            // Check if this path is a descendant of any fully selected collapsed folder
            let isEncapsulated = false;
            for (const folderPath of fullySelectedCollapsedFolders) {
                if (path.startsWith(folderPath + '/')) {
                    isEncapsulated = true;
                    break;
                }
            }
            if (isEncapsulated) {
                continue;
            }

            const row = allRows.find((r) => (r.dataset.path || r.dataset.filename) === path);
            if (row && visibleRowsSet.has(row)) {
                visibleCount++;
            } else {
                hiddenCount++;
            }
        }

        const totalCount = visibleCount + hiddenCount;
        return { totalCount, visibleCount, hiddenCount, fullySelectedCollapsedFolders };
    }

    /**
     * Reveal hidden selected items by resetting active filters and expanding partially selected folders.
     * Fully selected folders are NOT expanded because their content is already visibly selected.
     */
    revealHiddenSelection() {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        const { fullySelectedCollapsedFolders } = this.getSelectionCounts();

        // 1. Reset text filter inputs if any are active
        const filterInputs = this.table.querySelectorAll('thead tr.column-filter input');
        let filterReset = false;
        filterInputs.forEach((input) => {
            if (input.value) {
                input.value = '';
                filterReset = true;
            }
        });
        if (filterReset) {
            filterInputs[0]?.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 2. Turn off toolbar toggle filters if they hide any selected items
        const selectedRowElements = allRows.filter((r) => this.selectedPaths.has(r.dataset.path || r.dataset.filename));
        const hasHiddenSelected = selectedRowElements.some((r) => r.dataset.isHidden === 'true');
        const hasMissingSelected = selectedRowElements.some((r) => r.dataset.isMissing === 'true');
        const hasUnchangedSelected = selectedRowElements.some((r) => r.dataset.isChanged === 'false');

        if (hasHiddenSelected && this.table.classList.contains('hide-hidden')) {
            const toggle = document.getElementById('toggle-hidden');
            if (toggle && !toggle.checked) toggle.click();
        }
        if (hasMissingSelected && this.table.classList.contains('hide-missing')) {
            const toggle = document.getElementById('toggle-missing');
            if (toggle && !toggle.checked) toggle.click();
        }
        if (hasUnchangedSelected && this.table.classList.contains('hide-unchanged')) {
            const toggle = document.getElementById('toggle-changed');
            if (toggle && toggle.checked) toggle.click();
        }

        // 3. Expand collapsed folders that contain partially selected files
        // (Do NOT expand folders in fullySelectedCollapsedFolders!)
        allRows.forEach((row) => {
            if (row.dataset.isFolder !== 'true') return;
            const path = row.dataset.path;
            if (!path) return;
            if (row.dataset.expanded === 'true') return;

            // Skip fully selected folders
            if (fullySelectedCollapsedFolders.has(path)) return;

            // Check if any selected item is inside this folder
            const prefix = path + '/';
            let hasSelectedChild = false;
            for (const selPath of this.selectedPaths) {
                if (selPath.startsWith(prefix)) {
                    hasSelectedChild = true;
                    break;
                }
            }

            if (hasSelectedChild) {
                const toggleBtn = row.querySelector('.folder-toggle');
                if (toggleBtn) toggleBtn.click();
            }
        });

        this.updateUI();
    }

    /**
     * Recompute all checkbox states (including folder indeterminate states) and action bar HUD.
     */
    updateUI() {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));

        // 1. Update row checkboxes and calculate tri-state folder checkboxes (bottom-up in reverse)
        allRows
            .slice()
            .reverse()
            .forEach((row) => {
                const path = row.dataset.path || row.dataset.filename;
                const isFolder = row.dataset.isFolder === 'true';
                const cb = row.querySelector('input.row-checkbox');

                if (!isFolder) {
                    const isSelected = this.selectedPaths.has(path);
                    row.classList.toggle('selected-multi', isSelected);
                    if (cb) {
                        cb.checked = isSelected;
                        cb.indeterminate = false;
                    }
                } else {
                    const prefix = path ? path + '/' : '';

                    // Find all descendant rows loaded in the DOM
                    const loadedDescendants = prefix
                        ? allRows.filter((r) => (r.dataset.path || '').startsWith(prefix))
                        : [];

                    if (loadedDescendants.length > 0) {
                        const allLoadedSelected = loadedDescendants.every((r) =>
                            this.selectedPaths.has(r.dataset.path || r.dataset.filename),
                        );
                        const anyLoadedSelected = loadedDescendants.some((r) =>
                            this.selectedPaths.has(r.dataset.path || r.dataset.filename),
                        );

                        if (allLoadedSelected) {
                            // Fully selected folder
                            this.selectedPaths.add(path);
                            row.classList.add('selected-multi');
                            if (cb) {
                                cb.checked = true;
                                cb.indeterminate = false;
                            }
                        } else if (anyLoadedSelected) {
                            // Partially selected folder (indeterminate)
                            this.selectedPaths.delete(path);
                            row.classList.add('selected-multi');
                            if (cb) {
                                cb.checked = false;
                                cb.indeterminate = true;
                            }
                        } else {
                            // Completely unselected folder (0 loaded children selected)
                            this.selectedPaths.delete(path);
                            row.classList.remove('selected-multi');
                            if (cb) {
                                cb.checked = false;
                                cb.indeterminate = false;
                            }
                        }
                    } else {
                        // Collapsed / unexpanded folder without loaded children in the DOM
                        let anyDescendantInSet = false;
                        if (prefix) {
                            for (const selPath of this.selectedPaths) {
                                if (selPath.startsWith(prefix)) {
                                    anyDescendantInSet = true;
                                    break;
                                }
                            }
                        }

                        const isFolderDirectlySelected = this.selectedPaths.has(path);
                        if (isFolderDirectlySelected) {
                            row.classList.add('selected-multi');
                            if (cb) {
                                cb.checked = true;
                                cb.indeterminate = false;
                            }
                        } else if (anyDescendantInSet) {
                            row.classList.add('selected-multi');
                            if (cb) {
                                cb.checked = false;
                                cb.indeterminate = true;
                            }
                        } else {
                            row.classList.remove('selected-multi');
                            if (cb) {
                                cb.checked = false;
                                cb.indeterminate = false;
                            }
                        }
                    }
                }
            });

        // 2. Compute effective hierarchical counts
        const { totalCount, visibleCount, hiddenCount } = this.getSelectionCounts();

        // 3. Master Checkbox in table header
        const visibleRows = this.getVisibleRows();
        const allVisibleChecked =
            visibleRows.length > 0 &&
            visibleRows.every((r) => {
                const cb = r.querySelector('input.row-checkbox');
                return cb && cb.checked && !cb.indeterminate;
            });
        const anyVisibleCheckedOrIndeterminate = visibleRows.some((r) => {
            const cb = r.querySelector('input.row-checkbox');
            return cb && (cb.checked || cb.indeterminate);
        });

        const masterCheckbox = document.getElementById('master-select-checkbox');
        if (masterCheckbox) {
            if (allVisibleChecked) {
                masterCheckbox.checked = true;
                masterCheckbox.indeterminate = false;
            } else if (anyVisibleCheckedOrIndeterminate) {
                masterCheckbox.checked = false;
                masterCheckbox.indeterminate = true;
            } else {
                masterCheckbox.checked = false;
                masterCheckbox.indeterminate = false;
            }
        }

        // 4. Floating Action Bar
        const actionBar = document.getElementById('floating-action-bar');
        const counter = document.getElementById('selection-counter');
        const breakdown = document.getElementById('selection-breakdown');
        const warning = document.getElementById('selection-warning');
        const i18n = window.clientI18n || {};

        if (totalCount > 0 && actionBar) {
            actionBar.style.display = 'block';
            if (counter) {
                const pattern = i18n['selection.selected_count'] || '{count} ausgewählt';
                counter.textContent = pattern.replace('{count}', String(totalCount));
            }
            if (breakdown) {
                if (hiddenCount > 0) {
                    breakdown.style.display = 'inline';
                    const revealTitle =
                        i18n['selection.reveal_hidden'] || 'Klicken, um ausgeblendete Dateien anzuzeigen';
                    const hiddenLabel = i18n['filter.stats_hidden'] || 'ausgeblendet';
                    const revealBtnHtml = `<button type="button" class="action-bar-reveal-btn" id="btn-reveal-hidden" title="${revealTitle}">${hiddenCount} ${hiddenLabel}</button>`;
                    const pattern = i18n['selection.filter_breakdown'] || '({visible} sichtbar, {hidden} ausgeblendet)';

                    let breakdownHtml = pattern.replace('{visible}', String(visibleCount));
                    if (breakdownHtml.includes(`{hidden} ${hiddenLabel}`)) {
                        breakdownHtml = breakdownHtml.replace(`{hidden} ${hiddenLabel}`, revealBtnHtml);
                    } else {
                        breakdownHtml = breakdownHtml.replace('{hidden}', revealBtnHtml);
                    }
                    breakdown.innerHTML = breakdownHtml;

                    const btnReveal = breakdown.querySelector('#btn-reveal-hidden');
                    if (btnReveal) {
                        btnReveal.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.revealHiddenSelection();
                        });
                    }
                } else {
                    breakdown.style.display = 'none';
                    breakdown.innerHTML = '';
                }
            }
            if (warning) {
                const missingCount = allRows.filter(
                    (r) =>
                        this.selectedPaths.has(r.dataset.path || r.dataset.filename) && r.dataset.isMissing === 'true',
                ).length;
                if (missingCount > 0) {
                    warning.style.display = 'inline-flex';
                    const pattern =
                        i18n['selection.missing_warning'] ||
                        '{count} Dateien in diesem Snapshot nicht vorhanden (werden übersprungen)';
                    warning.textContent = '⚠️ ' + pattern.replace('{count}', String(missingCount));
                } else {
                    warning.style.display = 'none';
                }
            }
        } else if (actionBar) {
            actionBar.style.display = 'none';
        }

        if (this.onSelectionChange) {
            this.onSelectionChange(this.selectedPaths, totalCount);
        }
    }

    /**
     * Interceptor method to handle keyboard shortcuts for selection.
     *
     * @param {KeyboardEvent} e - Keyboard event.
     * @param {HTMLTableRowElement|null} focusedRow - Currently focused table row.
     * @returns {boolean} True if the event was consumed.
     */
    handleKeyDown(e, focusedRow) {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
        if (isInputActive) return false;

        // Escape: Clear multi-selection if active
        if (e.key === 'Escape') {
            if (this.selectedPaths.size > 0) {
                e.preventDefault();
                this.clearSelection();
                return true;
            }
            return false;
        }

        // Ctrl+A: Select all visible rows
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            this.selectAllVisible();
            return true;
        }

        // Shift+Space: Range selection toggle
        if (e.shiftKey && (e.key === ' ' || e.key === 'Spacebar')) {
            if (focusedRow) {
                e.preventDefault();
                this.toggleRow(focusedRow, { range: true });
                return true;
            }
        }

        // Space: Single row selection toggle
        if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === ' ' || e.key === 'Spacebar')) {
            if (focusedRow) {
                e.preventDefault();
                this.toggleRow(focusedRow);
                return true;
            }
        }

        return false;
    }
}

window.SelectionManager = SelectionManager;
