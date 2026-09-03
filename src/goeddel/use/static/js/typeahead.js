/**
 * Universal Snapshot Explorer (USE) - TypeaheadHUD
 *
 * Standalone, self-contained prefix/jump-to-name Typeahead HUD overlay supporting:
 *  1. Typing alphanumeric characters to search and jump to matching rows.
 *  2. Multi-match navigation cycling (<kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>Tab</kbd>, <kbd>Shift+Tab</kbd>).
 *  3. Dynamic floating HUD badge with match counter (`Treffer 2 von 5`).
 *  4. Integration with KeyboardNavigator interceptor chain.
 *  5. Substring fallback matching if no prefix matches exist.
 */

class TypeaheadHUD {
    /**
     * Initialize the Typeahead HUD on a target table element.
     *
     * @param {HTMLTableElement|string} table - Table DOM element or element ID string.
     * @param {Object} [options={}] - Configuration options.
     * @param {HTMLElement} [options.tbody] - Custom <tbody> element (defaults to table.querySelector('tbody')).
     * @param {function(): Array<HTMLTableRowElement>} [options.getRows] - Function returning list of searchable visible rows.
     * @param {function(HTMLTableRowElement): string} [options.getSearchText] - Extractor for row's search string.
     * @param {function(HTMLTableRowElement): void} [options.onSelect] - Callback when a matching row is selected.
     */
    constructor(table, options = {}) {
        this.table = typeof table === 'string' ? document.getElementById(table) : table;
        if (!this.table) {
            console.error('[TypeaheadHUD] Initialization failed: No table element provided.', table);
            return;
        }
        this.tbody = options.tbody || this.table.querySelector('tbody');
        if (!this.tbody) {
            console.error('[TypeaheadHUD] Initialization failed: Table has no <tbody> element.', this.table);
            return;
        }

        this.getRows =
            options.getRows ||
            (() => {
                return Array.from(this.tbody.querySelectorAll('tr:not([style*="display: none"])'));
            });
        this.getSearchText = options.getSearchText || ((row) => row.textContent.trim());
        this.onSelect = options.onSelect || null;

        this.active = false;
        this.query = '';
        this.matches = [];
        this.matchIndex = -1;
        this.hud = null;

        this.init();
    }

    /**
     * Create HUD overlay element and bind global click-outside dismissal.
     */
    init() {
        document.addEventListener('click', (e) => {
            if (!this.active) return;
            if (!e.target.closest('#typeahead-hud') && !e.target.closest('table')) {
                this.close();
            }
        });
    }

    /**
     * Escape HTML special characters for safe rendering.
     *
     * @param {string} str - Raw input string.
     * @returns {string} Sanitized string.
     */
    escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Create or update the floating HUD widget in the DOM.
     */
    renderHud() {
        if (!this.hud) {
            let existing = document.getElementById('typeahead-hud');
            if (!existing) {
                existing = document.createElement('div');
                existing.id = 'typeahead-hud';
                existing.className = 'typeahead-hud';
                document.body.appendChild(existing);
            }
            this.hud = existing;
        }

        if (!this.active || !this.query) {
            this.hud.classList.remove('visible');
            return;
        }

        const count = this.matches.length;
        const current = count > 0 ? this.matchIndex + 1 : 0;
        const i18n = window.clientI18n || {};

        let statusHtml = '';
        if (count > 0) {
            const matchPattern = i18n['typeahead.match_count'] || 'Treffer {current} von {total}';
            const matchText = matchPattern.replace('{current}', String(current)).replace('{total}', String(count));
            statusHtml = `
                <span class="typeahead-hud-status">${this.escapeHtml(matchText)}</span>
                <span class="typeahead-hud-badge">${this.escapeHtml(i18n['typeahead.next_prev'] || '↑/↓ Wechseln')}</span>
                <span class="typeahead-hud-badge">${this.escapeHtml(i18n['typeahead.open'] || 'Enter: Öffnen')}</span>
                <span class="typeahead-hud-badge">${this.escapeHtml(i18n['typeahead.exit'] || 'Esc: Beenden')}</span>
            `;
        } else {
            statusHtml = `
                <span class="typeahead-hud-status typeahead-hud-no-match">${this.escapeHtml(i18n['typeahead.no_matches'] || 'Keine Treffer')}</span>
                <span class="typeahead-hud-badge">${this.escapeHtml(i18n['typeahead.exit'] || 'Esc: Beenden')}</span>
            `;
        }

        this.hud.innerHTML = `
            <div class="typeahead-hud-query-wrap">
                <span>🔍</span>
                <span class="typeahead-hud-query">${this.escapeHtml(this.query)}</span>
            </div>
            ${statusHtml}
        `;
        this.hud.classList.add('visible');
    }

