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

class ExplorerView {
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
        this.treeTable = new TreeTable(this.table, {
            subpath: this.table.dataset.subpath || '',
        });
        this.bindTreeEvents(this.tbody);
        this.initSorting();
        this.initFiltering();
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

    get selectedPaths() {
        return this.selectionManager?.selectedPaths || new Set();
    }

    initMultiSelection() {
        if (typeof SelectionManager === 'undefined') return;
        this.selectionManager = new SelectionManager(this.table, {
            treeTable: this.treeTable,
            tbody: this.tbody,
            getVisibleRows: () => this.getVisibleRows(),
            rootName: this.rootName,
            getSnapshot: () => this.snapshot,
            getFocusedRow: () => this.selectedRow,
        });

        this.selectionManager.registerAction({
            id: 'zip',
            labelKey: 'selection.download_zip',
            label: 'ZIP herunterladen',
            icon: 'archive',
            isDefault: true,
            optionsLabelKey: 'selection.structure',
            optionsLabel: 'Ordnerstruktur',
            options: [
                {
                    id: 'relative',
                    labelKey: 'selection.structure_relative',
                    label: 'Relativ zum aktuellen Ordner (Standard)',
                    default: true,
                },
                {
                    id: 'absolute',
                    labelKey: 'selection.structure_absolute',
                    label: 'Vollständiger Pfad (ab Root)',
                },
                {
                    id: 'flat',
                    labelKey: 'selection.structure_flat',
                    label: 'Flach (alle Dateien im ZIP-Root)',
                },
            ],
            execute: (selectedPaths, ctx) => {
                this.downloadSelectedZip(selectedPaths, ctx.option);
            },
        });
    }

    toggleRowSelection(row, options = {}) {
        this.selectionManager?.toggleRow(row, options);
    }

    selectAllVisible() {
        this.selectionManager?.selectAllVisible();
    }

    clearMultiSelection() {
        this.selectionManager?.clearSelection();
    }

    updateSelectionUI() {
        this.selectionManager?.updateUI();
    }

