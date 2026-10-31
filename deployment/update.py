#!/usr/bin/env python3
"""Health-gated local deployment. Run from the Pi's private deployment directory."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parent
IMAGE = "ghcr.io/alexanderheffernan/lastpeek"
COMPOSE = ["docker", "compose", "--project-directory", str(ROOT), "-p", "lastpeek",
           "--env-file", str(ROOT / ".env"), "--env-file", str(ROOT / "images.env"),
           "-f", str(ROOT / "compose.yaml")]
# Explicit -f disables Compose's automatic override discovery. Preserve the
# operator's existing override before adding the blue-green services.
override = next((ROOT / name for name in ("compose.override.yaml", "compose.override.yml")
                 if (ROOT / name).exists()), None)
if override:
    COMPOSE.extend(["-f", str(override)])
COMPOSE.extend(["-f", str(ROOT / "compose.blue-green.yaml")])


def run(*args, capture=False, timeout=600, env=None):
    return subprocess.run(args, cwd=ROOT, check=True, timeout=timeout,
                          stdout=subprocess.PIPE if capture else None,
                          text=True, env=env).stdout


def compose(*args, base=False, **kwargs):
    # Shell variables must not override the digest pins just written to images.env.
    env = {key: value for key, value in os.environ.items()
           if key not in {"BLUE_IMAGE", "GREEN_IMAGE", "MAINTENANCE_IMAGE"}}
    return run(*(COMPOSE[:-2] if base else COMPOSE), *args, env=env, **kwargs)


def atomic(path, value, mode=0o644):
    temporary = path.with_suffix(path.suffix + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    os.fchmod(descriptor, mode)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def save_images(images):
    atomic(ROOT / "images.env", "".join(f"{key}={value}\n" for key, value in images.items()))


def probe(service, revision, runner=None):
    # Runs inside the candidate/proxy network, never against production data
    # fixtures. Reads only /health and the public landing page.
    host = "127.0.0.1" if service != "proxy" else "proxy"
    script = """
