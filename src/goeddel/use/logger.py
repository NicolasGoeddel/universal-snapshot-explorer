from __future__ import annotations

import logging
import os
import sys

logger = logging.getLogger("goeddel.use")


def setup_logging(level: str | None = None) -> None:
    """Configures the unified logging setup for the application."""
    if not level:
        level = os.environ.get("LOG_LEVEL", "INFO")

    numeric_level = logging.getLevelNamesMapping().get(level.upper(), logging.INFO)
    logger.setLevel(numeric_level)

    if logger.handlers:
        return

    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s:%(filename)s:%(lineno)d] - %(message)s")

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    logger.addHandler(handler)

    logger.propagate = False
