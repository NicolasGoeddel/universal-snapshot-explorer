/**
 * Path bar (breadcrumbs.html.j2) behaviour:
 *  - each `.path-chevron` between path segments opens a menu listing that folder's
 *    subfolders (fetched from /api/snapshot-state), while clicking the segment's name still
 *    navigates to it. A chevron with `data-menu-template` instead shows that server-rendered
 *    <template>'s items (the home chevron's list of roots).
 *  - once a menu is open, hovering another chevron switches to its menu.
 *  - clicking the empty area of the path line switches to the editable path input.
 *
 * The API and child URLs are derived from the segment link's current href rather than
 * from data attributes, so they follow explorer.js when it swaps the snapshot in place.
 */
class PathBar {
    constructor(nav) {
        this.nav = nav;
        this.menu = null;
        this.openChevron = null;
        this.cache = new Map();
        this.requestSeq = 0;

        nav.querySelectorAll('.path-chevron').forEach((chevron) => {
            chevron.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.openChevron === chevron) {
                    this.close();
                } else {
                    // e.detail === 0 means keyboard activation (Enter/Space): move focus into the menu.
                    this.open(chevron, e.detail === 0);
                }
            });
            chevron.addEventListener('mouseenter', () => {
                if (this.openChevron && this.openChevron !== chevron) this.open(chevron, false);
            });
            chevron.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.open(chevron, true);
                }
            });
        });

        const container = nav.querySelector('#breadcrumbs-path-container');
        if (container && nav.querySelector('#breadcrumbs-path-edit')) {
            container.addEventListener('click', (e) => {
                const blank = e.target === container || e.target.id === 'breadcrumbs-path-view';
                if (blank && typeof enableBreadcrumbPathEdit === 'function') enableBreadcrumbPathEdit();
            });
        }

        document.addEventListener('mousedown', (e) => {
            if (!this.openChevron) return;
            if (this.menu.contains(e.target) || this.openChevron.contains(e.target)) return;
            this.close();
        });
        window.addEventListener('resize', () => this.close());
        window.addEventListener('scroll', () => this.close());
    }

    t(key, fallback) {
        return window.clientI18n?.[key] || fallback;
    }

    ensureMenu() {
        if (this.menu) return this.menu;
        const menu = document.createElement('div');
        menu.className = 'path-menu';
        menu.setAttribute('role', 'menu');
        menu.addEventListener('keydown', (e) => this.onMenuKeyDown(e));
        document.body.appendChild(menu);
        this.menu = menu;
        return menu;
    }

    /** Resolves the segment link preceding a chevron into its list URL (without #hash). */
    segmentUrl(chevron) {
        const link = chevron.parentElement.querySelector('a.path-crumb');
        if (!link) return null;
        const u = new URL(link.href, window.location.origin);
        u.hash = '';
        return u;
    }

    async open(chevron, focusMenu) {
        const template = chevron.dataset.menuTemplate
            ? document.getElementById(chevron.dataset.menuTemplate)
            : null;
        const segUrl = template ? null : this.segmentUrl(chevron);
        if (!template && !segUrl) return;

        if (this.openChevron) this.setChevronState(this.openChevron, false);
        this.openChevron = chevron;
        this.setChevronState(chevron, true);

        const menu = this.ensureMenu();
        menu.classList.add('visible');

        if (template) {
            this.requestSeq++; // drop any subfolder request still in flight
            menu.replaceChildren(template.content.cloneNode(true));
            this.showLoaded(chevron, focusMenu);
            return;
        }

        menu.innerHTML = `<div class="path-menu-status"><span class="path-menu-spinner"></span></div>`;
        this.position(chevron);

        const apiUrl = segUrl.pathname.replace(/^\/list\//, '/api/snapshot-state/') + segUrl.search;
        const seq = ++this.requestSeq;
        let folders;
        try {
            if (!this.cache.has(apiUrl)) {
                const res = await fetch(apiUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const state = await res.json();
                if (!state.folder_exists) throw new Error('Folder does not exist in this snapshot');
                // Entries come sorted folders-first; keep real subfolders present in this snapshot.
                const folderEntries = Object.entries(state.entries || {}).filter(
                    ([, e]) => e.does_exist && e.is_folder && !e.is_symlink,
                );
                this.cache.set(
                    apiUrl,
                    folderEntries.map(([name, e]) => ({ name, accessible: e.is_accessible !== false })),
                );
            }
            folders = this.cache.get(apiUrl);
        } catch (err) {
            console.error('[PathBar] Failed loading subfolders:', err);
            folders = null;
        }
        // Another chevron was opened (or the menu closed) while this request was in flight.
        if (seq !== this.requestSeq || this.openChevron !== chevron) return;

        this.render(chevron, segUrl, folders);
        this.showLoaded(chevron, focusMenu);
    }

    /** Final positioning once the menu holds its items; keyboard openers get focus inside. */
    showLoaded(chevron, focusMenu) {
        const menu = this.menu;
        this.position(chevron);
        menu.querySelector('.path-menu-item.active')?.scrollIntoView({ block: 'nearest' });
        if (focusMenu) {
            const target = menu.querySelector('.path-menu-item.active') || menu.querySelector('.path-menu-item');
            target?.focus();
        }
    }

    render(chevron, segUrl, folders) {
        const menu = this.menu;
        menu.innerHTML = '';

        if (folders === null || folders.length === 0) {
            const status = document.createElement('div');
            status.className = 'path-menu-status';
            status.textContent =
                folders === null
                    ? this.t('breadcrumb.subfolders_error', 'Could not read this folder')
                    : this.t('breadcrumb.no_subfolders', 'No subfolders');
            menu.appendChild(status);
            return;
        }

        // The folder already shown in the next segment is highlighted.
        const nextSeg = chevron.closest('.path-seg')?.nextElementSibling;
        const nextName = nextSeg?.querySelector('.path-crumb')?.getAttribute('title') ?? null;

        const base = segUrl.pathname.includes('/-/') ? `${segUrl.pathname}/` : `${segUrl.pathname}/-/`;
        const iconTpl = document.getElementById('path-menu-folder-icon');
        const frag = document.createDocumentFragment();
        folders.forEach(({ name, accessible }) => {
            const item = document.createElement('a');
            item.className = 'path-menu-item';
            item.setAttribute('role', 'menuitem');
            item.href = base + encodeURIComponent(name) + segUrl.search;
            if (name === nextName) item.classList.add('active');
            if (name.startsWith('.')) item.classList.add('is-hidden');
            if (!accessible) item.classList.add('is-denied');
            if (iconTpl) item.appendChild(iconTpl.content.cloneNode(true));
            const label = document.createElement('span');
            label.textContent = name;
            item.appendChild(label);
            item.title = name;
            frag.appendChild(item);
        });
        menu.appendChild(frag);
    }

    position(chevron) {
        const menu = this.menu;
        const r = chevron.getBoundingClientRect();
        const margin = 8;
        menu.style.top = `${Math.round(r.bottom + 4)}px`;
        menu.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 4 - margin)}px`;
        const maxLeft = window.innerWidth - menu.offsetWidth - margin;
        menu.style.left = `${Math.round(Math.max(margin, Math.min(r.left - 6, maxLeft)))}px`;
    }

    setChevronState(chevron, open) {
        chevron.classList.toggle('open', open);
        chevron.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    close(restoreFocus = false) {
        if (!this.openChevron) return;
        const chevron = this.openChevron;
        this.setChevronState(chevron, false);
        this.openChevron = null;
        this.requestSeq++;
        this.menu?.classList.remove('visible');
        if (restoreFocus) chevron.focus();
    }

    onMenuKeyDown(e) {
        // Keep the explorer's global row navigation / shortcuts out of the menu.
        e.stopPropagation();
        const items = [...this.menu.querySelectorAll('.path-menu-item')];
        const idx = items.indexOf(document.activeElement);
        const focusAt = (i) => items[(i + items.length) % items.length]?.focus();

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                focusAt(idx + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                focusAt(idx - 1);
                break;
            case 'Home':
                e.preventDefault();
                focusAt(0);
                break;
            case 'End':
                e.preventDefault();
                focusAt(items.length - 1);
                break;
            case 'Escape':
                e.preventDefault();
                this.close(true);
                break;
            case 'Tab':
                this.close(true);
                e.preventDefault();
                break;
            default:
                // Type-to-jump: cycle through items starting with the typed character.
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    const ch = e.key.toLowerCase();
                    for (let step = 1; step <= items.length; step++) {
                        const cand = items[(idx + step) % items.length];
                        if (cand.textContent.trim().toLowerCase().startsWith(ch)) {
                            cand.focus();
                            break;
                        }
                    }
                }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('nav.pathbar');
    if (nav) window.pathBar = new PathBar(nav);
});
