function updateThemeIcon() {
    const theme = localStorage.getItem('theme') || 'system';
    const lightIcon = document.querySelector('.icon-light-theme');
    const darkIcon = document.querySelector('.icon-dark-theme');
    const sysIcon = document.querySelector('.icon-system-theme');
    if (lightIcon) lightIcon.style.display = theme === 'light' ? 'inline-flex' : 'none';
    if (darkIcon) darkIcon.style.display = theme === 'dark' ? 'inline-flex' : 'none';
    if (sysIcon) sysIcon.style.display = theme === 'system' ? 'inline-flex' : 'none';
}

function setTheme(theme) {
    if (theme === 'system') {
        localStorage.removeItem('theme');
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    } else {
        localStorage.setItem('theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }
    updateThemeIcon();
}

function toggleShortcutsModal(show) {
    const modal = document.getElementById('shortcuts-modal');
    if (!modal) return;
    const willShow = show !== undefined ? show : modal.style.display === 'none';
    modal.style.display = willShow ? 'flex' : 'none';
}

function enableBreadcrumbPathEdit() {
    const pathView = document.getElementById('breadcrumbs-path-view');
    const pathEdit = document.getElementById('breadcrumbs-path-edit');
    const input = document.getElementById('breadcrumb-path-input');
    if (!pathEdit || !input) return;

    if (pathView) pathView.style.display = 'none';
    pathEdit.style.display = 'inline-flex';
    input.focus();
    input.select();
}

function disableBreadcrumbPathEdit() {
    const pathView = document.getElementById('breadcrumbs-path-view');
    const pathEdit = document.getElementById('breadcrumbs-path-edit');
    if (!pathEdit) return;

    pathEdit.style.display = 'none';
    if (pathView) pathView.style.display = 'inline-flex';
}

function updateStickyOffsets() {
    const topHeader = document.querySelector('.sticky-header-container, .root-header-sticky-container');
    if (topHeader) {
        const h = Math.round(topHeader.getBoundingClientRect().height);
        document.documentElement.style.setProperty('--top-header-height', h + 'px');
        document.documentElement.style.setProperty('--index-top-height', h + 'px');
    }
    const headerRow = document.querySelector(
        'table.filebrowser > thead > tr.header-row, table.filebrowser > thead > tr:first-child',
    );
    if (headerRow) {
        const h = Math.round(headerRow.getBoundingClientRect().height);
        document.documentElement.style.setProperty('--header-row-height', h + 'px');
    }
}

window.addEventListener('resize', updateStickyOffsets);

if (typeof ResizeObserver !== 'undefined') {
    const headerObserver = new ResizeObserver(() => updateStickyOffsets());
    document.addEventListener('DOMContentLoaded', () => {
        const topHeader = document.querySelector('.sticky-header-container, .root-header-sticky-container');
        if (topHeader) headerObserver.observe(topHeader);
        const thead = document.querySelector('table.filebrowser > thead');
        if (thead) headerObserver.observe(thead);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    updateStickyOffsets();
    updateThemeIcon();

    const helpBtn = document.getElementById('shortcuts-help-btn');
    if (helpBtn) {
        helpBtn.addEventListener('click', () => toggleShortcutsModal(true));
    }

    const closeBtn = document.getElementById('shortcuts-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => toggleShortcutsModal(false));
    }

    const modal = document.getElementById('shortcuts-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) toggleShortcutsModal(false);
        });
    }

    const editBtn = document.getElementById('breadcrumb-edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', enableBreadcrumbPathEdit);
    }

    const pathInput = document.getElementById('breadcrumb-path-input');
    if (pathInput) {
        pathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = pathInput.value.trim().replace(/^\/+|\/+$/g, '');
                const rootName = pathInput.dataset.root || '';
                const snapshot = pathInput.dataset.snapshot || '';
                const encodedPath = val ? val.split('/').map(encodeURIComponent).join('/') : '';
                const targetUrl = `/list/${encodeURIComponent(rootName)}/${encodedPath}?snapshot=${encodeURIComponent(snapshot)}`;
                window.location.href = targetUrl;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                disableBreadcrumbPathEdit();
            }
        });

        pathInput.addEventListener('blur', () => {
            setTimeout(disableBreadcrumbPathEdit, 150);
        });
    }
});

function initTimelineTooltips() {
    const timelines = document.querySelectorAll('.snapshots-header-timeline, .error-timeline-bar');
    if (timelines.length === 0) return;
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

    timelines.forEach((timeline) => {
        if (timeline._timelineTooltipsInitialized) return;
        timeline._timelineTooltipsInitialized = true;

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
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTimelineTooltips();
});

if (document.readyState !== 'loading') {
    updateStickyOffsets();
    updateThemeIcon();
    initTimelineTooltips();
}
