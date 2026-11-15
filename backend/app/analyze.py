"""Start-from-the-browser endpoints: geocode a place and run the real NISAR / Sentinel-1 pipeline as a background job.
The job runs `python -m pipeline.quick` in a child process (never inside a request); its output is the progress shown in the UI.
Requires EARTHDATA_TOKEN in the environment of the process that runs uvicorn."""
from __future__ import annotations
import os, re, subprocess, sys, threading, time, uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from pipeline.config import load_auth
from pipeline.geocode import geocode

ROOT = Path(__file__).resolve().parents[2]
SITE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
JOBS: dict[str, dict] = {}


class AnalyzeReq(BaseModel):
    place: str | None = Field(default=None, max_length=120)
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)] | None = None
    halfDeg: float = Field(default=0.1, ge=0.02, le=0.3)
    event: str = Field(default="SAR surface change", min_length=1, max_length=80)
    start: str
    end: str | None = None
    eventDate: str | None = None
    thresholdDb: float = Field(default=-3.0, le=-0.5, ge=-15)
    siteId: str | None = None
    mission: Literal["auto", "nisar", "sentinel1"] = "auto"   # auto: NISAR when it has scenes for the dates, else Sentinel-1
    maxScenes: int = Field(default=6, ge=3, le=12)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.split(",")[0].lower()).strip("-")[:40] or "site"


def build_command(req: AnalyzeReq) -> tuple[list[str], str]:
    if not DATE.match(req.start): raise ValueError("start must be YYYY-MM-DD")
    for d in (req.end, req.eventDate):
        if d and not DATE.match(d): raise ValueError("dates must be YYYY-MM-DD")
    if req.end and req.end < req.start: raise ValueError("end must not be before start")
    if not req.place and not req.bbox: raise ValueError("give a place or a bbox")
    site = req.siteId or slug(req.place or "site")
    if not SITE_ID.match(site): raise ValueError("invalid site id")
    cmd = [sys.executable, "-m", "pipeline.quick", "--site-id", site, "--event", req.event, "--start", req.start,
           "--threshold-db", str(req.thresholdDb), "--max-scenes", str(req.maxScenes), "--half-deg", str(req.halfDeg),
           "--mission", req.mission]
    if req.end: cmd += ["--end", req.end]
    if req.eventDate: cmd += ["--event-date", req.eventDate]
    if req.place: cmd += ["--place", req.place, "--name", req.place.split(",")[0].strip()]
    if req.bbox: cmd += ["--bbox", *map(str, req.bbox)]
    return cmd, site


ERR = re.compile(r"^(ERROR|WARNING: no|[A-Za-z_.]*(Error|Exception))\b")


def error_line(log: list[str]) -> str:
    """Last line that looks like a failure (not just the last line printed)."""
    for t in reversed(log):
        if ERR.match(t): return t
    return log[-1] if log else "no output; see the backend terminal"


def _run(job_id: str, cmd: list[str]) -> None:
    job = JOBS[job_id]
    try:
        p = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"})
        buf = b""
        while True:
            chunk = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(1)
            if not chunk: break
            buf += chunk
            parts = re.split(rb"[\r\n]", buf); buf = parts.pop()
            for line in parts:
                t = line.decode("utf-8", "replace").strip()
                if t: job["log"] = (job["log"] + [t])[-40:]
            if buf: job["progress"] = buf.decode("utf-8", "replace").strip()
        job["returncode"] = p.wait()
        job["status"] = "done" if job["returncode"] == 0 else "error"
        if job["status"] == "error": job["error"] = error_line(job["log"])
    except Exception as e:  # noqa: BLE001 - reported to the user, never silent
        job["status"], job["log"] = "error", job["log"] + [f"{type(e).__name__}: {e}"]
    job["finished"] = time.time()


def register(app: FastAPI) -> None:
    @app.get("/api/geocode")
    def geocode_ep(q: str, half: float = 0.1):
        if not q.strip() or len(q) > 120: raise HTTPException(422, "give a place name")
        half = min(max(half, 0.02), 6.0)
        try: lat, lon, name = geocode(q.strip())
        except ValueError as e: raise HTTPException(404, str(e))
        except Exception as e: raise HTTPException(502, f"geocoder unavailable: {e}")
        return {"name": name, "lat": lat, "lon": lon, "bbox": [round(lon - half, 4), round(lat - half, 4), round(lon + half, 4), round(lat + half, 4)]}

    @app.post("/api/analyze")
    def analyze(req: AnalyzeReq):
        if not load_auth().available:
            raise HTTPException(400, "EARTHDATA_TOKEN is not set in the terminal that started the backend")
        if any(j["status"] == "running" for j in JOBS.values()):
            raise HTTPException(409, "another analysis is still running")
        try: cmd, site = build_command(req)
        except ValueError as e: raise HTTPException(422, str(e))
        jid = uuid.uuid4().hex[:10]
        JOBS[jid] = {"status": "running", "siteId": site, "log": [], "progress": "", "returncode": None, "started": time.time()}
        threading.Thread(target=_run, args=(jid, cmd), daemon=True).start()
        return {"jobId": jid, "siteId": site}

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str):
        j = JOBS.get(job_id)
        if not j: raise HTTPException(404, "unknown job")
        return {k: j[k] for k in ("status", "siteId", "progress", "returncode")} | {"error": j.get("error"), "log": j["log"][-15:], "elapsedS": round((j.get("finished") or time.time()) - j["started"])}
