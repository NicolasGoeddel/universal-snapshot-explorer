#!/bin/bash

port="${1:-8080}"
config_file="${2:-examples/snapshotexplorer.example.yaml}"
data_dir="${3:-}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

volumes=()

if [[ -f "$config_file" ]]; then
    volumes+=(-v "$(realpath "$config_file"):/app/config.yaml:ro")
elif [[ -f "config.yaml" ]]; then
    volumes+=(-v "$(realpath "config.yaml"):/app/config.yaml:ro")
fi

if [[ -n "$data_dir" && -d "$data_dir" ]]; then
    volumes+=(-v "$(realpath "$data_dir"):/data:ro")
elif [[ -d "./data" ]]; then
    volumes+=(-v "$(realpath "./data"):/data:ro")
elif [[ -d "/data" ]]; then
    volumes+=(-v "/data:/data:ro")
fi

docker run -it --rm \
    -p "${port}:8080" \
    "${volumes[@]}" \
    zfs-snapshot-explorer
