FROM python:3.14-slim

# Set working directory
WORKDIR /app

# Install OS dependencies (enable contrib component for zfsutils-linux)
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i 's/Components: main/Components: main contrib/g' /etc/apt/sources.list.d/debian.sources; \
    fi && \
    if [ -f /etc/apt/sources.list ]; then \
        sed -i 's/main/main contrib/g' /etc/apt/sources.list; \
    fi && \
    apt-get update && apt-get install -y --no-install-recommends \
        libmagic1 \
        zfsutils-linux \
    && rm -rf /var/lib/apt/lists/*

# Install uv from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Configure uv: use copy instead of clone/reflink (prevents EAGAIN on overlayfs/ZFS) and compile bytecode
ENV UV_LINK_MODE=copy
ENV UV_COMPILE_BYTECODE=1

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock README.md ./

# Install dependencies (without installing the project itself yet)
RUN uv sync --frozen --no-install-project --no-dev

# Copy source code
COPY src/ src/

# Install the project
RUN uv sync --frozen --no-dev

# Place executables in environment at the front of PATH
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

# Make sure /data exists and can be used as a mount point
RUN mkdir -p /data
VOLUME /data

# Expose webserver port
EXPOSE 8080

# Start app
CMD ["zfsse", "--bind", "0.0.0.0", "--port", "8080", "--config-file", "config.yaml"]
