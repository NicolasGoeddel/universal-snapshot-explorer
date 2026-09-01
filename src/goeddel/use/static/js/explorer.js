function encodePath(p) {
    if (!p) return '';
    return p.split('/').map(encodeURIComponent).join('/');
}

function buildRouteUrl(baseUrl, module, rootName, subpath = '', queryParams = {}) {
    const rootPart = encodePath(rootName);
    let url = baseUrl ? `${baseUrl}/${module}/${rootPart}` : `/${module}/${rootPart}`;
    if (subpath && subpath.trim()) {
        const cleanSub = encodePath(subpath.trim().replace(/^\/+|\/+$/g, ''));
        url += `/-/${cleanSub}`;
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== '') {
            params.set(k, v);
        }
    }
    const qs = params.toString();
    if (qs) {
        url += `?${qs}`;
    }
    return url;
}

class TreeTable {
    constructor(table) {
        this.table = table;
        this.tbody = table.querySelector('tbody');
        this.rootName = table.dataset.root;
        this.snapshot = table.dataset.snapshot;
        this.selectedRow = null;
        this.snapshotAbortController = null;

        if (typeof TableColumnResizer !== 'undefined') {
            this.columnResizer = new TableColumnResizer(this.table);
        }
        this.bindTreeEvents(this.tbody);
        this.initSorting();
        this.initFiltering();
        this.initToggles();
        this.initMultiSelection();
        this.initTypeahead();
        this.initKeyboardNavigation();
        this.initTimelineTooltip();
        this.initSnapshotDropdown();
        this.updateZebra();
        this.updateToggleCounts();

        this.loadSnapshotBars(this.tbody, this.table.dataset.subpath || '');
        this.selectRowFromHash();
        window.addEventListener('hashchange', () => this.selectRowFromHash());
        window.addEventListener('popstate', (e) => {
            const params = new URLSearchParams(window.location.search);
            const snap = params.get('snapshot') || 'Original';
            if (snap && snap !== this.snapshot) {
                this.navigateToSnapshot(snap, { pushHistory: false });
            }
        });
    }

    initMultiSelection() {
        this.selectedPaths = new Set();
        this.lastClickedCheckbox = null;

        const masterCheckbox = document.getElementById('master-select-checkbox');
        if (masterCheckbox) {
            masterCheckbox.addEventListener('click', () => {
                const visibleRows = this.getVisibleRows();
                const allVisibleSelected =
                    visibleRows.length > 0 &&
                    visibleRows.every((r) => this.selectedPaths.has(r.dataset.path || r.dataset.filename));

                if (allVisibleSelected) {
                    // Deselect all visible
                    visibleRows.forEach((r) => this.selectedPaths.delete(r.dataset.path || r.dataset.filename));
                } else {
                    // Select all visible
                    visibleRows.forEach((r) => this.selectedPaths.add(r.dataset.path || r.dataset.filename));
                }
                this.updateSelectionUI();
            });
        }

        // Table delegation for checkbox clicks & Shift+Click range selection
        this.tbody.addEventListener('click', (e) => {
            const checkbox = e.target.closest('input.row-checkbox');
            if (!checkbox) return;

            const row = checkbox.closest('tr');
            if (!row) return;

            const rowPath = row.dataset.path || row.dataset.filename;
            const isChecked = checkbox.checked;

            if (e.shiftKey && this.lastClickedCheckbox && this.lastClickedCheckbox !== checkbox) {
                const visibleRows = this.getVisibleRows();
                const lastRow = this.lastClickedCheckbox.closest('tr');
                const lastIdx = visibleRows.indexOf(lastRow);
                const currentIdx = visibleRows.indexOf(row);

                if (lastIdx >= 0 && currentIdx >= 0) {
                    const start = Math.min(lastIdx, currentIdx);
                    const end = Math.max(lastIdx, currentIdx);
                    for (let i = start; i <= end; i++) {
                        const r = visibleRows[i];
                        const p = r.dataset.path || r.dataset.filename;
                        if (isChecked) {
                            this.selectedPaths.add(p);
                        } else {
                            this.selectedPaths.delete(p);
                        }
                    }
                }
            } else {
                if (isChecked) {
                    this.selectedPaths.add(rowPath);
                } else {
                    this.selectedPaths.delete(rowPath);
                }
            }

            this.lastClickedCheckbox = checkbox;
            this.updateSelectionUI();
        });

        // Floating action bar buttons
        const btnClear = document.getElementById('btn-clear-selection');
        if (btnClear) {
            btnClear.addEventListener('click', () => this.clearMultiSelection());
        }

        const btnDownload = document.getElementById('btn-download-zip');
        if (btnDownload) {
            btnDownload.addEventListener('click', () => this.downloadSelectedZip());
        }

        // Shift key range selection preview
        this.isShiftDown = false;
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

    updateRangePreview(active) {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        allRows.forEach((r) => r.classList.remove('range-preview'));
        if (!active || !this.lastClickedCheckbox || !this.selectedRow) return;

        const visibleRows = this.getVisibleRows();
        const lastRow = this.lastClickedCheckbox.closest('tr');
        const lastIdx = visibleRows.indexOf(lastRow);
        const currentIdx = visibleRows.indexOf(this.selectedRow);

        if (lastIdx >= 0 && currentIdx >= 0 && lastIdx !== currentIdx) {
            const start = Math.min(lastIdx, currentIdx);
            const end = Math.max(lastIdx, currentIdx);
            for (let i = start; i <= end; i++) {
                visibleRows[i].classList.add('range-preview');
            }
        }
    }

    toggleRowSelection(row, options = {}) {
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
                for (let i = start; i <= end; i++) {
                    const r = visibleRows[i];
                    const p = r.dataset.path || r.dataset.filename;
                    if (shouldSelect) {
                        this.selectedPaths.add(p);
                    } else {
                        this.selectedPaths.delete(p);
                    }
                }
            }
        } else {
            if (this.selectedPaths.has(rowPath)) {
                this.selectedPaths.delete(rowPath);
            } else {
                this.selectedPaths.add(rowPath);
            }
            if (cb) this.lastClickedCheckbox = cb;
        }