const health = await fetch('http://HOST:3000/health', {signal: AbortSignal.timeout(5000)});
if (!health.ok || health.headers.get('x-lastpeek-revision') !== 'REVISION') process.exit(1);
const page = await fetch('http://HOST:3000/', {signal: AbortSignal.timeout(5000)});
if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) process.exit(1);
""".replace("HOST", host).replace("REVISION", revision)
    # nginx has no Node runtime; use the new app to probe the proxy.
    compose("exec", "-T", runner or service,
            "node", "--input-type=module", "-e", script, timeout=20)


def wait_for_proxy(slot, revision):
    for attempt in range(20):
        try:
            probe("proxy", revision, slot)
            return
        except subprocess.CalledProcessError:
            if attempt == 19:
                raise
            time.sleep(1)


def image_metadata(image):
    metadata = json.loads(run("docker", "image", "inspect", image, capture=True))[0]
    revision = metadata["Config"]["Labels"]["org.opencontainers.image.revision"]
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise RuntimeError("Image has no valid source revision")
    return metadata, revision


def drain():
    # A successful new-revision response proves reload has taken effect.
    # Wait for nginx's retiring workers, not an arbitrary fixed sleep.
    compose("exec", "-T", "proxy", "sh", "-c",
            "while ps -o args | grep -q '[n]ginx: worker process is shutting down'; do sleep 1; done",
            timeout=320)


def deploy():
    images_path = ROOT / "images.env"
    images = dict(line.split("=", 1) for line in images_path.read_text().splitlines() if line)
    if set(images) != {"BLUE_IMAGE", "GREEN_IMAGE", "MAINTENANCE_IMAGE"}:
        raise RuntimeError("images.env must contain exactly BLUE_IMAGE, GREEN_IMAGE and MAINTENANCE_IMAGE")
    for image in images.values():
        if not re.fullmatch(re.escape(IMAGE) + r"@sha256:[0-9a-f]{64}", image):
            raise RuntimeError("Slot images must be pinned LastPeek digests")

    # extends cannot inherit a service merged across multiple Compose files.
    # Resolve the operator's complete web definition first, without printing it.
    web = json.loads(compose("config", "--format", "json", base=True, capture=True))["services"]["web"]
    atomic(ROOT / ".web-template.json", json.dumps({"services": {"web": web}}), mode=0o600)
    # Inspect without printing: the resolved model contains production secrets.
    services = json.loads(compose("--profile", "blue-green", "config", "--format", "json", capture=True))["services"]
    for slot in ("blue", "green"):
        if services[slot].get("ports") or services[slot].get("container_name"):
            raise RuntimeError("App slots must have no host ports or inherited container_name")

    route = ROOT / "routing" / "active.conf"
    previous = route.read_text() if route.exists() else None
    active = None
    if previous:
        match = re.fullmatch(r"upstream lastpeek \{ server (blue|green):3000; \}\n", previous)
        if not match:
            raise RuntimeError("Unrecognised active route; refusing deployment")
        active = match[1]
    candidate = "green" if active == "blue" else "blue"

    # active.conf is the durable desired route. A previous process may have died
    # after writing it but before reloading nginx. Reconcile it before touching
    # either slot, even when latest has advanced again since that interruption.
    if active:
        _, active_revision = image_metadata(images[active.upper() + "_IMAGE"])
        probe(active, active_revision)
        try:
            probe("proxy", active_revision, active)
        except subprocess.CalledProcessError:
            compose("exec", "-T", "proxy", "nginx", "-c", "/etc/lastpeek/nginx.conf", "-s", "reload")
            wait_for_proxy(active, active_revision)
        drain()

    run("docker", "pull", f"{IMAGE}:latest")
    metadata, revision = image_metadata(f"{IMAGE}:latest")
    digest = next(value for value in metadata["RepoDigests"] if value.startswith(IMAGE + "@"))

    if active and images[active.upper() + "_IMAGE"] == digest:
        # Also recover an interrupted post-switch retirement or maintenance update.
        compose("stop", candidate)
    else:
        images[candidate.upper() + "_IMAGE"] = digest
        save_images(images)
        compose("run", "--rm", "--no-deps", candidate, "npm", "run", "db:migrate")
        compose("up", "-d", "--no-deps", "--no-build", "--wait", "--wait-timeout", "120", candidate)
        probe(candidate, revision)
        # Copy only public content-addressed client assets. Never copy media or
        # entire build directories. Keep old chunks for already-open browsers.
        container = compose("ps", "-q", candidate, capture=True).strip()
        run("docker", "cp", f"{container}:/app/build/client/_app/immutable/.", str(ROOT / "assets"))

        atomic(route, f"upstream lastpeek {{ server {candidate}:3000; }}\n")
        try:
            compose("run", "--rm", "--no-deps", "proxy", "nginx", "-t", "-c", "/etc/lastpeek/nginx.conf")
            if active:
                compose("exec", "-T", "proxy", "nginx", "-c", "/etc/lastpeek/nginx.conf", "-s", "reload")
            else:
                compose("up", "-d", "--no-deps", "proxy")
            # Reload is asynchronous; tolerate startup only, never replay writes.
            wait_for_proxy(candidate, revision)
        except Exception:
            if previous:
                atomic(route, previous)
                compose("exec", "-T", "proxy", "nginx", "-c", "/etc/lastpeek/nginx.conf", "-s", "reload")
            else:
                # No public cutover yet during bootstrap. Leave no false active state.
                compose("stop", "proxy")
                route.unlink(missing_ok=True)
            raise
        drain()
        if active:
            compose("stop", active)

    images["MAINTENANCE_IMAGE"] = digest
    save_images(images)
    compose("up", "-d", "--no-deps", "--no-build", "maintenance")
    print(f"Serving {revision}; maintenance updated")


if __name__ == "__main__":
    os.chdir(ROOT)
    # Share the existing backup lock. The timer must invoke this script directly.
    with (ROOT / ".deployment.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy()
