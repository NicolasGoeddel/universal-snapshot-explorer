#!/bin/bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker build -t zfs-snapshot-explorer -f docker/Dockerfile .
