/** A Lucide icon, as an element the icon stylesheet draws. */
function lucideIcon(name, size, className) {
    return `<i class="ico i-${name} s${size}${className ? ` ${className}` : ''}"></i>`;
}
