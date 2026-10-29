"""Controlled database boundary for repository outcome tests, never a production client."""

from types import SimpleNamespace
from unittest.mock import MagicMock


def database_result(data=None, error=None):
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    client.rpc.return_value = query
    for method in (
        "select", "insert", "update", "upsert", "delete", "eq", "neq", "in_",
        "lt", "gt", "gte", "lte", "is_", "order", "range", "limit", "or_",
    ):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data=[] if data is None else data)
    query.execute.side_effect = error
    return client, query