    downloadSelectedZip(pathsSet = null, structure = 'relative') {
        const paths = pathsSet ? Array.from(pathsSet) : Array.from(this.selectedPaths);
        if (paths.length === 0) return;
        const snapshot = this.snapshot || '';
        const basePath = this.table.dataset.subpath || '';
        const structureVal = structure || 'relative';

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = `/download-zip/${encodeURIComponent(this.rootName)}`;
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
        addField('structure', structureVal);
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
            const topLevelRows = this.treeTable.getChildrenOfPath(baseSubpath);

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
            const expandedRows = this.treeTable.getAllRows().filter((r) => r.dataset.expanded === 'true');
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

                            const children = Array.from(this.treeTable.getChildren(expRow));
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
            const rows = this.treeTable.getAllRows();
            const targetRow = rows.find((r) => {
                const fn = r.dataset.filename;
                const path = r.dataset.path;
                const name = r.children[1]?.dataset?.sort;
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

        return `<svg class="snapshotbar${isSub ? ' is-sub-dataset' : ''}" viewBox="-1 -1 ${totalWidth + 2} 21" preserveAspectRatio="none" style="width: 100%; max-width: ${totalWidth}px; height: 16px;">${inner}${circle}</svg>`;
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

    showSnapshotLoadingOverlay() {
        const overlay = document.getElementById('snapshot-loading-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            // Trigger reflow for clean CSS transition
            void overlay.offsetHeight;
            overlay.classList.remove('fade-out');
            overlay.classList.add('is-visible');
        }
        this.table?.classList.add('is-loading-snapshots');
    }

    hideSnapshotLoadingOverlay() {
        const overlay = document.getElementById('snapshot-loading-overlay');
        if (overlay) {
            overlay.classList.remove('is-visible');
            overlay.classList.add('fade-out');
            setTimeout(() => {
                if (overlay.classList.contains('fade-out')) {
                    overlay.style.display = 'none';
                    overlay.classList.remove('fade-out');
                }
            }, 300);
        }
        this.table?.classList.remove('is-loading-snapshots');
    }

    async loadSnapshotBars(container, dirPath) {
        const skeletons = container.querySelectorAll(
            '.browser-cell-snapshots[data-filename] .snapshot-skeleton, .browser-cell-snapshots[data-filename] .snapshot-skeleton-svg',
        );
        if (skeletons.length === 0) {
            this.hideSnapshotLoadingOverlay();
            return;
        }

        this.initSnapshotObserver();

        try {
            const url = buildRouteUrl('', 'api/snapshot-bars', this.rootName, dirPath, { snapshot: this.snapshot });
            const res = await fetch(url);
            if (!res.ok) {
                this.hideSnapshotLoadingOverlay();
                return;
            }
            const data = await res.json();
            const snapshots = data.snapshots || [];
            const bars = data.bars || {};

            const allRows = this.treeTable.getAllRows();
            const chunkSize = 500;
            let index = 0;

            const processChunk = () => {
                const end = Math.min(index + chunkSize, allRows.length);
                for (; index < end; index++) {
                    const row = allRows[index];
                    const fn = row.dataset.filename;
                    if (!fn || !bars[fn]) continue;

                    const td = row.children[2];
                    if (!td || td._snapshotData) continue;

                    let barStr = '';
                    let itemSnapshots = snapshots;
                    let isSubDataset = td.dataset.isSubDataset === 'true' || row.dataset.isSubDataset === 'true';

                    const barEntry = bars[fn];
                    if (typeof barEntry === 'object' && barEntry.is_sub_dataset) {
                        barStr = barEntry.barStr || '';
                        itemSnapshots = barEntry.snapshots || [];
                        isSubDataset = true;
                        td.dataset.isSubDataset = 'true';
                    } else if (typeof barEntry === 'object') {
                        barStr = barEntry.barStr || '';
                        itemSnapshots = barEntry.snapshots || [];
                    } else {
                        barStr = barEntry || '';
                    }

                    td.dataset.barStr = barStr;
                    td.dataset.isSubDataset = isSubDataset ? 'true' : 'false';

                    // Determine if file/folder changed across snapshots
                    let isUnchanged = false;
                    if (barStr.length > 0 && !barStr.includes('x')) {
                        const firstChar = barStr[0];
                        isUnchanged = true;
                        for (let j = 1; j < barStr.length; j++) {
                            if (barStr[j] !== firstChar) {
                                isUnchanged = false;
                                break;
                            }
                        }
                    }
                    row.dataset.isChanged = isUnchanged ? 'false' : 'true';

                    // Lazy render via IntersectionObserver
                    td._snapshotData = { barStr, snapshots: itemSnapshots, isSubDataset };
                    this.snapshotObserver.observe(td);
                }

                if (index < allRows.length) {
                    requestAnimationFrame(processChunk);
                } else {
                    this.updateZebra();
                    this.updateToggleCounts();
                    this.hideSnapshotLoadingOverlay();
                }
            };

            processChunk();
        } catch (err) {
            console.error('Failed to load snapshot bars:', err);
            this.hideSnapshotLoadingOverlay();
        }
    }

    updateZebra() {
        const hideHidden = this.table.classList.contains('hide-hidden');
        const hideMissing = this.table.classList.contains('hide-missing');
        const hideUnchanged = this.table.classList.contains('hide-unchanged');
        const hasFilterHidden = !!this.tbody.querySelector('tr.filter-hidden');
        const allRows = this.treeTable.getAllRows();
        const hasDisplayNone = allRows.some((row) => row.style.display === 'none');
        const isFiltered = hideHidden || hideMissing || hideUnchanged || hasFilterHidden || hasDisplayNone;

        this.table.classList.toggle('is-filtered', isFiltered);
        if (!isFiltered) {
            allRows.forEach((row) => {
                row.classList.remove('even', 'odd');
            });
            return;
        }

        const visibleRows = this.getVisibleRows();
        for (let i = 0; i < visibleRows.length; i++) {
            const row = visibleRows[i];
            row.classList.toggle('odd', i % 2 === 0);
            row.classList.toggle('even', i % 2 !== 0);
        }
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
            this.selectionManager?.updateUI();
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
                this.selectionManager?.updateUI();
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

                        this.treeTable.indexRows(newRows, row);
                        this.loadSnapshotBars(this.tbody, path);
                        this.selectionManager?.onRowsAdded(newRows);
                    }
                    row.dataset.expanded = 'true';
                    btn.classList.add('opened');

                    this.applyFilter();
                    if (this.currentSort !== null) {
                        this.sortTree();
                    }
                    this.updateZebra();
                    this.updateToggleCounts();
                    this.selectionManager?.updateUI();
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
        const pRow = this.treeTable.getRowByPath(parentPath);
        return pRow ? Array.from(this.treeTable.getChildren(pRow)) : [];
    }

    collapseDescendants(parentPath) {
        const pRow = this.treeTable.getRowByPath(parentPath);
        if (!pRow) return;
        const descendants = this.treeTable.getDescendants(pRow);
        descendants.forEach((row) => {
            row.style.display = 'none';
            row.dataset.expanded = 'false';
            const toggle = row.querySelector('.folder-toggle');
            if (toggle) toggle.classList.remove('opened');
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
        if (typeof FilterManager === 'undefined') return;
        this.filterManager = new FilterManager(this.table, {
            treeTable: this.treeTable,
            tbody: this.tbody,
            onFilterChange: () => {
                const visibleRows = this.getVisibleRows();
                if (this.selectedRow && !visibleRows.includes(this.selectedRow)) {
                    this.selectRow(visibleRows.length > 0 ? visibleRows[0] : null, { updateHash: false });
                }
                this.updateZebra();
                this.updateSelectionUI();
            },
            onSelectRow: (row) => this.selectRow(row),
            onSortColumn: (colIndex, dir) => this.sortByColumnIndex(colIndex, dir),
            collapseDescendants: (path) => this.collapseDescendants(path),
        });
    }

    applyFilter() {
        this.filterManager?.applyFilter();
    }

    isRowInExpandedHierarchy(row) {
        return this.filterManager ? this.filterManager.isRowInExpandedHierarchy(row) : true;
    }

    updateToggleCounts() {
        this.filterManager?.updateToggleCounts();
    }

    getVisibleRows() {
        return this.filterManager ? this.filterManager.getVisibleRows() : this.treeTable.getVisibleRows();
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
            isRowVisible: (row) => {
                if (!row || row.classList.contains('filter-hidden') || row.style.display === 'none') return false;
                if (this.table.classList.contains('hide-hidden') && row.dataset.isHidden === 'true') return false;
                if (this.table.classList.contains('hide-missing') && row.dataset.isMissing === 'true') return false;
                if (this.table.classList.contains('hide-unchanged') && row.dataset.isChanged === 'false') return false;
                return true;
            },
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
                        window.scrollBy({ top: rect.top - totalHeaderOffset - 6, behavior: 'auto' });
                    } else if (rect.bottom > window.innerHeight) {
                        window.scrollBy({ top: rect.bottom - window.innerHeight + 20, behavior: 'auto' });
                    }

                    if (options.updateHash !== false) {
                        const filename =
                            row.dataset.filename || row.querySelector('.browser-cell-name')?.dataset.sort || '';
                        if (filename) {
                            if (this.hashUpdateTimeout) clearTimeout(this.hashUpdateTimeout);
                            this.hashUpdateTimeout = setTimeout(() => {
                                history.replaceState(null, '', '#' + encodeURIComponent(filename));
                            }, 80);
                        }
                    }

                    if (this.selectionManager?.isShiftDown) {
                        this.selectionManager.updateRangePreview(true, row);
                    } else {
                        this.selectionManager?.updateRangePreview(false);
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
            }

            return false;
        });

        // 2. Typeahead Interceptor
        this.keyboard.addInterceptor((e) => this.typeahead?.handleKeyDown(e));

        // 3. FilterManager Interceptor ('/' to focus search)
        this.keyboard.addInterceptor((e) => this.filterManager?.handleKeyDown(e));

        // 4. SelectionManager Interceptor (Space, Shift+Space, Ctrl+A, Escape)
        this.keyboard.addInterceptor((e) => this.selectionManager?.handleKeyDown(e, this.selectedRow));

        // 5. TableSorter Column Sorting Interceptor (Alt+1..Alt+N)
        this.keyboard.addInterceptor((e) => this.sorter?.handleKeyDown(e));

        // Global shortcuts: Path edit (Ctrl+L)
        this.keyboard.register('Ctrl+L', () => {
            if (typeof enableBreadcrumbPathEdit === 'function') enableBreadcrumbPathEdit();
        });

        // Escape: Deselect focused row
        this.keyboard.register('Escape', () => {
            this.selectRow(null);
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
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const table = document.getElementById('filebrowser');
    if (table) {
        window.explorerView = new ExplorerView(table);
        // Alias for backwards compatibility
        window.treeTable = window.explorerView;
    }
});

if (typeof window !== 'undefined') {
    window.ExplorerView = ExplorerView;
}
