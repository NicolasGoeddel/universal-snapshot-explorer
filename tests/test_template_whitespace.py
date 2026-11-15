from __future__ import annotations

import unittest

from jinja2 import DictLoader, Environment

from goeddel.use.utils.template_whitespace import StripIndentation

TEMPLATE = """<tr
    data-path="{{ path }}">
    <td>
        {%- if path %}<span>{{ path }}</span>{% endif %}
        <span>b</span>
    </td>
</tr>
<script>
    if (a)
        b();
</script>
<pre>
    kept
</pre>"""


class TestStripIndentation(unittest.TestCase):
    def test_removes_indentation_outside_code_and_preformatted_text(self) -> None:
        env = Environment(loader=DictLoader({"row.html.j2": TEMPLATE}), extensions=[StripIndentation])
        rendered = env.get_template("row.html.j2").render(path="a")
        expected = '<tr\ndata-path="a">\n<td><span>a</span>\n<span>b</span>\n</td>\n</tr>\n'
        self.assertEqual(rendered, expected + "<script>\n    if (a)\n        b();\n</script>\n<pre>\n    kept\n</pre>")