    /**
     * Append a character to the query, update match results, and select matching row.
     *
     * @param {string} char - Character to append.
     */
    handleChar(char) {
        this.active = true;
        this.query += char;
        this.updateMatches();
    }

    /**
     * Recalculate matches for current query and select active match.
     */
    updateMatches() {
        const q = this.query.toLowerCase();
        const visibleRows = this.getRows();
        const prefixMatches = [];
        const containsMatches = [];

        visibleRows.forEach((row) => {
            const rawName = this.getSearchText(row);
            const name = String(rawName).toLowerCase();
            const parts = name.split(/[/\s_-]+/);
            const isPrefix = name.startsWith(q) || parts.some((p) => p.startsWith(q));
            if (isPrefix) {
                prefixMatches.push(row);
            } else if (name.includes(q)) {
                containsMatches.push(row);
            }
        });

        this.matches = prefixMatches.length > 0 ? prefixMatches : containsMatches;

        if (this.matches.length > 0) {
            this.matchIndex = 0;
            if (typeof this.onSelect === 'function') {
                this.onSelect(this.matches[this.matchIndex]);
            }
        } else {
            this.matchIndex = -1;
        }

        this.renderHud();
    }

    /**
     * Cycle through matches by a given direction (+1 or -1).
     *
     * @param {number} direction - +1 for next match, -1 for previous match.
     */
    step(direction) {
        if (!this.matches || this.matches.length === 0) return;
        this.matchIndex = (this.matchIndex + direction + this.matches.length) % this.matches.length;
        if (typeof this.onSelect === 'function') {
            this.onSelect(this.matches[this.matchIndex]);
        }
        this.renderHud();
    }

    /**
     * Delete the last typed character or close HUD if empty.
     */
    backspace() {
        if (!this.active) return;
        this.query = this.query.slice(0, -1);
        if (!this.query) {
            this.close();
        } else {
            this.updateMatches();
        }
    }

    /**
     * Close HUD overlay and reset typeahead state.
     */
    close() {
        this.active = false;
        this.query = '';
        this.matches = [];
        this.matchIndex = -1;
        if (this.hud) {
            this.hud.classList.remove('visible');
        }
    }

    /**
     * Whether typeahead is currently active.
     *
     * @returns {boolean}
     */
    isActive() {
        return this.active;
    }

    /**
     * Event interceptor function to plug directly into KeyboardNavigator.addInterceptor().
     *
     * @param {KeyboardEvent} e - Keyboard event.
     * @returns {boolean} True if the event was consumed by typeahead.
     */
    handleKeyDown(e) {
        const activeElem = document.activeElement;
        const activeTag = activeElem ? activeElem.tagName.toLowerCase() : '';
        const isTextInput =
            (activeTag === 'input' &&
                activeElem.type !== 'checkbox' &&
                activeElem.type !== 'radio' &&
                activeElem.type !== 'button') ||
            activeTag === 'textarea' ||
            activeTag === 'select';
        if (isTextInput) return false;

        // If active, handle special control keys
        if (this.active) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
                return true;
            }
            if (e.key === 'Backspace') {
                e.preventDefault();
                this.backspace();
                return true;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                this.step(e.shiftKey ? -1 : 1);
                return true;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.step(1);
                return true;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.step(-1);
                return true;
            }
            if (e.key === ' ') {
                e.preventDefault();
                this.handleChar(' ');
                return true;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                this.close();
                return false; // let Enter proceed to open folder/file
            }
        }

        // Printable alphanumeric characters (exclude modifiers and exclude Shift when not active)
        if (
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            e.key.length === 1 &&
            (this.active || (!e.shiftKey && e.key !== ' '))
        ) {
            e.preventDefault();
            this.handleChar(e.key);
            return true;
        }

        return false;
    }
}

window.TypeaheadHUD = TypeaheadHUD;
