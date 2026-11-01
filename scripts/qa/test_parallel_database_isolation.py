"""The alternate local test port must not permit arbitrary database targets."""

import os
import unittest
from unittest.mock import patch

from serve_api import create_test_app


class ParallelDatabaseIsolationTests(unittest.TestCase):
    def test_alternate_port_lookalikes_are_rejected_before_loading_application(self):
        for target in (
            "http://127.0.0.1:55435", "http://localhost:55434/path",
            "https://localhost:55434", "http://localhost:55434.example.com",
            "http://localhost:55434@shared.example.com", "http://0.0.0.0:55434",
        ):
            with self.subTest(target=target), patch.dict(os.environ, {"POSTGREST_TEST_URL": target}):
                with self.assertRaisesRegex(ValueError, "disposable acceptance"):
                    create_test_app()
