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
        this.currentSort = null;
        this.selectedRow = null;
        this.snapshotAbortController = null;

        this.bindTreeEvents(this.tbody);
        this.initSorting();
        this.initFiltering();
        this.initToggles();
        this.initKeyboardNavigation();
        this.initTimelineTooltip();
        this.initTypeahead();
        this.initSnapshotDropdown();
        this.initMultiSelection();
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
                const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(r => this.selectedPaths.has(r.dataset.path || r.dataset.filename));

                if (allVisibleSelected) {
                    // Deselect all visible
                    visibleRows.forEach(r => this.selectedPaths.delete(r.dataset.path || r.dataset.filename));
                } else {
                    // Select all visible
                    visibleRows.forEach(r => this.selectedPaths.add(r.dataset.path || r.dataset.filename));
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
    }

    toggleRowSelection(row) {
        if (!row) return;
        const rowPath = row.dataset.path || row.dataset.filename;
        if (this.selectedPaths.has(rowPath)) {
            this.selectedPaths.delete(rowPath);
        } else {
            this.selectedPaths.add(rowPath);
        }
        const cb = row.querySelector('input.row-checkbox');
        if (cb) this.lastClickedCheckbox = cb;
        this.updateSelectionUI();
    }

    selectAllVisible() {
        const visibleRows = this.getVisibleRows();
        visibleRows.forEach(r => this.selectedPaths.add(r.dataset.path || r.dataset.filename));
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
        allRows.forEach(row => {
            const path = row.dataset.path || row.dataset.filename;
            const isSelected = this.selectedPaths.has(path);
            row.classList.toggle('selected-multi', isSelected);
            const cb = row.querySelector('input.row-checkbox');
            if (cb) cb.checked = isSelected;
        });

        const totalCount = this.selectedPaths.size;
        const visibleRows = this.getVisibleRows();
        const visibleSelectedCount = visibleRows.filter(r => this.selectedPaths.has(r.dataset.path || r.dataset.filename)).length;
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
                    breakdown.textContent = pattern.replace('{visible}', String(visibleSelectedCount)).replace('{hidden}', String(hiddenSelectedCount));
                } else {
                    breakdown.style.display = 'none';
                }
            }
            if (warning) {
                // Check if any selected rows in DOM are missing in the current snapshot
                const missingCount = allRows.filter(r => this.selectedPaths.has(r.dataset.path || r.dataset.filename) && r.dataset.isMissing === 'true').length;
                if (missingCount > 0) {
                    warning.style.display = 'inline-flex';
                    const pattern = i18n['selection.missing_warning'] || '{count} Dateien in diesem Snapshot nicht vorhanden (werden übersprungen)';
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
        const href = link.getAttribute('href') || (link.href && link.href.baseVal ? link.href.baseVal : link.href) || '';
        const match = href.match(/[?&]snapshot=([^&#]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    updateRowSnapshotCircles(snapIndex) {
        if (snapIndex < 0) return;
        const cx = String(snapIndex * 20 + 10);
        const svgs = this.tbody.querySelectorAll('svg.snapshotbar');
        svgs.forEach(svg => {
            if (svg.classList.contains('snapshot-skeleton-svg') || svg.classList.contains('header-snapshotbar')) return;
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
            const isMatch = (snapId === targetSnapshotId) || (decodeURIComponent(snapId) === decodeURIComponent(targetSnapshotId));

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
            snapDropdown.querySelectorAll('.snapshot-dropdown-item').forEach(item => {
                const snapId = this.extractSnapIdFromHref(item);
                if (snapId === targetSnapshotId) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }

        const baseSubpath = this.table.dataset.subpath || '';
        document.querySelectorAll('.breadcrumbs a[href*="snapshot="]').forEach(a => {
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
            history.pushState({ snapshot: targetSnapshotId }, '', currentUrl.pathname + currentUrl.search + currentUrl.hash);
        }

        // 5. Fetch updated snapshot state from backend
        try {
            const url = buildRouteUrl('', 'api/snapshot-state', this.rootName, baseSubpath, { snapshot: targetSnapshotId });
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (!data.entries) return;

            // Update DOM rows for current directory level
            const topLevelRows = Array.from(this.tbody.querySelectorAll('tr')).filter(r => (r.dataset.parent || '') === baseSubpath);

            topLevelRows.forEach(row => {
                const filename = row.dataset.filename || row.querySelector('.browser-cell-snapshots')?.dataset.filename;
                if (!filename) return;

                const meta = data.entries[filename];
                if (!meta) return;

                // Update missing / existence status
                const doesExist = !!meta.does_exist;
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
                        lockIndicator.title = window.clientI18n?.['error.permission_denied'] || 'Keine Leseberechtigung';
                        lockIndicator.innerHTML = '<svg class="lucide lucide-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
                        nameCell.appendChild(lockIndicator);
                    }
                    if (lockIndicator) lockIndicator.style.display = 'inline-block';
                } else if (lockIndicator) {
                    lockIndicator.style.display = 'none';
                }

                // Update Size
                const sizeCell = row.querySelector('.browser-cell-size');
                if (sizeCell) {
                    sizeCell.textContent = meta.size_human;
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
                await Promise.all(expandedRows.map(async (expRow) => {
                    const expPath = expRow.dataset.path;
                    if (!expPath) return;
                    try {
                        const subUrl = buildRouteUrl('', 'api/snapshot-state', this.rootName, expPath, { snapshot: targetSnapshotId });
                        const subRes = await fetch(subUrl, { signal });
                        if (!subRes.ok) return;
                        const subData = await subRes.json();
                        if (!subData.entries) return;

                        const children = Array.from(this.tbody.querySelectorAll(`tr[data-parent="${CSS.escape(expPath)}"]`));
                        children.forEach(childRow => {
                            const fn = childRow.dataset.filename || childRow.querySelector('.browser-cell-snapshots')?.dataset.filename;
                            if (!fn) return;
                            const childMeta = subData.entries[fn];
                            if (!childMeta) return;

                            const childExists = !!childMeta.does_exist;
                            childRow.dataset.isMissing = childExists ? 'false' : 'true';
                            childRow.classList.toggle('row-missing', !childExists);

                            const childNameCell = childRow.querySelector('.browser-cell-name');
                            if (childNameCell) {
                                childNameCell.classList.toggle('stroke', !childExists);
                                childNameCell.classList.toggle('node-locked', !childMeta.is_accessible);
                            }

                            const childSizeCell = childRow.querySelector('.browser-cell-size');
                            if (childSizeCell) {
                                childSizeCell.textContent = childMeta.size_human;
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
                }));
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
            const targetRow = rows.find(r => {
                const fn = r.dataset.filename || r.querySelector('.browser-cell-snapshots')?.dataset.filename;
                const path = r.dataset.path;
                const name = r.querySelector('.browser-cell-name')?.dataset.sort;
                return fn === targetName || name === targetName || (path && (path.endsWith('/' + targetName) || path === targetName));
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
                    this.tbody.querySelectorAll('tr[data-is-hidden="true"]').forEach(row => {
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
                    this.tbody.querySelectorAll('tr[data-is-missing="true"]').forEach(row => {
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
                    this.tbody.querySelectorAll('tr[data-is-changed="false"]').forEach(row => {
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
            });
        }
    }

    buildSnapshotSvg(barStr, snapshots, isSubDataset = false) {
        const colorMap = { g: 'var(--snap-1)', b: 'var(--snap-2)', y: 'var(--snap-3)', r: 'var(--snap-4)', o: 'var(--snap-5)', p: 'var(--snap-6)' };
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
            if (snap.id === currentSnap || decodeURIComponent(snap.id) === decodeURIComponent(currentSnap)) {
                currentIdx = i;
            }

            if (char === 'x') {
                inner += `<rect x="${x + 0.5}" y="1" width="19" height="18" rx="2" ry="2" fill="var(--snap-missing)" stroke="rgba(0,0,0,0.25)" stroke-width="1"/><line x1="${x + 3}" y1="3.5" x2="${x + 16.5}" y2="16.5" stroke="#ef4444" stroke-width="1.5"/><line x1="${x + 16.5}" y1="3.5" x2="${x + 3}" y2="16.5" stroke="#ef4444" stroke-width="1.5"/>`;
            } else {
                const color = colorMap[char] || 'var(--snap-1)';
                inner += `<rect x="${x + 0.5}" y="1" width="19" height="18" rx="2" ry="2" fill="${color}" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>`;
            }
        }

        const circle = (currentIdx >= 0 && !isSubDataset) ? `<circle cx="${currentIdx * barWidth + 10}" cy="10" r="4" fill="#ffffff" stroke="#1e293b" stroke-width="1.5"></circle>` : '';

        return `<svg class="snapshotbar" viewBox="-1 -1 ${totalWidth + 2} 21" preserveAspectRatio="none" style="width: 100%; max-width: ${totalWidth}px; height: 16px;">${inner}${circle}</svg>`;
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

            const currentBadge = isCurrent ? `<span class="timeline-tooltip-badge">${window.clientI18n?.['snapshot.current'] || 'Aktuell'}</span>` : '';
            const missingBadge = isMissing ? `<span class="timeline-tooltip-badge missing">${window.clientI18n?.['badge.missing'] || 'Nicht vorhanden'}</span>` : '';

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
        this.snapshotObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const td = entry.target;
                    this.snapshotObserver.unobserve(td);
                    if (td._snapshotData && td.querySelector('.snapshot-skeleton, .snapshot-skeleton-svg')) {
                        td.innerHTML = this.buildSnapshotSvg(td._snapshotData.barStr, td._snapshotData.snapshots, td._snapshotData.isSubDataset);
                        delete td._snapshotData;
                    }
                }
            });
        }, {
            root: null,
            rootMargin: '300px 0px',
            threshold: 0.01
        });
    }

    async loadSnapshotBars(container, dirPath) {
        const skeletons = container.querySelectorAll('.browser-cell-snapshots[data-filename] .snapshot-skeleton, .browser-cell-snapshots[data-filename] .snapshot-skeleton-svg');
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
            cells.forEach(td => {
                const fn = td.dataset.filename;
                const row = td.closest('tr');
                if (bars[fn] && td.querySelector('.snapshot-skeleton, .snapshot-skeleton-svg')) {
                    let barStr = '';
                    let itemSnapshots = snapshots;
                    let isSubDataset = false;

                    if (typeof bars[fn] === 'object' && bars[fn].is_sub_dataset) {
                        barStr = bars[fn].barStr;
                        itemSnapshots = bars[fn].snapshots;
                        isSubDataset = true;
                        td.dataset.isSubDataset = 'true';
                    } else {
                        barStr = bars[fn];
                    }

                    td.dataset.barStr = barStr;

                    // Determine if file/folder changed across snapshots
                    const isUnchanged = (barStr.length > 0 && !barStr.includes('x') && new Set(barStr).size === 1);
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
            console.error("Failed to load snapshot bars:", err);
        }
    }

    updateZebra() {
        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');
        const hasFilterHidden = !!this.tbody.querySelector('tr.filter-hidden');
        const rows = this.tbody.querySelectorAll('tr');
        const hasDisplayNone = Array.from(rows).some(row => row.style.display === 'none');
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
        container.querySelectorAll('.folder-toggle').forEach(btn => {
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
            this.updateZebra();
        } else {
            const existingChildren = this.getDirectChildren(path);
            if (existingChildren.length > 0) {
                existingChildren.forEach(child => {
                    child.style.display = '';
                });
                row.dataset.expanded = 'true';
                btn.classList.add('opened');
                this.updateZebra();
            } else {
                btn.classList.add('loading');
                try {
                    const url = buildRouteUrl('', 'ajax', this.rootName, path, { snapshot: this.snapshot, level: level + 1 });
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const html = await res.text();

                    const temp = document.createElement('tbody');
                    temp.innerHTML = html;
                    const newRows = Array.from(temp.querySelectorAll('tr'));

                    if (newRows.length > 0) {
                        let insertAfter = row;
                        newRows.forEach(newRow => {
                            insertAfter.after(newRow);
                            insertAfter = newRow;
                        });
                        this.bindTreeEvents(temp);
                        newRows.forEach(newRow => {
                            newRow.querySelectorAll('.folder-toggle').forEach(toggle => {
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
                } catch (err) {
                    console.error("Failed to load folder contents:", err);
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
        allRows.forEach(row => {
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

    sortByColumnIndex(cellIndex, forcedDirection = null) {
        const headerRow = this.table.querySelector('thead tr.header-row');
        if (!headerRow) return;
        const th = headerRow.children[cellIndex];
        if (!th) return;

        const sortEl = th.querySelector('.sortable') || (th.classList.contains('sortable') ? th : null);
        if (!sortEl) return;

        const sortType = sortEl.dataset.sortType || th.dataset.sortType || 'text';
        let direction = forcedDirection || sortEl.dataset.defaultDir || th.dataset.defaultDir || 'asc';
        if (!forcedDirection && this.currentSort && this.currentSort.colIndex === cellIndex) {
            direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
        }

        this.table.querySelectorAll('thead tr.header-row th, thead tr.header-row th .sortable').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        sortEl.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
        th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');

        th.classList.remove('sort-flash');
        void th.offsetWidth;
        th.classList.add('sort-flash');

        this.currentSort = { colIndex: cellIndex, direction, type: sortType };
        this.sortTree();
        this.updateZebra();
        if (this.selectedRow) {
            this.selectRow(this.selectedRow, { updateHash: false });
        }
    }

    initSorting() {
        const sortElements = this.table.querySelectorAll('thead tr.header-row th.sortable, thead tr.header-row th .sortable');
        sortElements.forEach((el) => {
            el.setAttribute('tabindex', '0');
            el.setAttribute('role', 'button');
            el.addEventListener('click', (e) => {
                if (e.target.closest('a') || e.target.closest('svg')) {
                    return;
                }
                const th = el.closest('th');
                const cellIndex = Array.from(th.parentNode.children).indexOf(th);
                this.sortByColumnIndex(cellIndex);
            });

            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const th = el.closest('th');
                    const cellIndex = Array.from(th.parentNode.children).indexOf(th);
                    this.sortByColumnIndex(cellIndex);
                }
            });
        });
    }

    sortTree() {
        if (!this.currentSort) return;
        const { colIndex, direction, type } = this.currentSort;
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));

        const groups = new Map();
        allRows.forEach(row => {
            const parent = row.dataset.parent || '';
            if (!groups.has(parent)) groups.set(parent, []);
            groups.get(parent).push(row);
        });

        const compareRows = (a, b) => {
            if (colIndex === 1) {
                const isFolderA = a.dataset.isFolder === 'true';
                const isFolderB = b.dataset.isFolder === 'true';
                if (isFolderA !== isFolderB) {
                    return isFolderA ? -1 : 1;
                }
            }

            const cellA = a.children[colIndex];
            const cellB = b.children[colIndex];
            if (!cellA || !cellB) return 0;

            const valA = cellA.dataset.sort !== undefined ? cellA.dataset.sort : cellA.textContent.trim();
            const valB = cellB.dataset.sort !== undefined ? cellB.dataset.sort : cellB.textContent.trim();

            let cmp = 0;
            if (type === 'snapshot-bar') {
                const barA = cellA.dataset.barStr || '';
                const barB = cellB.dataset.barStr || '';
                const keyA = this.getBarSortKey(barA);
                const keyB = this.getBarSortKey(barB);
                cmp = this.compareBarKeys(keyA, keyB);
            } else if (type === 'number') {
                cmp = (parseFloat(valA) || 0) - (parseFloat(valB) || 0);
            } else if (type === 'date') {
                cmp = valA.localeCompare(valB);
            } else if (type === 'octal') {
                cmp = parseInt(valA, 8) - parseInt(valB, 8);
            } else {
                cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
            }

            return direction === 'asc' ? cmp : -cmp;
        };

        const sortedRows = [];
        const appendSubtree = (parentPath) => {
            const children = groups.get(parentPath) || [];
            children.sort(compareRows);
            children.forEach(child => {
                sortedRows.push(child);
                appendSubtree(child.dataset.path);
            });
        };

        const topLevelParent = this.table.dataset.subpath || '';
        appendSubtree(topLevelParent);

        allRows.forEach(row => {
            if (!sortedRows.includes(row)) {
                sortedRows.push(row);
            }
        });

        sortedRows.forEach(row => this.tbody.appendChild(row));
    }

    initFiltering() {
        const filterInputs = this.table.querySelectorAll('thead tr.column-filter input');
        filterInputs.forEach(input => {
            input.addEventListener('input', () => {
                this.applyFilter();
                this.updateZebra();
            });

            input.addEventListener('keydown', (e) => {
                const colIndex = parseInt(input.dataset.col, 10);
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
            .map(inp => ({
                colIndex: parseInt(inp.dataset.col, 10),
                query: inp.value.trim().toLowerCase()
            }))
            .filter(f => f.query.length > 0);

        const allRows = Array.from(this.tbody.querySelectorAll('tr'));

        if (activeFilters.length === 0) {
            allRows.forEach(row => row.classList.remove('filter-hidden'));
            return;
        }

        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        const matchMap = new Map();

        allRows.forEach(row => {
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
                    text = (cell.dataset.sort !== undefined ? cell.dataset.sort : cell.textContent).trim().toLowerCase();
                }
                if (!text.includes(f.query)) {
                    matches = false;
                    break;
                }
            }
            matchMap.set(row, matches);
        });

        // Propagate match upward only from rows that are otherwise visible
        allRows.forEach(row => {
            if (matchMap.get(row)) {
                if (hideHidden && row.dataset.isHidden === 'true') return;
                if (hideMissing && row.dataset.isMissing === 'true') return;
                if (hideUnchanged && row.dataset.isChanged === 'false') return;

                let parentPath = row.dataset.parent;
                while (parentPath) {
                    const parentRow = allRows.find(r => r.dataset.path === parentPath);
                    if (parentRow) {
                        matchMap.set(parentRow, true);
                        parentPath = parentRow.dataset.parent;
                    } else {
                        break;
                    }
                }
            }
        });

        allRows.forEach(row => {
            row.classList.toggle('filter-hidden', !matchMap.get(row));
        });
        this.updateToggleCounts();
        this.updateSelectionUI();
    }

    updateToggleCounts() {
        const allRows = Array.from(this.tbody.querySelectorAll('tr'));
        if (allRows.length === 0) return;

        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');

        let hiddenCount = 0;
        let missingCount = 0;
        let unchangedCount = 0;
        let changedCount = 0;
        let totalRows = allRows.length;
        let visibleRows = 0;

        allRows.forEach(row => {
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
            badgeHidden.title = hideHidden ? `${hiddenCount} versteckte Dateien ausgeblendet` : `${hiddenCount} versteckte Dateien eingeblendet`;
        }

        const badgeMissing = document.getElementById('badge-missing-count');
        if (badgeMissing) {
            badgeMissing.textContent = missingCount;
            badgeMissing.style.display = missingCount > 0 ? 'inline-block' : 'none';
            badgeMissing.classList.toggle('is-filtering', hideMissing && missingCount > 0);
            badgeMissing.title = hideMissing ? `${missingCount} fehlende Dateien ausgeblendet` : `${missingCount} fehlende Dateien eingeblendet`;
        }

        const badgeChanged = document.getElementById('badge-changed-count');
        if (badgeChanged) {
            if (unchangedCount + changedCount > 0) {
                badgeChanged.textContent = `${changedCount}/${totalRows}`;
                badgeChanged.style.display = 'inline-block';
                badgeChanged.classList.toggle('is-filtering', hideUnchanged && unchangedCount > 0);
                badgeChanged.title = hideUnchanged ? `${unchangedCount} statische Dateien ausgeblendet (${changedCount} sichtbar)` : `${changedCount} geändert von ${totalRows}`;
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

        return Array.from(this.tbody.querySelectorAll('tr')).filter(row => {
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
        this.tbody.querySelectorAll('tr.selected-row').forEach(r => r.classList.remove('selected-row'));
        this.selectedRow = row;
        if (row) {
            row.classList.add('selected-row');

            const rect = row.getBoundingClientRect();
            const topHeaderHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-header-height') || '85', 10);
            const headerRowHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-row-height') || '27', 10);
            const totalHeaderOffset = topHeaderHeight + headerRowHeight + 35;

            if (rect.top < totalHeaderOffset) {
                window.scrollBy({ top: rect.top - totalHeaderOffset - 6, behavior: 'smooth' });
            } else if (rect.bottom > window.innerHeight) {
                window.scrollBy({ top: rect.bottom - window.innerHeight + 20, behavior: 'smooth' });
            }

            if (options.updateHash !== false) {
                const filename = row.dataset.filename || row.querySelector('.browser-cell-name')?.dataset.sort || '';
                if (filename) {
                    history.replaceState(null, '', '#' + encodeURIComponent(filename));
                }
            }
        } else if (options.updateHash !== false) {
            if (window.location.hash) {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        }
    }

    initTypeahead() {
        let hud = document.getElementById('typeahead-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'typeahead-hud';
            hud.className = 'typeahead-hud';
            document.body.appendChild(hud);
        }
        this.typeaheadHud = hud;
        this.typeaheadActive = false;
        this.typeaheadQuery = '';
        this.typeaheadMatches = [];
        this.typeaheadIndex = -1;
    }

    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    renderTypeaheadHud() {
        if (!this.typeaheadHud) this.initTypeahead();
        if (!this.typeaheadActive || !this.typeaheadQuery) {
            this.typeaheadHud.classList.remove('visible');
            return;
        }

        const total = this.typeaheadMatches.length;
        const current = total > 0 ? this.typeaheadIndex + 1 : 0;
        const i18n = window.clientI18n || {};

        let statusHtml = '';
        if (total > 0) {
            const matchPattern = i18n['typeahead.match_count'] || 'Treffer {current} von {total}';
            const matchText = matchPattern.replace('{current}', current).replace('{total}', total);
            statusHtml = `
                        <span class="typeahead-hud-status">${matchText}</span>
                        <span class="typeahead-hud-badge">${i18n['typeahead.next_prev'] || '↑/↓ Wechseln'}</span>
                        <span class="typeahead-hud-badge">${i18n['typeahead.open'] || 'Enter: Öffnen'}</span>
                        <span class="typeahead-hud-badge">${i18n['typeahead.exit'] || 'Esc: Beenden'}</span>
                    `;
        } else {
            statusHtml = `
                        <span class="typeahead-hud-status typeahead-hud-no-match">${i18n['typeahead.no_matches'] || 'Keine Treffer'}</span>
                        <span class="typeahead-hud-badge">${i18n['typeahead.exit'] || 'Esc: Beenden'}</span>
                    `;
        }

        this.typeaheadHud.innerHTML = `
                    <div class="typeahead-hud-query-wrap">
                        <span>🔍</span>
                        <span class="typeahead-hud-query">${this.escapeHtml(this.typeaheadQuery)}</span>
                    </div>
                    ${statusHtml}
                `;
        this.typeaheadHud.classList.add('visible');
    }

    updateTypeaheadMatches() {
        const visibleRows = this.getVisibleRows();
        if (!this.typeaheadQuery) {
            this.typeaheadMatches = [];
            this.typeaheadIndex = -1;
            this.renderTypeaheadHud();
            return;
        }

        const q = this.typeaheadQuery.toLowerCase();
        const prefixMatches = [];
        const containsMatches = [];

        visibleRows.forEach(row => {
            const name = (row.dataset.filename || row.querySelector('.browser-cell-name')?.dataset.sort || '').toLowerCase();
            if (name.startsWith(q)) {
                prefixMatches.push(row);
            } else if (name.includes(q)) {
                containsMatches.push(row);
            }
        });

        this.typeaheadMatches = prefixMatches.length > 0 ? prefixMatches : containsMatches;

        if (this.typeaheadMatches.length > 0) {
            const existingIdx = this.selectedRow ? this.typeaheadMatches.indexOf(this.selectedRow) : -1;
            this.typeaheadIndex = existingIdx >= 0 ? existingIdx : 0;
            this.selectRow(this.typeaheadMatches[this.typeaheadIndex]);
        } else {
            this.typeaheadIndex = -1;
        }

        this.renderTypeaheadHud();
    }

    handleTypeaheadChar(char) {
        this.typeaheadActive = true;
        this.typeaheadQuery += char;
        this.updateTypeaheadMatches();
    }

    stepTypeahead(direction) {
        if (!this.typeaheadMatches || this.typeaheadMatches.length === 0) return;
        this.typeaheadIndex = (this.typeaheadIndex + direction + this.typeaheadMatches.length) % this.typeaheadMatches.length;
        this.selectRow(this.typeaheadMatches[this.typeaheadIndex]);
        this.renderTypeaheadHud();
    }

    backspaceTypeahead() {
        if (!this.typeaheadActive) return;
        this.typeaheadQuery = this.typeaheadQuery.slice(0, -1);
        if (!this.typeaheadQuery) {
            this.closeTypeahead();
        } else {
            this.updateTypeaheadMatches();
        }
    }

    closeTypeahead() {
        this.typeaheadActive = false;
        this.typeaheadQuery = '';
        this.typeaheadMatches = [];
        this.typeaheadIndex = -1;
        if (this.typeaheadHud) {
            this.typeaheadHud.classList.remove('visible');
        }
    }

    initKeyboardNavigation() {
        // Clicking on a row selects it and closes typeahead
        this.tbody.addEventListener('click', (e) => {
            this.closeTypeahead();
            const row = e.target.closest('tr');
            if (row && this.tbody.contains(row) && !e.target.closest('a') && !e.target.closest('.folder-toggle')) {
                this.selectRow(row);
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#typeahead-hud') && !e.target.closest('#filebrowser')) {
                this.closeTypeahead();
            }
        });

        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isInputActive = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
            const isFilterInput = isInputActive && document.activeElement.closest('.column-filter');

            // Global Ctrl+L / Cmd+L for breadcrumb path edit
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                if (typeof enableBreadcrumbPathEdit === 'function') {
                    enableBreadcrumbPathEdit();
                }
                return;
            }

            // Escape key handling
            if (e.key === 'Escape') {
                if (this.typeaheadActive) {
                    e.preventDefault();
                    this.closeTypeahead();
                    return;
                }
                const modal = document.getElementById('shortcuts-modal');
                if (modal && modal.style.display !== 'none') {
                    if (typeof toggleShortcutsModal === 'function') toggleShortcutsModal(false);
                    return;
                }
                if (isInputActive) {
                    document.activeElement.blur();
                    return;
                }
                if (this.selectedRow) {
                    this.selectRow(null);
                    return;
                }
            }

            // Backspace handling
            if (e.key === 'Backspace') {
                if (isInputActive) return;
                e.preventDefault();
                if (this.typeaheadActive) {
                    this.backspaceTypeahead();
                    return;
                }
                // Go to parent directory with hash targeting current folder
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
                return;
            }

            // Alt+ArrowUp: Go to parent directory with hash targeting current folder
            if (e.altKey && e.key === 'ArrowUp') {
                if (!isInputActive) {
                    e.preventDefault();
                    this.closeTypeahead();
                    const currentSub = (this.table.dataset.subpath || '').replace(/^\/+|\/+$/g, '');
                    const currentFolder = currentSub ? currentSub.split('/').pop() : '';
                    const targetHash = currentFolder ? '#' + encodeURIComponent(currentFolder) : '';
                    if (currentSub && currentSub !== '') {
                        const parentSub = currentSub.includes('/') ? currentSub.substring(0, currentSub.lastIndexOf('/')) : '';
                        if (parentSub) {
                            window.location.href = buildRouteUrl('', 'list', this.rootName, parentSub, { snapshot: this.snapshot }) + targetHash;
                        } else {
                            window.location.href = buildRouteUrl('', 'list', this.rootName, '', { snapshot: this.snapshot }) + targetHash;
                        }
                    } else {
                        window.location.href = `/#${encodeURIComponent(this.rootName)}`;
                    }
                    return;
                }
            }

            // Alt+1 .. Alt+8 quick column sorting (works anywhere outside text input)
            if (e.altKey && !e.ctrlKey && !e.metaKey && e.key >= '1' && e.key <= '8') {
                if (!isInputActive) {
                    const colIdx = parseInt(e.key, 10);
                    e.preventDefault();
                    this.closeTypeahead();
                    this.sortByColumnIndex(colIdx);
                    return;
                }
            }

            // Switch snapshot: Ctrl+ArrowLeft (previous in timeline) / Ctrl+ArrowRight (next in timeline)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                if (!isInputActive) {
                    this.closeTypeahead();
                    const snapLinks = Array.from(document.querySelectorAll('.snapshots-header-timeline a'));
                    if (snapLinks.length > 1) {
                        const currentIdx = snapLinks.findIndex(a => a.dataset.isCurrent === 'true' || a.querySelector('.current-snapshot-rect'));
                        if (e.key === 'ArrowLeft' && currentIdx > 0) {
                            e.preventDefault();
                            const targetLink = snapLinks[currentIdx - 1];
                            const targetSnapId = targetLink.dataset.snapId || this.extractSnapIdFromHref(targetLink);
                            if (targetSnapId) this.navigateToSnapshot(targetSnapId);
                            return;
                        } else if (e.key === 'ArrowRight' && currentIdx >= 0 && currentIdx < snapLinks.length - 1) {
                            e.preventDefault();
                            const targetLink = snapLinks[currentIdx + 1];
                            const targetSnapId = targetLink.dataset.snapId || this.extractSnapIdFromHref(targetLink);
                            if (targetSnapId) this.navigateToSnapshot(targetSnapId);
                            return;
                        }
                    }
                }
            }

            // Select all visible rows: Ctrl+A
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                if (!isInputActive) {
                    e.preventDefault();
                    this.closeTypeahead();
                    this.selectAllVisible();
                    return;
                }
            }

            // Escape: close typeahead or clear multi-selection
            if (e.key === 'Escape') {
                if (this.typeaheadActive) {
                    e.preventDefault();
                    this.closeTypeahead();
                    return;
                }
                if (this.selectedPaths && this.selectedPaths.size > 0) {
                    e.preventDefault();
                    this.clearMultiSelection();
                    return;
                }
            }

            // Space: dual role (toggle row selection when not typing query, space in query when active)
            if (e.key === ' ') {
                if (this.typeaheadActive) {
                    e.preventDefault();
                    this.handleTypeaheadChar(' ');
                    return;
                }
                if (this.selectedRow && !isInputActive) {
                    e.preventDefault();
                    this.toggleRowSelection(this.selectedRow);
                    return;
                }
            }

            // When typing inside an input field
            if (isInputActive) {
                if (isFilterInput && e.key === 'Enter') {
                    e.preventDefault();
                    document.activeElement.blur();
                    const visibleRows = this.getVisibleRows();
                    if (visibleRows.length > 0) {
                        this.selectRow(visibleRows[0]);
                    }
                }
                return;
            }

            // Shortcuts Help modal: ? or F1
            if (e.key === '?' || e.key === 'F1') {
                e.preventDefault();
                this.closeTypeahead();
                if (typeof toggleShortcutsModal === 'function') {
                    toggleShortcutsModal();
                }
                return;
            }

            // Details view: Ctrl+I or Alt+Enter
            if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') || (e.altKey && e.key === 'Enter')) {
                if (this.selectedRow) {
                    e.preventDefault();
                    this.closeTypeahead();
                    const detailsLink = this.selectedRow.querySelector('.action-info');
                    if (detailsLink) {
                        detailsLink.click();
                    }
                    return;
                }
            }

            // Focus search filter shortcut: /
            if (e.key === '/') {
                e.preventDefault();
                this.closeTypeahead();
                const firstFilter = this.table.querySelector('.column-filter input[data-col="1"]');
                if (firstFilter) {
                    firstFilter.focus();
                    firstFilter.select();
                }
                return;
            }

            // Typeahead Tab / Shift+Tab navigation
            if (e.key === 'Tab' && this.typeaheadActive) {
                e.preventDefault();
                this.stepTypeahead(e.shiftKey ? -1 : 1);
                return;
            }

            // Navigate Down: ArrowDown
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.typeaheadActive) {
                    this.stepTypeahead(1);
                    return;
                }
                const visibleRows = this.getVisibleRows();
                if (visibleRows.length === 0) return;

                const currentIndex = this.selectedRow ? visibleRows.indexOf(this.selectedRow) : -1;
                if (currentIndex >= 0) {
                    const nextIndex = currentIndex < visibleRows.length - 1 ? currentIndex + 1 : 0;
                    this.selectRow(visibleRows[nextIndex]);
                } else if (this.selectedRow) {
                    // Selected row is currently hidden by filter (e.g. missing item exemption)
                    const allRows = Array.from(this.tbody.querySelectorAll('tr'));
                    const selectedDomIdx = allRows.indexOf(this.selectedRow);
                    const nextRow = visibleRows.find(r => allRows.indexOf(r) > selectedDomIdx) || visibleRows[0];
                    this.selectRow(nextRow);
                } else {
                    this.selectRow(visibleRows[0]);
                }
                return;
            }

            // Navigate Up: ArrowUp
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.typeaheadActive) {
                    this.stepTypeahead(-1);
                    return;
                }
                const visibleRows = this.getVisibleRows();
                if (visibleRows.length === 0) return;

                const currentIndex = this.selectedRow ? visibleRows.indexOf(this.selectedRow) : -1;
                if (currentIndex >= 0) {
                    const prevIndex = currentIndex > 0 ? currentIndex - 1 : visibleRows.length - 1;
                    this.selectRow(visibleRows[prevIndex]);
                } else if (this.selectedRow) {
                    // Selected row is currently hidden by filter (e.g. missing item exemption)
                    const allRows = Array.from(this.tbody.querySelectorAll('tr'));
                    const selectedDomIdx = allRows.indexOf(this.selectedRow);
                    const precedingRows = visibleRows.filter(r => allRows.indexOf(r) < selectedDomIdx);
                    const prevRow = precedingRows.length > 0 ? precedingRows[precedingRows.length - 1] : visibleRows[visibleRows.length - 1];
                    this.selectRow(prevRow);
                } else {
                    this.selectRow(visibleRows[visibleRows.length - 1]);
                }
                return;
            }

            // Jump to Start: Home / Pos1
            if (e.key === 'Home') {
                e.preventDefault();
                this.closeTypeahead();
                const visibleRows = this.getVisibleRows();
                if (visibleRows.length > 0) this.selectRow(visibleRows[0]);
                return;
            }

            // Jump to End: End / Ende
            if (e.key === 'End') {
                e.preventDefault();
                this.closeTypeahead();
                const visibleRows = this.getVisibleRows();
                if (visibleRows.length > 0) this.selectRow(visibleRows[visibleRows.length - 1]);
                return;
            }

            // Page Down
            if (e.key === 'PageDown') {
                e.preventDefault();
                this.closeTypeahead();
                const visibleRows = this.getVisibleRows();
                if (visibleRows.length === 0) return;
                const pageSize = Math.max(1, Math.floor((window.innerHeight - 180) / 28));
                let baseIdx = this.selectedRow ? visibleRows.indexOf(this.selectedRow) : -1;
                if (baseIdx < 0 && this.selectedRow) {
                    const allRows = Array.from(this.tbody.querySelectorAll('tr'));
                    const selectedDomIdx = allRows.indexOf(this.selectedRow);
                    const nextRow = visibleRows.find(r => allRows.indexOf(r) > selectedDomIdx);
                    baseIdx = nextRow ? visibleRows.indexOf(nextRow) : 0;
                } else if (baseIdx < 0) {
                    baseIdx = 0;
                }
                const nextIndex = Math.min(visibleRows.length - 1, baseIdx + pageSize);
                this.selectRow(visibleRows[nextIndex]);
                return;
            }

            // Page Up
            if (e.key === 'PageUp') {
                e.preventDefault();
                this.closeTypeahead();
                const visibleRows = this.getVisibleRows();
                if (visibleRows.length === 0) return;
                const pageSize = Math.max(1, Math.floor((window.innerHeight - 180) / 28));
                let baseIdx = this.selectedRow ? visibleRows.indexOf(this.selectedRow) : -1;
                if (baseIdx < 0 && this.selectedRow) {
                    const allRows = Array.from(this.tbody.querySelectorAll('tr'));
                    const selectedDomIdx = allRows.indexOf(this.selectedRow);
                    const precedingRows = visibleRows.filter(r => allRows.indexOf(r) < selectedDomIdx);
                    const prevRow = precedingRows.length > 0 ? precedingRows[precedingRows.length - 1] : visibleRows[0];
                    baseIdx = visibleRows.indexOf(prevRow);
                } else if (baseIdx < 0) {
                    baseIdx = 0;
                }
                const prevIndex = Math.max(0, baseIdx - pageSize);
                this.selectRow(visibleRows[prevIndex]);
                return;
            }

            if (!this.selectedRow) {
                // Check if typing starting character
                if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key !== '/' && e.key !== ' ') {
                    e.preventDefault();
                    this.handleTypeaheadChar(e.key);
                }
                return;
            }

            const isFolder = this.selectedRow.dataset.isFolder === 'true';
            const isExpanded = this.selectedRow.dataset.expanded === 'true';
            const toggleBtn = this.selectedRow.querySelector('.folder-toggle');
            const visibleRows = this.getVisibleRows();

            // Expand / Go into child: ArrowRight
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.closeTypeahead();
                if (isFolder) {
                    if (!isExpanded && toggleBtn) {
                        this.toggleFolder(toggleBtn);
                    } else {
                        const parentPath = this.selectedRow.dataset.path;
                        const children = visibleRows.filter(r => r.dataset.parent === parentPath);
                        if (children.length > 0) {
                            this.selectRow(children[0]);
                        }
                    }
                }
                return;
            }

            // Collapse / Go to parent: ArrowLeft
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.closeTypeahead();
                if (isFolder && isExpanded && toggleBtn) {
                    this.toggleFolder(toggleBtn);
                } else {
                    const parentPath = this.selectedRow.dataset.parent;
                    if (parentPath) {
                        const parentRow = visibleRows.find(r => r.dataset.path === parentPath);
                        if (parentRow) {
                            this.selectRow(parentRow);
                        }
                    }
                }
                return;
            }

            // Enter action: Open folder / Follow symlink / Download file
            if (e.key === 'Enter') {
                e.preventDefault();
                this.closeTypeahead();
                const nameLink = this.selectedRow.querySelector('.browser-cell-name a');
                if (nameLink) {
                    nameLink.click();
                } else if (isFolder && toggleBtn) {
                    this.toggleFolder(toggleBtn);
                } else {
                    const downloadLink = this.selectedRow.querySelector('.action-download') || this.selectedRow.querySelector('.file-download-link');
                    if (downloadLink) {
                        downloadLink.click();
                    }
                }
                return;
            }

            // Printable alphanumeric characters trigger Typeahead
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && e.key !== '/' && e.key !== ' ') {
                e.preventDefault();
                this.handleTypeaheadChar(e.key);
                return;
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