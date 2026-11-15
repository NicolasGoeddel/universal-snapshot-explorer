from __future__ import annotations

import re
import unittest
from urllib.parse import unquote

from fastapi.testclient import TestClient
from lucide.jinja import lucide as lucide_jinja

from goeddel.use.app import app
from goeddel.use.utils.icons import icon_stylesheet, render_icon


def drawing(css: str, selector: str) -> str:
    """The SVG a rule of the icon stylesheet draws."""
    rule = re.search(re.escape(selector) + r'\{mask-image:url\("data:image/svg\+xml,([^"]*)"\)\}', css)
    assert rule is not None, selector
    return unquote(rule[1])


class TestIcons(unittest.TestCase):
    def test_stylesheet_holds_the_icons_the_app_names(self) -> None:
        current = icon_stylesheet()
        # Named in templates, picked in code for rows, and drawn by scripts
        for name in ("chevron-right", "info", "folder", "folder-lock", "file-code", "link-2-off", "lock"):
            self.assertIn(name, current.names)
            self.assertIn(f".i-{name}{{", current.css)
        self.assertNotIn("a-arrow-down", current.names)

    def test_icon_is_an_element_the_stylesheet_draws(self) -> None:
        icon = str(render_icon("folder", 16, **{"class": "file-icon icon-folder"}))
        self.assertEqual(icon, '<i class="ico i-folder s16 file-icon icon-folder"></i>')
        self.assertEqual(str(render_icon("info", None, title="Info")), '<i class="ico i-info s24" title="Info"></i>')

    def test_drawings_are_lucides(self) -> None:
        css = icon_stylesheet().css
        lucides = re.sub(r"\s*\n\s*", "", str(lucide_jinja("folder", size=None)))
        self.assertEqual(drawing(css, ".i-folder"), lucides.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ', 1))
        # File and folder icons have a lighter stroke
        self.assertIn('stroke-width="1.8"', drawing(css, ".file-icon.i-folder"))

    def test_unknown_icons_and_sizes_are_refused(self) -> None:
        with self.assertRaises(ValueError):
            _ = render_icon("a-arrow-down", 16)
        with self.assertRaises(ValueError):
            _ = render_icon("folder", 100)

    def test_stylesheet_route(self) -> None:
        client = TestClient(app)
        response = client.get(f"/icons.css?v={icon_stylesheet().version}")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/css"))
        self.assertIn("immutable", response.headers["cache-control"])
        self.assertEqual(response.text, icon_stylesheet().css)
