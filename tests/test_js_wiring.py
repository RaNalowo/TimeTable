"""Every page loads only existing scripts, defines no function twice, and every inline
onclick="..." handler (in the HTML or in JS-generated HTML) resolves to a loaded function."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES, STATIC = ROOT / "templates", ROOT / "static"
SCRIPT = re.compile(r'<script src="/static/(js/[^"?#]+)"')
DEF = re.compile(r"^(?:async\s+)?function\s+(\w+)|^(?:let|const|var)\s+(\w+)", re.M)
HANDLER = re.compile(r'\bon[a-z]+\s*=\s*"([^"]*)"')
CALL = re.compile(r"(?<![\w.$])([A-Za-z_]\w*)\s*\(")
IGNORE = {"if", "for", "while", "switch", "function", "return", "alert", "confirm", "prompt", "parseInt",
          "parseFloat", "Number", "String", "Boolean", "Array", "Object", "JSON", "Math", "Date", "Promise",
          "setTimeout", "clearTimeout", "setInterval", "clearInterval", "encodeURIComponent", "fetch", "event"}


def defined(text):
    return [a or b for a, b in DEF.findall(text)]


def handlers(text):
    return {n for v in HANDLER.findall(text) for n in CALL.findall(v) if n not in IGNORE}


class JsWiringTests(unittest.TestCase):
    def pages(self):
        for page in sorted(TEMPLATES.rglob("*.html")):
            html = page.read_text(encoding="utf-8")
            yield page, html, SCRIPT.findall(html)

    def test_no_function_or_variable_is_defined_twice_on_a_page(self):
        for page, _, scripts in self.pages():
            names = [n for s in scripts for n in defined((STATIC / s).read_text(encoding="utf-8"))]
            with self.subTest(page=page.name):
                self.assertEqual(sorted({n for n in names if names.count(n) > 1}), [])

    def test_inline_handlers_resolve_to_loaded_functions(self):
        for page, html, scripts in self.pages():
            texts = [(STATIC / s).read_text(encoding="utf-8") for s in scripts]
            known = {n for t in texts for n in defined(t)}
            need = handlers(html).union(*(handlers(t) for t in texts))
            with self.subTest(page=page.name):
                self.assertEqual(sorted(need - known), [])

    def test_every_js_file_is_used_by_some_page(self):
        used = {s for _, _, scripts in self.pages() for s in scripts}
        on_disk = {p.relative_to(STATIC).as_posix() for p in (STATIC / "js").rglob("*.js")}
        self.assertEqual(sorted(on_disk - used), [])


if __name__ == "__main__":
    unittest.main()
