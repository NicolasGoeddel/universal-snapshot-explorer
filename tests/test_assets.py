from __future__ import annotations

import os
import re
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from goeddel.use.app import app
from goeddel.use.utils.assets import bundle, bundle_paths, script_tags, stylesheet_tags


class TestAssets(unittest.TestCase):
    def test_bundle_holds_each_file_minified_in_order(self) -> None:
        css = bundle("css", ["css/main.css", "css/filter.css"]).content
        self.assertNotIn("/*", css)
        self.assertLess(css.index(".toolbar-caret"), css.index(".toolbar-toggle-icon"))
        js = bundle("js", ["js/theme.js", "js/path_bar.js"]).content
        self.assertLess(js.index("function setTheme"), js.index("PathBar"))

    def test_bundle_paths_only_name_static_files_of_the_kind(self) -> None:
        self.assertEqual(bundle_paths("js", "js/theme.js,js/plugins/text_differ.js"), ("js/theme.js", "js/plugins/text_differ.js"))
        for kind, files in (
            ("js", "js/../css/main.css"),
            ("js", "css/main.css"),
            ("css", "css/missing.css"),
            ("js", "/etc/passwd"),
            ("css", "css/../../app.py"),
        ):
            self.assertIsNone(bundle_paths(kind, files), files)

    def test_tags_bundle_unless_debugging(self) -> None:
        with patch.dict(os.environ, {"USE_DEBUG_ASSETS": ""}):
            scripts = str(script_tags(["js/theme.js", "js/table_resizer.js", "js/path_bar.js"], ["js/table_resizer.js"]))
            styles = str(stylesheet_tags(["css/main.css", "css/typeahead.css"], ["css/typeahead.css"]))
        # Blocking scripts first: deferred ones run after parsing anyway
        self.assertRegex(scripts, r'^<script src="/bundle\.js\?files=js/table_resizer\.js&amp;v=\w+"></script>\n')
        self.assertRegex(scripts, r'<script src="/bundle\.js\?files=js/theme\.js,js/path_bar\.js&amp;v=\w+" defer></script>$')
        self.assertRegex(styles, r'<link rel="stylesheet" href="/bundle\.css\?files=css/typeahead\.css&amp;v=\w+" media="print"')

        with patch.dict(os.environ, {"USE_DEBUG_ASSETS": "1"}):
            scripts = str(script_tags(["js/theme.js", "js/table_resizer.js"], ["js/table_resizer.js"]))
        self.assertEqual(len(re.findall(r'src="/static/js/', scripts)), 2)
        self.assertIn("table_resizer.js?v=", scripts)

    def test_bundle_route(self) -> None:
        client = TestClient(app)
        version = bundle("js", ["js/theme.js"]).version
        response = client.get(f"/bundle.js?files=js/theme.js&v={version}")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/javascript"))
        self.assertIn("immutable", response.headers["cache-control"])
        self.assertEqual(client.get("/bundle.js?files=js/../css/main.css").status_code, 404)
        self.assertEqual(client.get("/bundle.py?files=js/theme.js").status_code, 404)
