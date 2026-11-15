"""Static files referenced by templates exist; shared CSS/UI is not copy-pasted back into pages."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"
STATIC = ROOT / "static"


def pages():
    return sorted(TEMPLATES.rglob("*.html"))


class AssetTests(unittest.TestCase):
    def test_every_static_reference_exists(self):
        for page in pages():
            html = page.read_text(encoding="utf-8")
            for ref in re.findall(r'(?:src|href)="/static/([^"?#]+)', html):
                with self.subTest(page=page.name, ref=ref):
                    self.assertTrue((STATIC / ref).is_file())

    def test_app_pages_load_the_shared_stylesheet(self):
        for page in pages():
            if page.name == "login.html":
                continue
            with self.subTest(page=page.name):
                self.assertIn("/static/css/base.css", page.read_text(encoding="utf-8"))

    def test_confirm_and_notice_html_is_not_copied_into_pages(self):
        for page in pages():
            html = page.read_text(encoding="utf-8")
            with self.subTest(page=page.name):
                self.assertNotIn('id="confirmModal"', html)
                self.assertNotIn('id="pageNotice"', html)


if __name__ == "__main__":
    unittest.main()
