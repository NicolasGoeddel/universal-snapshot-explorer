#!/bin/bash

port="${1:-8080}"
config_file="${2:-examples/snapshotexplorer.btrfs.example.yaml}"
btrfs_root="${3:-/}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

volumes=()

if [[ -f "$config_file" ]]; then
    volumes+=(-v "$(realpath "$config_file"):/app/config.yaml:ro")
elif [[ -f "config.yaml" ]]; then
    volumes+=(-v "$(realpath "config.yaml"):/app/config.yaml:ro")
fi

if [[ -d "$btrfs_root" ]]; then
    volumes+=(-v "$(realpath "$btrfs_root"):/host:ro")
fi

# Pass through host user/group mappings
if [[ -f "/etc/passwd" ]]; then
    volumes+=(-v "/etc/passwd:/etc/passwd:ro")
fi
if [[ -f "/etc/group" ]]; then
    volumes+=(-v "/etc/group:/etc/group:ro")
fi

echo "Starting Btrfs Snapshot Explorer container on port ${port} with root '${btrfs_root}'..."
docker run -it --rm \
    -p "${port}:8080" \
    "${volumes[@]}" \
    zfs-snapshot-explorer
