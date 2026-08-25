#!/bin/bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."
uv run zfsse --reload --port "${1-8080}" --config-file "examples/snapshotexplorer.example.yaml"