        this.updateSelectionUI();
    }

    selectAllVisible() {
        const visibleRows = this.getVisibleRows();
        visibleRows.forEach((r) => this.selectedPaths.add(r.dataset.path || r.dataset.filename));
        this.updateSelectionUI();
    }

    clearMultiSelection() {
        this.selectedPaths.clear();
        this.lastClickedCheckbox = null;
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        if (!this.selectedPaths) return;
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        allRows.forEach((row) => {
            const path = row.dataset.path || row.dataset.filename;
            const isSelected = this.selectedPaths.has(path);
            row.classList.toggle('selected-multi', isSelected);
            const cb = row.querySelector('input.row-checkbox');
            if (cb) cb.checked = isSelected;
        });

        const totalCount = this.selectedPaths.size;
        const visibleRows = this.getVisibleRows();
        const visibleSelectedCount = visibleRows.filter((r) =>
            this.selectedPaths.has(r.dataset.path || r.dataset.filename),
        ).length;
        const hiddenSelectedCount = totalCount - visibleSelectedCount;

        const masterCheckbox = document.getElementById('master-select-checkbox');
        if (masterCheckbox) {
            if (visibleRows.length > 0 && visibleSelectedCount === visibleRows.length) {
                masterCheckbox.checked = true;
                masterCheckbox.indeterminate = false;
            } else if (visibleSelectedCount > 0) {
                masterCheckbox.checked = false;
                masterCheckbox.indeterminate = true;
            } else {
                masterCheckbox.checked = false;
                masterCheckbox.indeterminate = false;
            }
        }

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
                if (hiddenSelectedCount > 0) {
                    breakdown.style.display = 'inline';
                    const pattern = i18n['selection.filter_breakdown'] || '({visible} sichtbar, {hidden} ausgeblendet)';
                    breakdown.textContent = pattern
                        .replace('{visible}', String(visibleSelectedCount))
                        .replace('{hidden}', String(hiddenSelectedCount));
                } else {
                    breakdown.style.display = 'none';
                }
            }
            if (warning) {
                // Check if any selected rows in DOM are missing in the current snapshot
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
    }

    downloadSelectedZip() {
        if (this.selectedPaths.size === 0) return;
        const paths = Array.from(this.selectedPaths);
        const snapshot = this.snapshot || '';
        const basePath = this.table.dataset.subpath || '';
        const structureSelect = document.getElementById('zip-structure-select');
        const structure = structureSelect ? structureSelect.value : 'relative';

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = buildRouteUrl('', 'download-zip', this.rootName);
        form.style.display = 'none';

        const addField = (name, val) => {
            const inp = document.createElement('input');
            inp.type = 'hidden';
            inp.name = name;
            inp.value = val;
            form.appendChild(inp);
        };

        addField('snapshot', snapshot);
        addField('base_path', basePath);
        addField('structure', structure);
        addField('payload', JSON.stringify(paths));

        document.body.appendChild(form);
        form.submit();
        setTimeout(() => form.remove(), 2000);
    }

    initSnapshotDropdown() {
        const snapDropdown = document.getElementById('breadcrumb-snapshot-dropdown');
        if (snapDropdown) {
            snapDropdown.addEventListener('click', (e) => {
                const link = e.target.closest('.dropdown-content a');
                if (!link) return;
                const snapHref = link.getAttribute('href') || '';
                if (snapHref.includes('snapshot=')) {
                    e.preventDefault();
                    const snapId = this.extractSnapIdFromHref(link);
                    if (snapId) {
                        this.navigateToSnapshot(snapId);
                    }
                }
            });
        }
    }

    extractSnapIdFromHref(link) {
        if (!link) return '';
        if (link.dataset.snapId) return link.dataset.snapId;
        const href =
            link.getAttribute('href') || (link.href && link.href.baseVal ? link.href.baseVal : link.href) || '';
        const match = href.match(/[?&]snapshot=([^&#]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    updateRowSnapshotCircles(snapIndex) {
        if (snapIndex < 0) return;
        const cx = String(snapIndex * 20 + 10);
        const svgs = this.tbody.querySelectorAll('svg.snapshotbar');
        svgs.forEach((svg) => {
            if (svg.classList.contains('snapshot-skeleton-svg') || svg.classList.contains('header-snapshotbar')) return;
            const td = svg.closest('td');
            const row = svg.closest('tr');
            const isSubDataset =
                svg.classList.contains('is-sub-dataset') ||
                (td && td.dataset.isSubDataset === 'true') ||
                (row && row.dataset.isSubDataset === 'true') ||
                (td && td._snapshotData && td._snapshotData.isSubDataset) ||
                (row && row.querySelector('.sub-dataset-link') !== null) ||
                (row && row.querySelector('.symlink-target-badge')?.textContent?.includes('Dataset')) ||
                (row && row.querySelector('.symlink-target-badge')?.textContent?.includes('Mount'));

            if (isSubDataset) {
                svg.classList.add('is-sub-dataset');
                if (td) td.dataset.isSubDataset = 'true';
                if (row) row.dataset.isSubDataset = 'true';
                const circle = svg.querySelector('circle');
                if (circle) circle.remove();
                return;
            }
            let circle = svg.querySelector('circle');
            if (!circle) {
                circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cy', '10');
                circle.setAttribute('r', '4');
                circle.setAttribute('fill', '#ffffff');
                circle.setAttribute('stroke', '#1e293b');
                circle.setAttribute('stroke-width', '1.5');
                svg.appendChild(circle);
            }
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', '10');
            circle.style.display = '';
        });
    }

    navigateToAdjacentSnapshot(delta) {
        const snapLinks = Array.from(document.querySelectorAll('.snapshots-header-timeline a'));
        if (snapLinks.length <= 1) return;
        const currentIdx = snapLinks.findIndex(
            (a) =>
                a.dataset.isCurrent === 'true' ||
                a.querySelector('.current-snapshot-rect') ||
                (a.dataset.snapId && a.dataset.snapId === this.snapshot),
        );
        if (currentIdx < 0) return;
        const targetIdx = currentIdx + delta;
        if (targetIdx >= 0 && targetIdx < snapLinks.length) {
            const targetLink = snapLinks[targetIdx];
            const targetSnapId = targetLink.dataset.snapId || this.extractSnapIdFromHref(targetLink);
            if (targetSnapId) {
                this.navigateToSnapshot(targetSnapId);
            }
        }
    }

    async navigateToSnapshot(targetSnapshotId, options = { pushHistory: true }) {
        if (!targetSnapshotId || targetSnapshotId === this.snapshot) return;

        // Abort any ongoing snapshot fetch
        if (this.snapshotAbortController) {
            this.snapshotAbortController.abort();
        }
        this.snapshotAbortController = new AbortController();
        const { signal } = this.snapshotAbortController;

        this.snapshot = targetSnapshotId;
        this.table.dataset.snapshot = targetSnapshotId;

        // 1. Instantly update Header Timeline Indicator
        const snapLinks = Array.from(document.querySelectorAll('.snapshots-header-timeline a'));
        let targetSnapIndex = -1;
        let targetSnapName = targetSnapshotId;

        snapLinks.forEach((a, idx) => {
            const rect = a.querySelector('.header-snap-rect');
            const circle = a.querySelector('circle');
            const snapId = a.dataset.snapId || this.extractSnapIdFromHref(a);
            const isMatch =
                snapId === targetSnapshotId || decodeURIComponent(snapId) === decodeURIComponent(targetSnapshotId);

            if (isMatch) {
                targetSnapIndex = idx;
                targetSnapName = a.dataset.snapName || targetSnapshotId;
                a.dataset.isCurrent = 'true';
                if (rect) rect.classList.add('current-snapshot-rect');
                if (!circle) {
                    const newCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    newCircle.setAttribute('cx', String(idx * 20 + 10));
                    newCircle.setAttribute('cy', '8.5');
                    newCircle.setAttribute('r', '3.5');
                    newCircle.setAttribute('fill', '#ffffff');
                    newCircle.setAttribute('stroke', '#1e293b');
                    newCircle.setAttribute('stroke-width', '1.5');
                    a.appendChild(newCircle);
                }
            } else {
                a.dataset.isCurrent = 'false';
                if (rect) rect.classList.remove('current-snapshot-rect');
                if (circle) circle.remove();
            }
        });

        // 2. Update circles in all table row snapshot bars instantly
        if (targetSnapIndex >= 0) {
            this.updateRowSnapshotCircles(targetSnapIndex);
        }

        // 3. Update Breadcrumbs Snapshot dropdown label & URL links
        const breadcrumbName = document.getElementById('breadcrumb-snapshot-name');
        if (breadcrumbName) {
            breadcrumbName.textContent = targetSnapName;
        }
        const breadcrumbInput = document.getElementById('breadcrumb-path-input');
        if (breadcrumbInput) {
            breadcrumbInput.dataset.snapshot = targetSnapshotId;
        }

        const snapDropdown = document.getElementById('breadcrumb-snapshot-dropdown');
        if (snapDropdown) {
            snapDropdown.querySelectorAll('.snapshot-dropdown-item').forEach((item) => {
                const snapId = this.extractSnapIdFromHref(item);
                if (snapId === targetSnapshotId) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }

        const baseSubpath = this.table.dataset.subpath || '';
        document.querySelectorAll('.breadcrumbs a[href*="snapshot="]').forEach((a) => {
            try {
                const u = new URL(a.href, window.location.origin);
                u.searchParams.set('snapshot', targetSnapshotId);
                a.href = u.pathname + u.search + u.hash;
            } catch (e) {}
        });

        // 4. Update browser URL & History
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('snapshot', targetSnapshotId);
        if (options.pushHistory !== false) {
            history.pushState(
                { snapshot: targetSnapshotId },
                '',
                currentUrl.pathname + currentUrl.search + currentUrl.hash,
            );
        }

        // 5. Fetch updated snapshot state from backend
        try {
            const url = buildRouteUrl('', 'api/snapshot-state', this.rootName, baseSubpath, {
                snapshot: targetSnapshotId,
            });
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (!data.entries) return;

            // Update DOM rows for current directory level
            const topLevelRows = Array.from(this.tbody.querySelectorAll('tr')).filter(
                (r) => (r.dataset.parent || '') === baseSubpath,
            );

            topLevelRows.forEach((row) => {
                const filename = row.dataset.filename || row.querySelector('.browser-cell-snapshots')?.dataset.filename;
                if (!filename) return;

                const meta = data.entries[filename];
                if (!meta) return;

                // Update missing / existence status
                const isSubDataset = row.dataset.isSubDataset === 'true' || (meta && meta.is_sub_dataset);
                const doesExist = isSubDataset ? true : !!meta.does_exist;
                row.dataset.isMissing = doesExist ? 'false' : 'true';
                row.classList.toggle('row-missing', !doesExist);

                const nameCell = row.querySelector('.browser-cell-name');
                if (nameCell) {
                    nameCell.classList.toggle('stroke', !doesExist);
                    nameCell.classList.toggle('node-locked', !meta.is_accessible);
                }

                // Update lock indicator
                let lockIndicator = row.querySelector('.lock-indicator');
                if (!meta.is_accessible && doesExist) {
                    if (!lockIndicator && nameCell) {
                        lockIndicator = document.createElement('span');
                        lockIndicator.className = 'lock-indicator';
                        lockIndicator.title =
                            window.clientI18n?.['error.permission_denied'] || 'Keine Leseberechtigung';
                        lockIndicator.innerHTML =
                            '<svg class="lucide lucide-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
                        nameCell.appendChild(lockIndicator);
                    }
                    if (lockIndicator) lockIndicator.style.display = 'inline-block';
                } else if (lockIndicator) {
                    lockIndicator.style.display = 'none';
                }

                // Update Size
                const sizeCell = row.querySelector('.browser-cell-size');
                if (sizeCell) {
                    let displaySize = meta.size_human;
                    if (
                        meta.is_folder &&
                        !meta.has_independent_snapshots &&
                        meta.size !== undefined &&
                        meta.size !== null &&
                        meta.size >= 0
                    ) {
                        const unit =
                            meta.size === 1
                                ? window.clientI18n?.['unit.file'] || 'file'
                                : window.clientI18n?.['unit.files'] || 'files';
                        displaySize = `${meta.size} ${unit}`;
                    } else if (
                        meta.has_independent_snapshots ||
                        (meta.is_folder && (meta.size === null || meta.size < 0))
                    ) {
                        displaySize = '—';
                    }
                    sizeCell.textContent = displaySize;
                    sizeCell.dataset.sort = String(meta.size);
                }

                // Update Owner
                const ownerCell = row.querySelector('.browser-cell-owner');
                if (ownerCell) {
                    ownerCell.textContent = meta.owner;
                    ownerCell.dataset.sort = meta.owner;
                }

                // Update Mode
                const modeCell = row.querySelector('.browser-cell-mode');
                if (modeCell) {
                    modeCell.textContent = meta.mode_human;
                    modeCell.dataset.sort = meta.mode_octal;
                }

                // Update Mtime
                const mtimeCell = row.querySelector('.browser-cell-mtime');
                if (mtimeCell) {
                    mtimeCell.textContent = meta.mtime_fmt;
                    mtimeCell.dataset.sort = meta.mtime_iso;
                }

                // Update Ctime
                const ctimeCell = row.querySelector('.browser-cell-ctime');
                if (ctimeCell) {
                    ctimeCell.textContent = meta.ctime_fmt;
                    ctimeCell.dataset.sort = meta.ctime_iso;
                }

                // Update links (Folder link, Symlink target link, Download link, Details link)
                const nameLink = row.querySelector('.browser-cell-name a');
                if (nameLink) {
                    try {
                        const u = new URL(nameLink.href, window.location.origin);
                        u.searchParams.set('snapshot', targetSnapshotId);
                        nameLink.href = u.pathname + u.search + u.hash;
                    } catch (e) {}
                }

                const downloadLink = row.querySelector('.action-download') || row.querySelector('.file-download-link');
                if (downloadLink) {
                    try {
                        const u = new URL(downloadLink.href, window.location.origin);
                        u.searchParams.set('snapshot', targetSnapshotId);
                        downloadLink.href = u.pathname + u.search + u.hash;
                    } catch (e) {}
                }

                const detailsLink = row.querySelector('.action-details');
                if (detailsLink) {
                    try {
                        const u = new URL(detailsLink.href, window.location.origin);
                        u.searchParams.set('snapshot', targetSnapshotId);
                        detailsLink.href = u.pathname + u.search + u.hash;
                    } catch (e) {}
                }
            });

            // Update subfolders if any are expanded
            const expandedRows = Array.from(this.tbody.querySelectorAll('tr[data-expanded="true"]'));
            if (expandedRows.length > 0) {
                await Promise.all(
                    expandedRows.map(async (expRow) => {
                        const expPath = expRow.dataset.path;
                        if (!expPath) return;
                        try {
                            const subUrl = buildRouteUrl('', 'api/snapshot-state', this.rootName, expPath, {
                                snapshot: targetSnapshotId,
                            });
                            const subRes = await fetch(subUrl, { signal });
                            if (!subRes.ok) return;
                            const subData = await subRes.json();
                            if (!subData.entries) return;

                            const children = Array.from(
                                this.tbody.querySelectorAll(`tr[data-parent="${CSS.escape(expPath)}"]`),
                            );
                            children.forEach((childRow) => {
                                const fn =
                                    childRow.dataset.filename ||
                                    childRow.querySelector('.browser-cell-snapshots')?.dataset.filename;
                                if (!fn) return;
                                const childMeta = subData.entries[fn];
                                if (!childMeta) return;

                                const isChildSubDataset =
                                    childRow.dataset.isSubDataset === 'true' || (childMeta && childMeta.is_sub_dataset);
                                const childExists = isChildSubDataset ? true : !!childMeta.does_exist;
                                childRow.dataset.isMissing = childExists ? 'false' : 'true';
                                childRow.classList.toggle('row-missing', !childExists);

                                const childNameCell = childRow.querySelector('.browser-cell-name');
                                if (childNameCell) {
                                    childNameCell.classList.toggle('stroke', !childExists);
                                    childNameCell.classList.toggle('node-locked', !childMeta.is_accessible);
                                }

                                const childSizeCell = childRow.querySelector('.browser-cell-size');
                                if (childSizeCell) {
                                    let displaySize = childMeta.size_human;
                                    if (
                                        childMeta.is_folder &&
                                        !childMeta.has_independent_snapshots &&
                                        childMeta.size !== undefined &&
                                        childMeta.size !== null &&
                                        childMeta.size >= 0
                                    ) {
                                        const unit =
                                            childMeta.size === 1
                                                ? window.clientI18n?.['unit.file'] || 'file'
                                                : window.clientI18n?.['unit.files'] || 'files';
                                        displaySize = `${childMeta.size} ${unit}`;
                                    } else if (
                                        childMeta.has_independent_snapshots ||
                                        (childMeta.is_folder && (childMeta.size === null || childMeta.size < 0))
                                    ) {
                                        displaySize = '—';
                                    }
                                    childSizeCell.textContent = displaySize;
                                    childSizeCell.dataset.sort = String(childMeta.size);
                                }
                                const childOwnerCell = childRow.querySelector('.browser-cell-owner');
                                if (childOwnerCell) {
                                    childOwnerCell.textContent = childMeta.owner;
                                    childOwnerCell.dataset.sort = childMeta.owner;
                                }
                                const childModeCell = childRow.querySelector('.browser-cell-mode');
                                if (childModeCell) {
                                    childModeCell.textContent = childMeta.mode_human;
                                    childModeCell.dataset.sort = childMeta.mode_octal;
                                }
                                const childMtimeCell = childRow.querySelector('.browser-cell-mtime');
                                if (childMtimeCell) {
                                    childMtimeCell.textContent = childMeta.mtime_fmt;
                                    childMtimeCell.dataset.sort = childMeta.mtime_iso;
                                }
                                const childCtimeCell = childRow.querySelector('.browser-cell-ctime');
                                if (childCtimeCell) {
                                    childCtimeCell.textContent = childMeta.ctime_fmt;
                                    childCtimeCell.dataset.sort = childMeta.ctime_iso;
                                }
                            });
                        } catch (e) {}
                    }),
                );
            }

            if (data.snapshot && typeof data.snapshot.index === 'number') {
                this.updateRowSnapshotCircles(data.snapshot.index);
            }

            // Update sorting if active
            if (this.currentSort !== null) {
                this.sortTree();
            }

            this.updateZebra();
            this.updateToggleCounts();

            if (this.selectedRow) {
                this.selectRow(this.selectedRow, { updateHash: false });
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('Failed to update snapshot state:', err);
        }
    }

    selectRowFromHash() {
        if (!window.location.hash) return;
        const rawHash = window.location.hash.substring(1);
        const targetName = decodeURIComponent(rawHash.replace(/\+/g, ' '));
        if (!targetName) return;

        const findAndSelect = () => {
            const rows = Array.from(this.tbody.querySelectorAll('tr'));
            const targetRow = rows.find((r) => {
                const fn = r.dataset.filename || r.querySelector('.browser-cell-snapshots')?.dataset.filename;
                const path = r.dataset.path;
                const name = r.querySelector('.browser-cell-name')?.dataset.sort;
                return (
                    fn === targetName ||
                    name === targetName ||
                    (path && (path.endsWith('/' + targetName) || path === targetName))
                );
            });

            if (targetRow) {
                this.selectRow(targetRow, { updateHash: false });
            }
        };

        findAndSelect();
        setTimeout(findAndSelect, 120);
    }

    initToggles() {
        const toggleHidden = document.getElementById('toggle-hidden');
        const toggleMissing = document.getElementById('toggle-missing');
        const toggleChanged = document.getElementById('toggle-changed');

        // Read persisted states from localStorage
        const showHidden = localStorage.getItem('zfs_explorer_show_hidden') === 'true';
        const showMissing = localStorage.getItem('zfs_explorer_show_missing') !== 'false';
        const showChangedOnly = localStorage.getItem('zfs_explorer_show_changed_only') === 'true';

        if (toggleHidden) {
            toggleHidden.checked = showHidden;
            this.table.classList.toggle('hide-hidden', !showHidden);
            toggleHidden.addEventListener('change', () => {
                const isChecked = toggleHidden.checked;
                this.table.classList.toggle('hide-hidden', !isChecked);
                localStorage.setItem('zfs_explorer_show_hidden', isChecked ? 'true' : 'false');
                if (!isChecked) {
                    this.tbody.querySelectorAll('tr[data-is-hidden="true"]').forEach((row) => {
                        if (row.dataset.path) {
                            this.collapseDescendants(row.dataset.path);
                        }
                        row.dataset.expanded = 'false';
                        const toggle = row.querySelector('.folder-toggle');
                        if (toggle) toggle.classList.remove('opened');
                    });
                }
                this.updateZebra();
                this.updateToggleCounts();
                this.updateSelectionUI();
            });
        }

        if (toggleMissing) {
            toggleMissing.checked = showMissing;
            this.table.classList.toggle('hide-missing', !showMissing);
            toggleMissing.addEventListener('change', () => {
                const isChecked = toggleMissing.checked;
                this.table.classList.toggle('hide-missing', !isChecked);
                localStorage.setItem('zfs_explorer_show_missing', isChecked ? 'true' : 'false');
                if (!isChecked) {
                    this.tbody.querySelectorAll('tr[data-is-missing="true"]').forEach((row) => {
                        if (row.dataset.path) {
                            this.collapseDescendants(row.dataset.path);
                        }
                        row.dataset.expanded = 'false';
                        const toggle = row.querySelector('.folder-toggle');
                        if (toggle) toggle.classList.remove('opened');
                    });
                }
                this.updateZebra();
                this.updateToggleCounts();
                this.updateSelectionUI();
            });
        }

        if (toggleChanged) {
            toggleChanged.checked = showChangedOnly;
            this.table.classList.toggle('hide-unchanged', showChangedOnly);
            toggleChanged.addEventListener('change', () => {
                const isChecked = toggleChanged.checked;
                this.table.classList.toggle('hide-unchanged', isChecked);
                localStorage.setItem('zfs_explorer_show_changed_only', isChecked ? 'true' : 'false');
                if (isChecked) {
                    this.tbody.querySelectorAll('tr[data-is-changed="false"]').forEach((row) => {
                        if (row.dataset.path) {
                            this.collapseDescendants(row.dataset.path);
                        }
                        row.dataset.expanded = 'false';
                        const toggle = row.querySelector('.folder-toggle');
                        if (toggle) toggle.classList.remove('opened');
                    });
                }
                this.updateZebra();
                this.updateToggleCounts();
                this.updateSelectionUI();
            });
        }
    }

    buildSnapshotSvg(barStr, snapshots, isSubDataset = false) {
        if (!barStr || !snapshots || snapshots.length === 0) {
            return '<span class="text-muted" style="color: var(--text-muted, #64748b); font-size: 13px; padding-left: 2px;">–</span>';
        }
        const isSub = isSubDataset === true || isSubDataset === 'true';
        const colorMap = {
            g: 'var(--snap-1)',
            b: 'var(--snap-2)',
            y: 'var(--snap-3)',
            r: 'var(--snap-4)',
            o: 'var(--snap-5)',
            p: 'var(--snap-6)',
        };
        const count = snapshots.length;
        const barWidth = 20;
        const totalWidth = count * barWidth;
        const currentSnap = this.snapshot;

        let inner = '';
        let currentIdx = -1;
        for (let i = 0; i < count; i++) {
            const char = barStr[i] || 'x';
            const snap = snapshots[i];
            const x = i * barWidth;
            if (
                !isSub &&
                (snap.id === currentSnap || decodeURIComponent(snap.id) === decodeURIComponent(currentSnap))
            ) {
                currentIdx = i;
            }

            if (char === 'x') {
                inner += `<rect x="${x + 0.5}" y="1" width="19" height="18" rx="2" ry="2" fill="var(--snap-missing)" stroke="rgba(0,0,0,0.25)" stroke-width="1"/><line x1="${x + 3}" y1="3.5" x2="${x + 16.5}" y2="16.5" stroke="#ef4444" stroke-width="1.5"/><line x1="${x + 16.5}" y1="3.5" x2="${x + 3}" y2="16.5" stroke="#ef4444" stroke-width="1.5"/>`;
            } else {
                const color = colorMap[char] || 'var(--snap-1)';
                inner += `<rect x="${x + 0.5}" y="1" width="19" height="18" rx="2" ry="2" fill="${color}" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>`;
            }
        }

        const circle =
            currentIdx >= 0 && !isSub
                ? `<circle cx="${currentIdx * barWidth + 10}" cy="10" r="4" fill="#ffffff" stroke="#1e293b" stroke-width="1.5"></circle>`
                : '';

        return `<svg class="snapshotbar${isSub ? ' is-sub-dataset' : ''}" viewBox="-1 -1 ${totalWidth + 2} 21" preserveAspectRatio="none" style="width: 100%; height: 16px;">${inner}${circle}</svg>`;
    }

    initTimelineTooltip() {
        const timeline = document.querySelector('.snapshots-header-timeline');
        if (!timeline) return;
        let tooltip = document.getElementById('timeline-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'timeline-tooltip';
            tooltip.className = 'timeline-tooltip';
            document.body.appendChild(tooltip);
        }

        const hideTooltip = () => {
            tooltip.classList.remove('visible');
        };

        timeline.addEventListener('mouseover', (e) => {
            const link = e.target.closest('a');
            if (!link || !timeline.contains(link)) {
                hideTooltip();
                return;
            }
            const name = link.dataset.snapName || '';
            const time = link.dataset.snapTime || '';
            const isCurrent = link.dataset.isCurrent === 'true';
            const isMissing = link.dataset.isMissing === 'true';

            const currentBadge = isCurrent
                ? `<span class="timeline-tooltip-badge">${window.clientI18n?.['snapshot.current'] || 'Aktuell'}</span>`
                : '';
            const missingBadge = isMissing
                ? `<span class="timeline-tooltip-badge missing">${window.clientI18n?.['badge.missing'] || 'Nicht vorhanden'}</span>`
                : '';

            tooltip.innerHTML = `
                        <div class="timeline-tooltip-title">
                            <span>${name}</span>
                            ${currentBadge}
                            ${missingBadge}
                        </div>
                        ${time ? `<div class="timeline-tooltip-time">🕒 ${time}</div>` : ''}
                    `;
            tooltip.style.left = e.clientX + 'px';
            tooltip.style.top = e.clientY + 'px';
            tooltip.classList.add('visible');
        });

        timeline.addEventListener('mousemove', (e) => {
            if (tooltip.classList.contains('visible')) {
                tooltip.style.left = e.clientX + 'px';
                tooltip.style.top = e.clientY + 'px';
            }
        });

        timeline.addEventListener('mouseleave', hideTooltip);

        timeline.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (!link || !timeline.contains(link)) return;
            e.preventDefault();
            const snapId = link.dataset.snapId || this.extractSnapIdFromHref(link);
            if (snapId) {
                this.navigateToSnapshot(snapId);
            }
        });
    }

    initSnapshotObserver() {
        if (this.snapshotObserver) return;
        this.snapshotObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const td = entry.target;
                        this.snapshotObserver.unobserve(td);
                        if (td._snapshotData && td.querySelector('.snapshot-skeleton, .snapshot-skeleton-svg')) {
                            td.innerHTML = this.buildSnapshotSvg(
                                td._snapshotData.barStr,
                                td._snapshotData.snapshots,
                                td._snapshotData.isSubDataset,
                            );
                            delete td._snapshotData;
                        }
                    }
                });
            },
            {
                root: null,
                rootMargin: '300px 0px',
                threshold: 0.01,
            },
        );
    }

    async loadSnapshotBars(container, dirPath) {
        const skeletons = container.querySelectorAll(
            '.browser-cell-snapshots[data-filename] .snapshot-skeleton, .browser-cell-snapshots[data-filename] .snapshot-skeleton-svg',
        );
        if (skeletons.length === 0) return;

        this.initSnapshotObserver();

        try {
            const url = buildRouteUrl('', 'api/snapshot-bars', this.rootName, dirPath, { snapshot: this.snapshot });
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            const snapshots = data.snapshots || [];
            const bars = data.bars || {};

            const cells = container.querySelectorAll('.browser-cell-snapshots[data-filename]');
            cells.forEach((td) => {
                const fn = td.dataset.filename;
                const row = td.closest('tr');
                if (bars[fn] && td.querySelector('.snapshot-skeleton, .snapshot-skeleton-svg')) {
                    let barStr = '';
                    let itemSnapshots = snapshots;
                    let isSubDataset =
                        td.dataset.isSubDataset === 'true' || (row && row.dataset.isSubDataset === 'true');

                    if (typeof bars[fn] === 'object' && bars[fn].is_sub_dataset) {
                        barStr = bars[fn].barStr || '';
                        itemSnapshots = bars[fn].snapshots || [];
                        isSubDataset = true;
                        td.dataset.isSubDataset = 'true';
                    } else if (typeof bars[fn] === 'object') {
                        barStr = bars[fn].barStr || '';
                        itemSnapshots = bars[fn].snapshots || [];
                    } else {
                        barStr = bars[fn] || '';
                    }

                    td.dataset.barStr = barStr;
                    td.dataset.isSubDataset = isSubDataset ? 'true' : 'false';

                    // Determine if file/folder changed across snapshots
                    const isUnchanged = barStr.length > 0 && !barStr.includes('x') && new Set(barStr).size === 1;
                    if (row) {
                        row.dataset.isChanged = isUnchanged ? 'false' : 'true';
                    }

                    // Lazy render via IntersectionObserver
                    td._snapshotData = { barStr, snapshots: itemSnapshots, isSubDataset };
                    this.snapshotObserver.observe(td);
                }
            });
            this.updateZebra();
            this.updateToggleCounts();
        } catch (err) {
            console.error('Failed to load snapshot bars:', err);
        }
    }

    updateZebra() {
        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');
        const hasFilterHidden = !!this.tbody.querySelector('tr.filter-hidden');
        const rows = this.tbody.querySelectorAll('tr');
        const hasDisplayNone = Array.from(rows).some((row) => row.style.display === 'none');
        const isFiltered = hideHidden || hideMissing || hideUnchanged || hasFilterHidden || hasDisplayNone;

        this.table.classList.toggle('is-filtered', isFiltered);
        if (!isFiltered) {
            rows.forEach((row) => {
                row.classList.remove('even', 'odd');
            });
            return;
        }

        let visibleIdx = 0;
        rows.forEach((row) => {
            if (row.classList.contains('filter-hidden') || row.style.display === 'none') {
                return;
            }
            if (hideHidden && row.dataset.isHidden === 'true') {
                return;
            }
            if (hideMissing && row.dataset.isMissing === 'true') {
                return;
            }
            if (hideUnchanged && row.dataset.isChanged === 'false') {
                return;
            }
            row.classList.toggle('odd', visibleIdx % 2 === 0);
            row.classList.toggle('even', visibleIdx % 2 !== 0);
            visibleIdx++;
        });
    }

    bindTreeEvents(container) {
        container.querySelectorAll('.folder-toggle').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFolder(btn);
            });
        });
    }

    async toggleFolder(btn) {
        const row = btn.closest('tr');
        const path = row.dataset.path;
        const level = parseInt(row.dataset.level || '0', 10);
        const isExpanded = row.dataset.expanded === 'true';

        if (isExpanded) {
            this.collapseDescendants(path);
            row.dataset.expanded = 'false';
            btn.classList.remove('opened');
            if (
                this.selectedRow &&
                (this.selectedRow.style.display === 'none' || this.selectedRow.offsetParent === null)
            ) {
                this.selectRow(row);
            }
            this.updateZebra();
            this.updateToggleCounts();
        } else {
            const existingChildren = this.getDirectChildren(path);
            if (existingChildren.length > 0) {
                existingChildren.forEach((child) => {
                    child.style.display = '';
                });
                row.dataset.expanded = 'true';
                btn.classList.add('opened');
                this.updateZebra();
                this.updateToggleCounts();
            } else {
                btn.classList.add('loading');
                try {
                    const url = buildRouteUrl('', 'ajax', this.rootName, path, {
                        snapshot: this.snapshot,
                        level: level + 1,
                    });
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const html = await res.text();

                    const temp = document.createElement('tbody');
                    temp.innerHTML = html;
                    const newRows = Array.from(temp.querySelectorAll('tr'));

                    if (newRows.length > 0) {
                        let insertAfter = row;
                        newRows.forEach((newRow) => {
                            insertAfter.after(newRow);
                            insertAfter = newRow;
                        });
                        this.bindTreeEvents(temp);
                        newRows.forEach((newRow) => {
                            newRow.querySelectorAll('.folder-toggle').forEach((toggle) => {
                                toggle.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    this.toggleFolder(toggle);
                                });
                            });
                        });

                        this.loadSnapshotBars(this.tbody, path);
                    }
                    row.dataset.expanded = 'true';
                    btn.classList.add('opened');

                    this.applyFilter();
                    if (this.currentSort !== null) {
                        this.sortTree();
                    }
                    this.updateZebra();
                    this.updateToggleCounts();
                } catch (err) {
                    console.error('Failed to load folder contents:', err);
                    const errorRow = document.createElement('tr');
                    errorRow.className = 'folder-error-row';
                    errorRow.dataset.parent = path;
                    errorRow.dataset.level = String(level + 1);
                    errorRow.innerHTML = `<td colspan="7" class="browser-cell-error" style="padding-left: calc(24px + 20px * ${level + 1});">🔒 <em>Zugriff verweigert (Permission denied): Keine Leseberechtigung für diesen Ordner</em></td>`;
                    row.after(errorRow);
                    row.dataset.expanded = 'true';
                    btn.classList.add('opened');
                    this.updateZebra();
                } finally {
                    btn.classList.remove('loading');
                }
            }
        }
    }

    getDirectChildren(parentPath) {
        return Array.from(this.tbody.querySelectorAll(`tr[data-parent="${CSS.escape(parentPath)}"]`));
    }

    collapseDescendants(parentPath) {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        const prefix = parentPath + '/';
        allRows.forEach((row) => {
            const rowPath = row.dataset.path || '';
            const rowParent = row.dataset.parent || '';
            if (rowParent === parentPath || rowPath.startsWith(prefix)) {
                row.style.display = 'none';
                row.dataset.expanded = 'false';
                const toggle = row.querySelector('.folder-toggle');
                if (toggle) toggle.classList.remove('opened');
            }
        });
    }

    getBarSortKey(bar) {
        if (!bar) return [0, 0, 0, []];
        let changes = 0;
        let exists = 0;
        const lengths = [];
        let currentLen = 0;
        let lastChar = null;

        for (let i = 0; i < bar.length; i++) {
            const c = bar[i];
            if (c !== 'x') exists++;
            if (lastChar === null) {
                lastChar = c;
                currentLen = 1;
            } else if (c === lastChar) {
                currentLen++;
            } else {
                lengths.push(currentLen);
                if (lastChar !== 'x' && c !== 'x') changes++;
                lastChar = c;
                currentLen = 1;
            }
        }
        if (currentLen > 0) {
            lengths.push(currentLen);
        }

        return [changes, exists, lengths.length, lengths];
    }

    compareBarKeys(keyA, keyB) {
        if (keyA[0] !== keyB[0]) return keyA[0] - keyB[0];
        if (keyA[1] !== keyB[1]) return keyA[1] - keyB[1];
        if (keyA[2] !== keyB[2]) return keyA[2] - keyB[2];
        for (let i = 0; i < Math.min(keyA[3].length, keyB[3].length); i++) {
            if (keyA[3][i] !== keyB[3][i]) return keyA[3][i] - keyB[3][i];
        }
        return 0;
    }

    initSorting() {
        if (typeof TableSorter === 'undefined') return;
        this.sorter = new TableSorter(this.table, {
            tbody: this.tbody,
            treeSort: true,
            storageKey: this.table.id || 'explorer',
            customComparators: {
                'snapshot-bar': (_valA, _valB, cellA, cellB) => {
                    const barA = cellA?.dataset?.barStr || '';
                    const barB = cellB?.dataset?.barStr || '';
                    const keyA = this.getBarSortKey(barA);
                    const keyB = this.getBarSortKey(barB);
                    return this.compareBarKeys(keyA, keyB);
                },
            },
            rowComparator: (a, b, colIndex, baseCmp) => {
                if (colIndex === 1) {
                    const isDirLike = (row) =>
                        row.dataset.isFolder === 'true' ||
                        row.dataset.isSubDataset === 'true' ||
                        row.querySelector('.sub-dataset-link') !== null ||
                        row.querySelector('.folder-toggle') !== null;
                    const isDirA = isDirLike(a);
                    const isDirB = isDirLike(b);
                    if (isDirA !== isDirB) {
                        return isDirA ? -1 : 1;
                    }
                }
                return baseCmp;
            },
            onSort: () => {
                this.updateZebra();
                if (this.selectedRow) {
                    this.selectRow(this.selectedRow, { updateHash: false });
                }
            },
        });
    }

    get currentSort() {
        return this.sorter?.getSortState() || null;
    }

    sortByColumnIndex(cellIndex, forcedDirection = null) {
        this.sorter?.sortByColumnIndex(cellIndex, forcedDirection);
    }

    sortTree() {
        this.sorter?.sort();
    }

    initFiltering() {
        const filterInputs = Array.from(this.table.querySelectorAll('thead tr.column-filter input'));
        filterInputs.forEach((input, idx) => {
            input.addEventListener('input', () => {
                this.applyFilter();
                this.updateZebra();
            });

            input.addEventListener('keydown', (e) => {
                const colIndex = parseInt(input.dataset.col, 10);

                // Escape: Blur filter input and return focus to table
                if (e.key === 'Escape') {
                    e.preventDefault();
                    input.blur();
                    const visibleRows = this.getVisibleRows();
                    if (visibleRows.length > 0) {
                        this.selectRow(this.selectedRow || visibleRows[0]);
                    }
                    return;
                }

                // Tab cycling across filter inputs
                if (e.key === 'Tab') {
                    if (e.shiftKey && idx === 0) {
                        e.preventDefault();
                        const last = filterInputs[filterInputs.length - 1];
                        last.focus();
                        last.select();
                        return;
                    } else if (!e.shiftKey && idx === filterInputs.length - 1) {
                        e.preventDefault();
                        const first = filterInputs[0];
                        first.focus();
                        first.select();
                        return;
                    }
                }

                // ArrowDown or Enter (without modifiers): Step down into first visible table row
                if (
                    (e.key === 'ArrowDown' && !e.ctrlKey && !e.altKey && !e.metaKey) ||
                    (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey)
                ) {
                    e.preventDefault();
                    input.blur();
                    const visibleRows = this.getVisibleRows();
                    this.selectRow(visibleRows.length > 0 ? visibleRows[0] : null);
                    return;
                }

                if (e.key === 'ArrowUp' && (e.ctrlKey || e.altKey)) {
                    e.preventDefault();
                    this.sortByColumnIndex(colIndex, 'asc');
                } else if (e.key === 'ArrowDown' && (e.ctrlKey || e.altKey)) {
                    e.preventDefault();
                    this.sortByColumnIndex(colIndex, 'desc');
                } else if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    this.sortByColumnIndex(colIndex);
                }
            });
        });
    }

    applyFilter() {
        const filterInputs = Array.from(this.table.querySelectorAll('thead tr.column-filter input'));
        const activeFilters = filterInputs
            .map((inp) => ({
                colIndex: parseInt(inp.dataset.col, 10),
                query: inp.value.trim().toLowerCase(),
            }))
            .filter((f) => f.query.length > 0);

        const allRows = Array.from(this.tbody.querySelectorAll('tr'));

        if (activeFilters.length === 0) {
            allRows.forEach((row) => row.classList.remove('filter-hidden'));
            this.updateToggleCounts();
            this.updateSelectionUI();
            return;
        }

        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        const matchMap = new Map();

        allRows.forEach((row) => {
            let matches = true;
            for (const f of activeFilters) {
                const cell = row.children[f.colIndex];
                if (!cell) {
                    matches = false;
                    break;
                }
                let text = '';
                if (f.colIndex === 1) {
                    text = (row.dataset.filename || cell.dataset.sort || cell.textContent).trim().toLowerCase();
                } else {
                    text = (cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent)
                        .trim()
                        .toLowerCase();
                }
                if (!text.includes(f.query)) {
                    matches = false;
                    break;
                }
            }
            matchMap.set(row, matches);
        });

        // Propagate match upward only from rows that are otherwise visible
        allRows.forEach((row) => {
            if (matchMap.get(row)) {
                if (hideHidden && row.dataset.isHidden === 'true') return;
                if (hideMissing && row.dataset.isMissing === 'true') return;
                if (hideUnchanged && row.dataset.isChanged === 'false') return;

                let parentPath = row.dataset.parent;
                while (parentPath) {
                    const parentRow = allRows.find((r) => r.dataset.path === parentPath);
                    if (parentRow) {
                        matchMap.set(parentRow, true);
                        parentPath = parentRow.dataset.parent;
                    } else {
                        break;
                    }
                }
            }
        });

        allRows.forEach((row) => {
            row.classList.toggle('filter-hidden', !matchMap.get(row));
        });

        // Sanitize focused row if it became hidden by the active filter
        const visibleRows = this.getVisibleRows();
        if (this.selectedRow && !visibleRows.includes(this.selectedRow)) {
            this.selectRow(visibleRows.length > 0 ? visibleRows[0] : null, { updateHash: false });
        }

        this.updateToggleCounts();
        this.updateSelectionUI();
    }

    isRowInExpandedHierarchy(row) {
        let parentPath = row.dataset.parent;
        const rootPath = this.table.dataset.subpath || '';
        while (parentPath && parentPath !== rootPath) {
            const parentRow = this.tbody.querySelector(`tr[data-path="${CSS.escape(parentPath)}"]`);
            if (!parentRow || parentRow.dataset.expanded !== 'true') {
                return false;
            }
            parentPath = parentRow.dataset.parent;
        }
        return true;
    }

    updateToggleCounts() {
        const allRows = Array.from(this.tbody.querySelectorAll('tr')).filter((r) => this.isRowInExpandedHierarchy(r));
        if (allRows.length === 0) return;

        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        let hiddenCount = 0;
        let missingCount = 0;
        let unchangedCount = 0;
        let changedCount = 0;
        const totalRows = allRows.length;
        let visibleRows = 0;

        allRows.forEach((row) => {
            const isHidden = row.dataset.isHidden === 'true';
            const isMissing = row.dataset.isMissing === 'true';
            const isChanged = row.dataset.isChanged === 'true';
            const isUnchanged = row.dataset.isChanged === 'false';

            if (isHidden) hiddenCount++;
            if (isMissing) missingCount++;
            if (isUnchanged) unchangedCount++;
            if (isChanged) changedCount++;

            let isVisible = true;
            if (row.classList.contains('filter-hidden') || row.style.display === 'none') isVisible = false;
            else if (hideHidden && isHidden) isVisible = false;
            else if (hideMissing && isMissing) isVisible = false;
            else if (hideUnchanged && isUnchanged) isVisible = false;

            if (isVisible) visibleRows++;
        });

        const badgeHidden = document.getElementById('badge-hidden-count');
        if (badgeHidden) {
            badgeHidden.textContent = hiddenCount;
            badgeHidden.style.display = hiddenCount > 0 ? 'inline-block' : 'none';
            badgeHidden.classList.toggle('is-filtering', hideHidden && hiddenCount > 0);
            badgeHidden.title = hideHidden
                ? `${hiddenCount} versteckte Dateien ausgeblendet`
                : `${hiddenCount} versteckte Dateien eingeblendet`;
        }

        const badgeMissing = document.getElementById('badge-missing-count');
        if (badgeMissing) {
            badgeMissing.textContent = missingCount;
            badgeMissing.style.display = missingCount > 0 ? 'inline-block' : 'none';
            badgeMissing.classList.toggle('is-filtering', hideMissing && missingCount > 0);
            badgeMissing.title = hideMissing
                ? `${missingCount} fehlende Dateien ausgeblendet`
                : `${missingCount} fehlende Dateien eingeblendet`;
        }

        const badgeChanged = document.getElementById('badge-changed-count');
        if (badgeChanged) {
            if (unchangedCount + changedCount > 0) {
                badgeChanged.textContent = `${changedCount}/${totalRows}`;
                badgeChanged.style.display = 'inline-block';
                badgeChanged.classList.toggle('is-filtering', hideUnchanged && unchangedCount > 0);
                badgeChanged.title = hideUnchanged
                    ? `${unchangedCount} statische Dateien ausgeblendet (${changedCount} sichtbar)`
                    : `${changedCount} geändert von ${totalRows}`;
            } else {
                badgeChanged.style.display = 'none';
            }
        }

        const stats = document.getElementById('toolbar-stats');
        if (stats) {
            const hiddenTotal = totalRows - visibleRows;
            if (hiddenTotal > 0) {
                stats.innerHTML = `<span>${visibleRows} / ${totalRows}</span> <span style="opacity: 0.7;">(${hiddenTotal} ${window.clientI18n?.['badge.missing'] || 'ausgeblendet'})</span>`;
            } else {
                stats.textContent = `${totalRows}`;
            }
        }
    }

    getVisibleRows() {
        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        return Array.from(this.tbody.querySelectorAll('tr')).filter((row) => {
            if (row.classList.contains('filter-hidden') || row.style.display === 'none') {
                return false;
            }
            if (hideHidden && row.dataset.isHidden === 'true') {
                return false;
            }
            if (hideMissing && row.dataset.isMissing === 'true') {
                return false;
            }
            if (hideUnchanged && row.dataset.isChanged === 'false') {
                return false;
            }
            return true;
        });
    }

    selectRow(row, options = { updateHash: true }) {
        if (this.keyboard) {
            this.keyboard.focusRow(row, options);
        } else {
            this.selectedRow = row;
        }
    }

    closeTypeahead() {
        if (this.typeahead) {
            this.typeahead.close();
        }
    }

    initTypeahead() {
        if (typeof TypeaheadHUD === 'undefined') return;
        this.typeahead = new TypeaheadHUD(this.table, {
            tbody: this.tbody,
            getRows: () => this.getVisibleRows(),
            getSearchText: (row) => row.dataset.filename || row.querySelector('.browser-cell-name')?.dataset.sort || '',
            onSelect: (row) => this.selectRow(row),
        });
    }

    initKeyboardNavigation() {
        if (typeof KeyboardNavigator === 'undefined') return;

        this.keyboard = new KeyboardNavigator(this.table, {
            tbody: this.tbody,
            getRows: () => this.getVisibleRows(),
            onFocusChange: (row, options) => {
                this.selectedRow = row;
                if (row) {
                    const rect = row.getBoundingClientRect();
                    const topHeaderHeight = parseInt(
                        getComputedStyle(document.documentElement).getPropertyValue('--top-header-height') || '85',
                        10,
                    );
                    const headerRowHeight = parseInt(
                        getComputedStyle(document.documentElement).getPropertyValue('--header-row-height') || '27',
                        10,
                    );
                    const totalHeaderOffset = topHeaderHeight + headerRowHeight + 35;

                    if (rect.top < totalHeaderOffset) {
                        window.scrollBy({ top: rect.top - totalHeaderOffset - 6, behavior: 'smooth' });
                    } else if (rect.bottom > window.innerHeight) {
                        window.scrollBy({ top: rect.bottom - window.innerHeight + 20, behavior: 'smooth' });
                    }

                    if (options.updateHash !== false) {
                        const filename =
                            row.dataset.filename || row.querySelector('.browser-cell-name')?.dataset.sort || '';
                        if (filename) {
                            history.replaceState(null, '', '#' + encodeURIComponent(filename));
                        }
                    }

                    if (this.isShiftDown) {
                        this.updateRangePreview(true);
                    } else {
                        this.updateRangePreview(false);
                    }
                } else if (options.updateHash !== false) {
                    if (window.location.hash) {
                        history.replaceState(null, '', window.location.pathname + window.location.search);
                    }
                }
            },
        });

        // 1. Explorer Shortcuts & Modal Interceptor
        this.keyboard.addInterceptor((e) => {
            // Modal trap: If shortcuts modal is active, trap all keys and close on Escape
            const modal = document.getElementById('shortcuts-modal');
            if (modal && modal.style.display !== 'none') {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    if (typeof toggleShortcutsModal === 'function') toggleShortcutsModal(false);
                }
                return true;
            }

            // Global Shortcuts (only when no text input is active)
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
            if (!isInputActive) {
                if (e.key === '?' || e.key === 'F1' || (e.shiftKey && e.key.toUpperCase() === 'H')) {
                    e.preventDefault();
                    if (typeof toggleShortcutsModal === 'function') toggleShortcutsModal();
                    return true;
                }

                if (e.key === '/' && !this.typeahead?.isActive()) {
                    e.preventDefault();
                    const firstFilter = this.table.querySelector('.column-filter input[data-col="1"]');
                    if (firstFilter) {
                        firstFilter.focus();
                        firstFilter.select();
                    }
                    return true;
                }
            }

            return false;
        });

        // 2. Typeahead Interceptor
        this.keyboard.addInterceptor((e) => this.typeahead?.handleKeyDown(e));

        // 3. TableSorter Column Sorting Interceptor (Alt+1..Alt+N)
        this.keyboard.addInterceptor((e) => this.sorter?.handleKeyDown(e));

        // Global shortcuts: Path edit (Ctrl+L)
        this.keyboard.register('Ctrl+L', () => {
            if (typeof enableBreadcrumbPathEdit === 'function') enableBreadcrumbPathEdit();
        });

        // Escape: Clear multi-selection -> Deselect focused row
        this.keyboard.register('Escape', () => {
            if (this.selectedPaths && this.selectedPaths.size > 0) {
                this.clearMultiSelection();
                return;
            }
            this.selectRow(null);
        });

        // Space: Toggle single selection
        this.keyboard.register('Space', (row) => {
            if (row) this.toggleRowSelection(row);
        });

        // Shift+Space: Keyboard Range Selection
        this.keyboard.register('Shift+Space', (row) => {
            if (row) this.toggleRowSelection(row, { range: true });
        });

        // Ctrl+A: Select all visible
        this.keyboard.register('Ctrl+A', () => {
            this.selectAllVisible();
        });

        // Details: Ctrl+I or Alt+Enter
        this.keyboard.register(['Ctrl+I', 'Alt+Enter'], (row) => {
            if (row) {
                const detailsLink = row.querySelector('.action-info');
                if (detailsLink) detailsLink.click();
            }
        });

        // Enter: Open folder / Follow symlink / Download file
        this.keyboard.register('Enter', (row) => {
            if (!row) return;
            const isFolder = row.dataset.isFolder === 'true';
            const toggleBtn = row.querySelector('.folder-toggle');
            const nameLink = row.querySelector('.browser-cell-name a');
            if (nameLink) {
                nameLink.click();
            } else if (isFolder && toggleBtn) {
                this.toggleFolder(toggleBtn);
            } else {
                const downloadLink = row.querySelector('.action-download') || row.querySelector('.file-download-link');
                if (downloadLink) downloadLink.click();
            }
        });

        // ArrowRight: Expand folder or step into first child
        this.keyboard.register('ArrowRight', (row) => {
            if (!row) return;
            const isFolder = row.dataset.isFolder === 'true';
            const isExpanded = row.dataset.expanded === 'true';
            const toggleBtn = row.querySelector('.folder-toggle');
            const visibleRows = this.getVisibleRows();
            if (isFolder) {
                if (!isExpanded && toggleBtn) {
                    this.toggleFolder(toggleBtn);
                } else {
                    const parentPath = row.dataset.path;
                    const children = visibleRows.filter((r) => r.dataset.parent === parentPath);
                    if (children.length > 0) {
                        this.selectRow(children[0]);
                    }
                }
            }
        });

        // ArrowLeft: Collapse folder or go to parent row
        this.keyboard.register('ArrowLeft', (row) => {
            if (!row) return;
            const isFolder = row.dataset.isFolder === 'true';
            const isExpanded = row.dataset.expanded === 'true';
            const toggleBtn = row.querySelector('.folder-toggle');
            const visibleRows = this.getVisibleRows();
            if (isFolder && isExpanded && toggleBtn) {
                this.toggleFolder(toggleBtn);
            } else {
                const parentPath = row.dataset.parent;
                if (parentPath) {
                    const parentRow = visibleRows.find((r) => r.dataset.path === parentPath);
                    if (parentRow) {
                        this.selectRow(parentRow);
                    }
                }
            }
        });

        // Snapshot timeline switching: Ctrl+ArrowLeft (prev) / Ctrl+ArrowRight (next)
        this.keyboard.register('Ctrl+ArrowLeft', () => this.navigateToAdjacentSnapshot(-1));
        this.keyboard.register('Ctrl+ArrowRight', () => this.navigateToAdjacentSnapshot(1));

        // Navigate to parent directory: Backspace / Alt+ArrowUp
        const navigateToParent = () => {
            const subpath = (this.table.dataset.subpath || '').replace(/^\/+|\/+$/g, '');
            if (subpath) {
                const parts = subpath.split('/');
                const currentFolder = parts.pop();
                const parentSub = parts.join('/');
                const targetHash = currentFolder ? '#' + encodeURIComponent(currentFolder) : '';
                window.location.href = `/list/${encodeURIComponent(this.rootName)}/${encodePath(parentSub)}?snapshot=${encodeURIComponent(this.snapshot)}${targetHash}`;
            } else {
                window.location.href = `/#${encodeURIComponent(this.rootName)}`;
            }
        };
        this.keyboard.register('Backspace', navigateToParent);
        this.keyboard.register('Alt+ArrowUp', navigateToParent);

        // Quick filter search focus: /
        this.keyboard.register('/', () => {
            const firstFilter = this.table.querySelector('.column-filter input[data-col="1"]');
            if (firstFilter) {
                firstFilter.focus();
                firstFilter.select();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const table = document.getElementById('filebrowser');
    if (table) {
        window.treeTable = new TreeTable(table);
    }
});
