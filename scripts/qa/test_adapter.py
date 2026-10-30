"""The integration launcher must reject shared or unspecified database targets."""

import os
import unittest
from unittest.mock import patch

from serve_api import create_test_app


class DatabaseIsolationTests(unittest.TestCase):
    def test_non_acceptance_targets_are_rejected_before_loading_application(self):
        for target in ("", "https://example.supabase.co", "http://localhost:54321",
                       "http://127.0.0.1:55433.example.com", "http://localhost:55433/path"):
            with self.subTest(target=target), patch.dict(os.environ, {"POSTGREST_TEST_URL": target}):
                with self.assertRaisesRegex(ValueError, "disposable acceptance"):
                    create_test_app()


if __name__ == "__main__":
    unittest.main()
