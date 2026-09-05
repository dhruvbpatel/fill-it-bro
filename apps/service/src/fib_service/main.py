"""FastAPI application factory and the `fib-service` console-script entry point."""

import os

import uvicorn
from fastapi import FastAPI

from .routers import extract, health, match_option, runs


def create_app() -> FastAPI:
    app = FastAPI(title="Fill-It-Bro service")
    app.include_router(health.router)
    app.include_router(extract.router)
    app.include_router(match_option.router)
    app.include_router(runs.router)
    return app


app = create_app()


def serve() -> None:
    """Entry point for `uv run fib-service`."""
    port = int(os.environ.get("PORT", "8787"))
    uvicorn.run("fib_service.main:app", port=port)
