/**
 * Universal Snapshot Explorer (USE) - Column Filter Strategies
 *
 * Provides parsers and evaluators for advanced filtering by column type.
 * Each strategy exposes a compile() method that parses the query and returns
 * a highly optimized O(1) evaluator function.
 */

class TextFilterStrategy {
    compile(query) {
        if (query.includes('*')) {
            const regexStr =
                '^' +
                query
                    .split('*')
                    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                    .join('.*') +
                '$';
            try {
                const regex = new RegExp(regexStr, 'i');
                return {
                    isValid: true,
                    evaluate: (_dataSort, textContent) => regex.test(textContent),
                };
            } catch (_e) {
                return { isValid: false, evaluate: () => false };
            }
        } else {
            const lowerQuery = query.toLowerCase();
            return {
                isValid: true,
                evaluate: (_dataSort, textContent) => textContent.includes(lowerQuery),
            };
        }
    }
}

class SizeFilterStrategy {
    compile(query) {
        query = query.toLowerCase().trim();
        if (query === '') return { isValid: true, evaluate: () => true };

        const parseSize = (str) => {
            const match = str.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgtpe]?b)?$/);
            if (!match) return null;
            const num = parseFloat(match[1]);
            const suffix = match[2];
            if (!suffix || suffix === 'b') return num;
            const multipliers = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5, eb: 1024 ** 6 };
            return num * (multipliers[suffix] || 1);
        };

        // Range ..
        if (query.includes('..')) {
            const parts = query.split('..');
            if (parts.length === 2) {
                const min = parseSize(parts[0]);
                const max = parseSize(parts[1]);
                if (min !== null && max !== null && min <= max) {
                    return {
                        isValid: true,
                        evaluate: (dataSort) => {
                            const val = parseFloat(dataSort);
                            return !Number.isNaN(val) && val >= min && val <= max;
                        },
                    };
                }
            }
            return { isValid: false, evaluate: () => false };
        }

        // Operators
        const match = query.match(/^(<=|>=|<|>|==)?\s*(.+)$/);
        if (match) {
            const op = match[1] || '==';
            const val = parseSize(match[2]);
            if (val !== null) {
                return {
                    isValid: true,
                    evaluate: (dataSort) => {
                        const num = parseFloat(dataSort);
                        if (Number.isNaN(num)) return false;
                        if (op === '<') return num < val;
                        if (op === '<=') return num <= val;
                        if (op === '>') return num > val;
                        if (op === '>=') return num >= val;
                        return num === val;
                    },
                };
            }
        }

        return { isValid: false, evaluate: () => false };
    }
}

class ModeFilterStrategy {
    compile(query) {
        query = query.toLowerCase().trim();
        if (query === '') return { isValid: true, evaluate: () => true };

        // Octal wildcard: e.g., 64?
        if (/^[0-7?]{1,4}$/.test(query)) {
            // Pad to 4 digits for data-sort comparison (e.g. 0644) if missing leading 0
            let q = query;
            if (q.length === 3) q = `0${q}`;
            if (q.length === 4) {
                const regexStr = `^${q.replace(/\?/g, '.')}$`;
                const regex = new RegExp(regexStr);
                return {
                    isValid: true,
                    evaluate: (dataSort) => {
                        return regex.test(dataSort);
                    },
                };
            }
        }

        // Group/User specific: g:x, u:rw
        if (/^[ugo]:[rwx]+$/.test(query)) {
            const entity = query[0];
            const perms = query.split(':')[1];
            const permsMap = { 0: '', 1: 'x', 2: 'w', 3: 'wx', 4: 'r', 5: 'rx', 6: 'rw', 7: 'rwx' };

            return {
                isValid: true,
                evaluate: (dataSort) => {
                    // dataSort is the octal string, e.g. "0755" or "755" or "100644"
                    if (!dataSort || dataSort.length < 3) return false;
                    let targetDigit = '0';
                    if (entity === 'u') targetDigit = dataSort.charAt(dataSort.length - 3);
                    if (entity === 'g') targetDigit = dataSort.charAt(dataSort.length - 2);
                    if (entity === 'o') targetDigit = dataSort.charAt(dataSort.length - 1);

                    const targetPerms = permsMap[targetDigit] || '';
                    for (const p of perms) {
                        if (!targetPerms.includes(p)) return false;
                    }
                    return true;
                },
            };
        }

        // Standard string match
        return {
            isValid: true,
            evaluate: (dataSort, textContent) => {
                return dataSort?.includes(query) || textContent?.includes(query);
            },
        };
    }
}

