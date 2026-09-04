/**
 * SnapshotCriteriaManager
 * Manages the UI dropdown and selection state of metadata attributes
 * that trigger color changes in snapshot bars.
 */
class SnapshotCriteriaManager {
    static ALL_ATTRIBUTES = ['size', 'mtime', 'ctime', 'mode', 'owner'];
    static STORAGE_KEY = 'use-snapshot-criteria';

    constructor(options = {}) {
        this.container = options.container || document.querySelector('.snapshot-criteria-dropdown');
        this.button = this.container?.querySelector('.criteria-dropdown-btn');
        this.content = this.container?.querySelector('.criteria-dropdown-content');
        this.badge = this.container?.querySelector('.criteria-badge');
        this.checkboxes = this.container ? Array.from(this.container.querySelectorAll('.criteria-checkbox')) : [];
        this.resetBtn = this.container?.querySelector('.criteria-reset-btn');
        this.onChange = typeof options.onChange === 'function' ? options.onChange : null;

        this.activeAttributes = this.loadFromStorage();
        this.initUI();
        this.bindEvents();
    }

    loadFromStorage() {
        try {
            const raw = localStorage.getItem(SnapshotCriteriaManager.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const valid = parsed.filter((attr) => SnapshotCriteriaManager.ALL_ATTRIBUTES.includes(attr));
                    if (valid.length > 0) return valid;
                }
            }
        } catch (_e) {}
        return [...SnapshotCriteriaManager.ALL_ATTRIBUTES];
    }

    saveToStorage(attrs) {
        try {
            localStorage.setItem(SnapshotCriteriaManager.STORAGE_KEY, JSON.stringify(attrs));
        } catch (_e) {}
    }

    initUI() {
        this.checkboxes.forEach((cb) => {
            const attr = cb.dataset.attr;
            if (attr) {
                cb.checked = this.activeAttributes.includes(attr);
            }
        });
        this.updateBadge();
    }

    updateBadge() {
        if (!this.badge) return;
        const total = SnapshotCriteriaManager.ALL_ATTRIBUTES.length;
        const active = this.activeAttributes.length;
        if (active < total) {
            this.badge.textContent = String(active);
            this.badge.style.display = 'inline-flex';
            this.button?.classList.add('has-custom-criteria');
        } else {
            this.badge.style.display = 'none';
            this.button?.classList.remove('has-custom-criteria');
        }
    }

    bindEvents() {
        if (!this.container || !this.button || !this.content) return;

        // Toggle dropdown on button click
        this.button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Prevent click inside content from closing dropdown
        this.content.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (this.container && !this.container.contains(e.target)) {
                this.closeDropdown();
            }
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                this.closeDropdown();
                this.button?.focus();
            }
        });

        // Checkbox change handlers
        this.checkboxes.forEach((cb) => {
            cb.addEventListener('change', () => {
                const checked = this.checkboxes
                    .filter((c) => c.checked)
                    .map((c) => c.dataset.attr)
                    .filter(Boolean);

                // Prevent deselecting all criteria
                if (checked.length === 0) {
                    cb.checked = true;
                    return;
                }

                this.activeAttributes = checked;
                this.saveToStorage(this.activeAttributes);
                this.updateBadge();
                this.notifyChange();
            });
        });

        // Reset button
        if (this.resetBtn) {
            this.resetBtn.addEventListener('click', () => {
                this.activeAttributes = [...SnapshotCriteriaManager.ALL_ATTRIBUTES];
                this.checkboxes.forEach((cb) => {
                    cb.checked = true;
                });
                this.saveToStorage(this.activeAttributes);
                this.updateBadge();
                this.notifyChange();
            });
        }
    }

    isOpen() {
        return this.container ? this.container.classList.contains('open') : false;
    }

    toggleDropdown() {
        if (this.isOpen()) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        this.container?.classList.add('open');
    }

    closeDropdown() {
        this.container?.classList.remove('open');
    }

    notifyChange() {
        if (this.onChange) {
            this.onChange(this.activeAttributes);
        }
    }

    getActiveAttributes() {
        return [...this.activeAttributes];
    }
}

window.SnapshotCriteriaManager = SnapshotCriteriaManager;
