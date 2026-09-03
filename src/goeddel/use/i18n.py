from __future__ import annotations

import json
from collections.abc import Callable

from fastapi import Request

# Dictionaries for translations
TRANSLATIONS: dict[str, dict[str, str]] = {
    "en": {
        "theme.system": "System",
        "theme.light": "Light",
        "theme.dark": "Dark",
        "lang.en": "English",
        "lang.de": "German",
        "badge.created": "Created",
        "badge.deleted": "Deleted",
        "badge.missing": "Missing",
        "badge.unmounted": "Unmounted",
        "badge.live": "Live",
        "table.name": "Name",
        "table.size": "Size",
        "table.type": "Type",
        "table.modified": "Modified",
        "table.changed": "Changed",
        "table.timestamp": "Timestamp",
        "table.user": "User",
        "table.group": "Group",
        "table.snapshot": "Snapshot",
        "table.snapshots": "Snapshots",
        "table.actions": "Actions",
        "table.resizer_tooltip": "Drag to resize, double-click to reset",
        "loading.snapshots": "Loading snapshots...",
        "unit.file": "file",
        "unit.files": "files",
        "action.download": "Download",
        "action.refresh": "Refresh",
        "action.show_details": "Show Details",
        "action.show_folder_details": "Show Folder Details",
        "action.open_target": "Go to Target",
        "action.changed_from": "Changed from",
        "action.open_explorer": "Open Explorer",
        "error.folder_not_found": "Folder not found.",
        "error.file_not_found": "File not found.",
        "error.broken_symlink": "Broken Symlink (target does not exist)",
        "error.permission_denied": "Permission denied",
        "error.permission_denied_folder": "Permission denied: No read access for this folder",
        "error.404_title": "404 - Not Found",
        "error.404_folder_msg": 'The folder "{path}" was not found in snapshot "{snapshot}".',
        "error.404_file_msg": 'The file "{path}" was not found in snapshot "{snapshot}".',
        "error.404_root_msg": 'The root filesystem "{root}" was not found.',
        "error.404_generic_msg": "The requested page or resource could not be found.",
        "error.500_title": "Internal Server Error",
        "error.nearest_parent": "Open nearest existing parent folder",
        "error.available_in_snapshots": "This item is available in other snapshots:",
        "error.snapshot_timeline": "Snapshot Timeline (click to switch):",
        "error.go_to_root_folder": "Go to Root folder",
        "error.go_to_roots_overview": "Back to Roots overview",
        "error.requested_path": "Requested path",
        "error.active_snapshot": "Active snapshot",
        "filter.search_placeholder": "Search...",
        "filter.hidden_files": "Hidden files",
        "filter.hidden_files_title": "Show or hide hidden files and folders (dotfiles)",
        "filter.missing_files": "Missing files",
        "filter.missing_files_title": "Show or hide files and folders that do not exist in this snapshot",
        "filter.changed_only": "Changed only",
        "filter.changed_only_title": "Show only files and folders that changed across snapshots",
        "filter.stats_hidden": "hidden",
        "filter.clear": "Clear filter",
        "breadcrumb.root": "Root",
        "snapshot.latest": "Latest",
        "snapshot.current": "Current",
        "snapshot.none": "None",
        "index.title": "Universal Snapshot Explorer - Roots",
        "index.prompt": "Please select a configured filesystem:",
        "index.no_roots": "No roots configured. Please check the configuration file.",
        "index.header.name": "Name",
        "index.header.root_path": "Root Path",
        "index.header.sub_path": "Sub Path",
        "shortcuts.title": "Keyboard Shortcuts",
        "shortcuts.nav_rows": "Navigate rows",
        "shortcuts.jump_page": "Jump page / start / end",
        "shortcuts.expand_folder": "Expand folder",
        "shortcuts.collapse_folder": "Collapse folder / go to parent",
        "shortcuts.enter_action": "Open folder or download file",
        "shortcuts.open_details": "Show file details",
        "shortcuts.go_parent": "Go to parent folder",
        "shortcuts.switch_snapshot": "Switch snapshot (Ctrl+←/→)",
        "shortcuts.sort_column": "Sort column (Ctrl+↑/↓ or Alt+1..8)",
        "shortcuts.focus_filter": "Quick filter search",
        "shortcuts.typeahead": "Quick jump (type name to search)",
        "shortcuts.edit_path": "Edit path location",
        "shortcuts.toggle_select": "Toggle selection checkbox",
        "shortcuts.select_all": "Select all visible rows",
        "shortcuts.refresh": "Flush cache & refresh",
        "shortcuts.close_or_cancel": "Close modal / cancel filter / clear selection",
        "shortcuts.help": "Show keyboard shortcuts",
        "typeahead.match_count": "Match {current} of {total}",
        "typeahead.no_matches": "No matches",
        "typeahead.next_prev": "↑/↓ Switch",
        "typeahead.open": "Enter: Open",
        "typeahead.exit": "Esc: Exit",
        "breadcrumb.edit_path_tooltip": "Click or press Ctrl+L to edit path",
        "breadcrumb.path_placeholder": "Enter subpath and press Enter...",
        "selection.selected_count": "{count} selected",
        "selection.filter_breakdown": "({visible} visible, {hidden} hidden)",
        "selection.download_zip": "Download ZIP",
        "selection.action": "Action",
        "selection.clear": "Clear selection",
        "selection.missing_warning": "{count} files do not exist in this snapshot (will be skipped)",
        "selection.reveal_hidden": "Click to reveal hidden files",
        "selection.select_all_visible": "Select all visible",
        "selection.structure": "Folder structure",
        "selection.structure_relative": "Relative to current folder (Default)",
        "selection.structure_absolute": "Full path from root",
        "selection.structure_flat": "Flat (all files in archive root)",
    },
    "de": {
        "theme.system": "System",
        "theme.light": "Hell",
        "theme.dark": "Dunkel",
        "lang.en": "Englisch",
        "lang.de": "Deutsch",
        "badge.created": "Erstellt",
        "badge.deleted": "Gelöscht",
        "badge.missing": "Fehlt",
        "badge.unmounted": "Nicht eingehängt",
        "badge.live": "Live",
        "table.name": "Name",
        "table.size": "Größe",
        "table.type": "Typ",
        "table.modified": "Geändert",
        "table.changed": "Status geändert",
        "table.timestamp": "Zeitstempel",
        "table.user": "Benutzer",
        "table.group": "Gruppe",
        "table.snapshot": "Snapshot",
        "table.snapshots": "Snapshots",
        "table.actions": "Aktionen",
        "table.resizer_tooltip": "Ziehen zum Anpassen der Spaltenbreite, Doppelklick zum Zurücksetzen",
        "loading.snapshots": "Lade Snapshots...",
        "unit.file": "Datei",
        "unit.files": "Dateien",
        "action.download": "Herunterladen",
        "action.refresh": "Aktualisieren",
        "action.show_details": "Details anzeigen",
        "action.show_folder_details": "Ordnerdetails anzeigen",
        "action.open_target": "Zum Ziel",
        "action.changed_from": "Geändert von",
        "action.open_explorer": "Explorer öffnen",
        "error.folder_not_found": "Ordner nicht gefunden.",
        "error.file_not_found": "Datei nicht gefunden.",
        "error.broken_symlink": "Defekter Symlink (Ziel existiert nicht)",
        "error.permission_denied": "Keine Leseberechtigung",
        "error.permission_denied_folder": "Zugriff verweigert: Keine Leseberechtigung für diesen Ordner",
        "error.404_title": "404 - Nicht gefunden",
        "error.404_folder_msg": "Der Ordner „{path}“ wurde im Snapshot „{snapshot}“ nicht gefunden.",
        "error.404_file_msg": "Die Datei „{path}“ wurde im Snapshot „{snapshot}“ nicht gefunden.",
        "error.404_root_msg": "Das Dateisystem-Root „{root}“ wurde nicht gefunden.",
        "error.404_generic_msg": "Die angeforderte Seite oder Ressource konnte nicht gefunden werden.",
        "error.500_title": "Interner Serverfehler",
        "error.nearest_parent": "Nächsthöheren existierenden Ordner öffnen",
        "error.available_in_snapshots": "In folgenden Snapshots ist dieses Element vorhanden:",
        "error.snapshot_timeline": "Snapshot-Zeitleiste (Klick zum Wechseln):",
        "error.go_to_root_folder": "Zum Stammverzeichnis",
        "error.go_to_roots_overview": "Zurück zur Übersicht",
        "error.requested_path": "Angefragter Pfad",
        "error.active_snapshot": "Aktiver Snapshot",
        "filter.search_placeholder": "Suchen...",
        "filter.hidden_files": "Versteckte Dateien",
        "filter.hidden_files_title": "Versteckte Dateien und Ordner (Dotfiles) ein- oder ausblenden",
        "filter.missing_files": "Fehlende Dateien",
        "filter.missing_files_title": "Dateien und Ordner ein- oder ausblenden, die in diesem Snapshot nicht existieren",
        "filter.changed_only": "Nur geänderte",
        "filter.changed_only_title": "Nur Dateien und Ordner anzeigen, die sich über Snapshots hinweg geändert haben",
        "filter.stats_hidden": "ausgeblendet",
        "filter.clear": "Filter löschen",
        "breadcrumb.root": "Root",
        "snapshot.latest": "Neuester",
        "snapshot.current": "Aktuell",
        "snapshot.none": "Keiner",
        "index.title": "Universal Snapshot Explorer - Roots",
        "index.prompt": "Bitte wähle ein konfiguriertes Dateisystem aus:",
        "index.no_roots": "Keine Roots konfiguriert. Bitte überprüfe die Konfigurationsdatei.",
        "index.header.name": "Name",
        "index.header.root_path": "Root-Pfad",
        "index.header.sub_path": "Sub-Pfad",
        "shortcuts.title": "Tastatur-Kurzbefehle",
        "shortcuts.nav_rows": "Zeilen navigieren",
        "shortcuts.jump_page": "Seitenweise / Anfang / Ende springen",
        "shortcuts.expand_folder": "Ordner aufklappen",
        "shortcuts.collapse_folder": "Ordner zuklappen / zum Elternordner",
        "shortcuts.enter_action": "Ordner öffnen oder Datei herunterladen",
        "shortcuts.open_details": "Datei-Details anzeigen",
        "shortcuts.go_parent": "Zum übergeordneten Ordner wechseln",
        "shortcuts.switch_snapshot": "Snapshot wechseln (Strg+←/→)",
        "shortcuts.sort_column": "Spalte sortieren (Strg+↑/↓ oder Alt+1..8)",
        "shortcuts.focus_filter": "Schnellsuche (Filter)",
        "shortcuts.typeahead": "Schnellsuche (Name tippen zum Springen)",
        "shortcuts.edit_path": "Pfadzeile bearbeiten",
        "shortcuts.toggle_select": "Checkbox an-/abhaken (ohne Suchtext)",
        "shortcuts.select_all": "Alle sichtbaren Zeilen markieren",
        "shortcuts.refresh": "Cache leeren & aktualisieren",
        "shortcuts.close_or_cancel": "Fenster schließen / Filter abbrechen / Auswahl aufheben",
        "shortcuts.help": "Tastaturbefehle anzeigen",
        "typeahead.match_count": "Treffer {current} von {total}",
        "typeahead.no_matches": "Keine Treffer",
        "typeahead.next_prev": "↑/↓ Weiterspringen",
        "typeahead.open": "Enter: Öffnen",
        "typeahead.exit": "Esc: Beenden",
        "breadcrumb.edit_path_tooltip": "Klicken oder Strg+L drücken, um Pfad zu bearbeiten",
        "breadcrumb.path_placeholder": "Pfad eingeben und Enter drücken...",
        "selection.selected_count": "{count} ausgewählt",
        "selection.filter_breakdown": "({visible} sichtbar, {hidden} ausgeblendet)",
        "selection.download_zip": "ZIP herunterladen",
        "selection.action": "Aktion",
        "selection.clear": "Auswahl aufheben",
        "selection.missing_warning": "{count} Dateien in diesem Snapshot nicht vorhanden (werden übersprungen)",
        "selection.reveal_hidden": "Klicken, um ausgeblendete Dateien anzuzeigen",
        "selection.select_all_visible": "Alle sichtbaren auswählen",
        "selection.structure": "Ordnerstruktur",
        "selection.structure_relative": "Relativ zum aktuellen Ordner (Standard)",
        "selection.structure_absolute": "Vollständiger Pfad (ab Root)",
        "selection.structure_flat": "Flach (alle Dateien im ZIP-Root)",
    },
}

DEFAULT_LANG = "en"


def get_language(request: Request) -> str:
    """Extracts the language from the request, either via cookie, query param, or Accept-Language."""
    # Simple extraction for now, defaulting to EN or DE
    # If using FastAPI Request object
    lang = request.query_params.get("lang")
    if lang in TRANSLATIONS:
        return lang

    lang = request.cookies.get("lang")
    if lang in TRANSLATIONS:
        return lang

    accept_language = request.headers.get("accept-language", "")
    if "de" in accept_language.lower():
        return "de"

    return DEFAULT_LANG


def get_translator(lang: str) -> Callable[..., str]:
    """Returns a translation function for the given language."""
    lang_dict = TRANSLATIONS.get(lang, TRANSLATIONS[DEFAULT_LANG])

    def t(key: str, **kwargs: object) -> str:
        text = lang_dict.get(key, TRANSLATIONS[DEFAULT_LANG].get(key, key))
        if kwargs:
            try:
                return text.format(**kwargs)
            except KeyError:
                return text
        return text

    return t


def get_client_translations(lang: str) -> str:
    """Returns a JSON string of translations for the client side."""
    return json.dumps(TRANSLATIONS.get(lang, TRANSLATIONS[DEFAULT_LANG]))
