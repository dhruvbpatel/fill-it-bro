# Ticket 28: service container image.
# Build context is the repository root (the uv lockfile spans the whole workspace).
FROM python:3.12-slim

WORKDIR /app

# Workspace root + every member's pyproject (uv validates members against uv.lock).
COPY pyproject.toml uv.lock ./
COPY apps/service/pyproject.toml apps/service/
COPY apps/service/src/ apps/service/src/
COPY evals/harness/pyproject.toml evals/harness/
COPY evals/synthetic/pyproject.toml evals/synthetic/

RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev --package fib_service

EXPOSE 8787

CMD ["uv", "run", "--no-sync", "uvicorn", "fib_service.main:app", "--host", "0.0.0.0", "--port", "8787"]
