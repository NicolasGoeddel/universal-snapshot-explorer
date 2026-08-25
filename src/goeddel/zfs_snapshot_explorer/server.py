import argparse
import os

import uvicorn

from .config import load_config
from .logger import logger, setup_logging


class ServerArgs(argparse.Namespace):
    config_file: str = "config.yaml"
    bind: str = "127.0.0.1"
    port: int = 8080
    reload: bool = False


def parse_args() -> ServerArgs:
    parser = argparse.ArgumentParser(
        description="Start the ZFS Snapshot Explorer API",
        add_help=True
    )
    _ = parser.add_argument(
        "-c",
        "--config-file",
        type=str,
        default="config.yaml",
        help="Path to the configuration file"
    )
    _ = parser.add_argument(
        "-b",
        "--bind",
        type=str,
        default="127.0.0.1",
        help="IP address to bind the server to"
    )
    _ = parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=8080,
        help="Port for the server"
    )
    _ = parser.add_argument(
        "-r",
        "--reload",
        action="store_true",
        help="Set if you want to reload the server on code change"
    )
    return parser.parse_args(namespace=ServerArgs())


def start() -> None:
    args = parse_args()

    loglevel = "info"
    try:
        if os.path.exists(args.config_file):
            cfg = load_config(args.config_file)
            loglevel = cfg.loglevel
    except Exception:
        pass

    setup_logging(loglevel)
    logger.info("Starting ZFS Snapshot Explorer server...")
    logger.info("Using config file: %s", args.config_file)
    logger.info("Binding to %s:%d (reload=%s)", args.bind, args.port, args.reload)

    # Set an environment variable so that FastAPI worker processes (including with reload=True)
    # know which config file to load.
    os.environ["ZFS_EXPLORER_CONFIG_FILE"] = args.config_file

    uvicorn.run(
        "zfs_snapshot_explorer.app:app",
        host=args.bind,
        port=args.port,
        reload=args.reload
    )


if __name__ == "__main__":
    start()
