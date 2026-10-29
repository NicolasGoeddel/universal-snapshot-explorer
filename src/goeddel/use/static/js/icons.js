/** A Lucide icon, as an element the icon stylesheet draws. */
function lucideIcon(name, size, className) {
    const classes = className ? `ico i-${name} s${size} ${className}` : `ico i-${name} s${size}`;
    return `<i class="${classes}"></i>`;
}
