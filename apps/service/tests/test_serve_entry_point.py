"""AC: `PROVIDER=fake uv run fib-service` serves /healthz (PORT from env)."""

import os
import socket
import subprocess
import sys
import time

import httpx


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def test_serve_entry_point_serves_healthz() -> None:
    port = _free_port()
    env = {**os.environ, "PROVIDER": "fake", "PORT": str(port)}
    proc = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "from fib_service.main import serve; serve()",
        ],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        last_error: Exception | None = None
        for _ in range(60):
            try:
                response = httpx.get(f"http://127.0.0.1:{port}/healthz", timeout=1.0)
                assert response.status_code == 200
                assert response.json() == {"ok": True, "provider": "fake"}
                return
            except httpx.HTTPError as err:
                last_error = err
                time.sleep(0.25)
        raise AssertionError(f"service never became healthy: {last_error}")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
