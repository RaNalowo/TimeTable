"""Every page URL must serve an existing template, and no template may be orphaned."""
import os
import tempfile
import unittest
from pathlib import Path

_temp = tempfile.TemporaryDirectory(prefix="timetable-pages-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_temp.name) / 'pages.db'}"

from fastapi.testclient import TestClient
from app import app
from config import PROJECT_DIR
from routes.pages import PAGES

TEMPLATES = PROJECT_DIR / "templates"


class PageRouteTests(unittest.TestCase):
    def test_every_listed_template_exists(self):
        for url, template in PAGES.items():
            with self.subTest(url=url):
                self.assertTrue((TEMPLATES / template).is_file(), template)

    def test_every_page_url_serves_html(self):
        client = TestClient(app)
        for url in PAGES:
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertIn("text/html", response.headers["content-type"])
                self.assertIn("<html", response.text.lower())

    def test_no_template_is_missing_from_the_table(self):
        on_disk = {p.relative_to(TEMPLATES).as_posix() for p in TEMPLATES.rglob("*.html")}
        self.assertEqual(on_disk, set(PAGES.values()))


if __name__ == "__main__":
    unittest.main()
