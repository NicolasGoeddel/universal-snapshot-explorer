#!/usr/bin/env python3
"""Generate a Markdown map of the JavaScript source code."""
import re
from pathlib import Path

def generate_js_map(src_dir: str, out_file: str):
    src_path = Path(src_dir)
    map_lines = ["# Frontend JavaScript Architecture Map\n"]
    
    # Regex-Muster für saubere Vanilla JS Signaturen
    patterns = [
        r"^(?:export\s+)?(?:default\s+)?class\s+\w+.*",                         # Klassen
        r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+\s*\(.*?\)", # Normale Funktionen
        r"^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(.*?\)\s*=>"           # Arrow Functions
    ]
    combined_regex = re.compile("|".join(patterns), re.MULTILINE)

    for js_file in src_path.rglob("*.js"):
        content = js_file.read_text(encoding="utf-8")
        signatures = combined_regex.findall(content)
        
        if signatures:
            # Wir nutzen deinen exakten Pfad für die relative Ausgabe
            map_lines.append(f"## File: `{js_file.relative_to(src_path.parents[3])}`\n```javascript")
            for sig in signatures:
                map_lines.append(f"{sig.strip()} {{ ... }}")
            map_lines.append("```\n")

    Path(out_file).write_text("\n".join(map_lines), encoding="utf-8")
    print(f"✅ JS Map generiert: {out_file}")

if __name__ == "__main__":
    generate_js_map("src/goeddel/use/static/js", "docs/MAP_JS.md")