class DateFilterStrategy {
    compile(query) {
        query = query.toLowerCase().trim();
        if (query === '') return { isValid: true, evaluate: () => true };

        const parseDate = (str) => {
            str = str.trim();
            if (str === 'today') {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                return d;
            }
            if (str === 'yesterday') {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                d.setHours(0, 0, 0, 0);
                return d;
            }

            // YYYY-MM
            if (/^\d{4}-\d{2}$/.test(str)) {
                return new Date(`${str}-01T00:00:00`);
            }

            // YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
                return new Date(`${str}T00:00:00`);
            }

            // YYYY-MM-DD HH:MM
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(str)) {
                return new Date(`${str.replace(' ', 'T')}:00`);
            }

            return null;
        };

        const getBoundary = (dateStr, isUpper) => {
            const base = parseDate(dateStr);
            if (!base) return null;
            if (/^\d{4}-\d{2}$/.test(dateStr)) {
                if (isUpper) {
                    base.setMonth(base.getMonth() + 1);
                    base.setMilliseconds(base.getMilliseconds() - 1);
                }
                return base;
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr === 'today' || dateStr === 'yesterday') {
                if (isUpper) {
                    base.setDate(base.getDate() + 1);
                    base.setMilliseconds(base.getMilliseconds() - 1);
                }
                return base;
            }
            return base; // exact time
        };

        // Time only >13:00
        const timeOnlyMatch = query.match(/^(<|>|<=|>=|==)?\s*(\d{2}:\d{2})$/);
        if (timeOnlyMatch) {
            const op = timeOnlyMatch[1] || '==';
            const timeStr = timeOnlyMatch[2];
            const [h, m] = timeStr.split(':').map(Number);
            const refMinutes = h * 60 + m;
            return {
                isValid: true,
                evaluate: (dataSort) => {
                    if (!dataSort) return false;
                    const d = new Date(dataSort);
                    if (Number.isNaN(d.getTime())) return false;
                    const minutes = d.getHours() * 60 + d.getMinutes();
                    if (op === '<') return minutes < refMinutes;
                    if (op === '<=') return minutes <= refMinutes;
                    if (op === '>') return minutes > refMinutes;
                    if (op === '>=') return minutes >= refMinutes;
                    return minutes === refMinutes;
                },
            };
        }

        // Range ..
        if (query.includes('..')) {
            const parts = query.split('..');
            if (parts.length === 2) {
                const min = getBoundary(parts[0], false);
                const max = getBoundary(parts[1], true);
                if (min !== null && max !== null && min <= max) {
                    const minTime = min.getTime();
                    const maxTime = max.getTime();
                    return {
                        isValid: true,
                        evaluate: (dataSort) => {
                            if (!dataSort) return false;
                            const d = new Date(dataSort).getTime();
                            return !Number.isNaN(d) && d >= minTime && d <= maxTime;
                        },
                    };
                }
            }
            return { isValid: false, evaluate: () => false };
        }

        // Operators
        const match = query.match(/^(<=|>=|<|>|==)?\s*(.+)$/);
        if (match) {
            const op = match[1] || '==';
            const valStr = match[2];

            const exactVal = parseDate(valStr);
            if (exactVal !== null) {
                if (op === '<') {
                    const bound = getBoundary(valStr, false);
                    return {
                        isValid: true,
                        evaluate: (dataSort) => {
                            const d = new Date(dataSort).getTime();
                            return !Number.isNaN(d) && d < bound.getTime();
                        },
                    };
                }
                if (op === '<=') {
                    const bound = getBoundary(valStr, true);
                    return {
                        isValid: true,
                        evaluate: (dataSort) => {
                            const d = new Date(dataSort).getTime();
                            return !Number.isNaN(d) && d <= bound.getTime();
                        },
                    };
                }
                if (op === '>') {
                    const bound = getBoundary(valStr, true);
                    return {
                        isValid: true,
                        evaluate: (dataSort) => {
                            const d = new Date(dataSort).getTime();
                            return !Number.isNaN(d) && d > bound.getTime();
                        },
                    };
                }
                if (op === '>=') {
                    const bound = getBoundary(valStr, false);
                    return {
                        isValid: true,
                        evaluate: (dataSort) => {
                            const d = new Date(dataSort).getTime();
                            return !Number.isNaN(d) && d >= bound.getTime();
                        },
                    };
                }

                // exact match implies within boundary
                const min = getBoundary(valStr, false).getTime();
                const max = getBoundary(valStr, true).getTime();
                return {
                    isValid: true,
                    evaluate: (dataSort) => {
                        const d = new Date(dataSort).getTime();
                        return !Number.isNaN(d) && d >= min && d <= max;
                    },
                };
            }
        }

        return { isValid: false, evaluate: () => false };
    }
}

window.FilterStrategies = {
    text: new TextFilterStrategy(),
    size: new SizeFilterStrategy(),
    mode: new ModeFilterStrategy(),
    date: new DateFilterStrategy(),
};
