"""FastAPI service. Milestone 1 endpoints: health, sites, metadata, catalogue search.
Processing endpoints are added in Milestone 5 (jobs run in a worker, never inside a request)."""
from __future__ import annotations
import json, logging, os, re
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from pipeline.config import load_auth
from pipeline.nisar import catalog

log = logging.getLogger("stellaris.api")
SITE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class SearchReq(BaseModel):
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)]
    start: str | None = None
    end: str | None = None
    processingLevel: str = "GCOV"
    maxResults: int = 50


def data_dir() -> Path:
    return Path(os.environ.get("SITES_DATA_DIR", "public/data")).resolve()


def create_app() -> FastAPI:
    app = FastAPI(title="Dancing with the SARs API", version="0.1.0")
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    def site_dir(site_id: str) -> Path:
        if not SITE_ID.match(site_id):
            raise HTTPException(400, "invalid site id")
        d = data_dir() / site_id
        if not d.is_dir():
            raise HTTPException(404, "site not found")
        return d

    @app.get("/api/health")
    def health():
        # Reports only whether credentials are configured - never their values.
        return {"status": "ok", "earthdataConfigured": load_auth().available}

    @app.get("/api/sites")
    def sites():
        f = data_dir() / "sites.json"
        if not f.is_file():
            return {"schemaVersion": 1, "sites": [], "reason": "No processed SAR data available"}
        return json.loads(f.read_text(encoding="utf-8"))

    @app.get("/api/sites/{site_id}")
    @app.get("/api/sites/{site_id}/metadata")
    def metadata(site_id: str):
        m = site_dir(site_id) / "meta.json"
        if not m.is_file():
            raise HTTPException(404, "metadata not found")
        return json.loads(m.read_text(encoding="utf-8"))

    @app.get("/api/sites/{site_id}/change")
    def change(site_id: str):
        g = site_dir(site_id) / "change.geojson"
        if not g.is_file():
            raise HTTPException(404, "change polygons not found")
        return FileResponse(g, media_type="application/geo+json")

    @app.post("/api/catalog/search")
    def catalog_search(req: SearchReq):
        try:
            res = catalog.search(req.bbox, req.start, req.end, req.processingLevel, req.maxResults)
        except ValueError as e:
            raise HTTPException(422, str(e))
        except catalog.CatalogError as e:
            log.warning("catalogue error: %s", e)
            raise HTTPException(502, str(e))
        res["pairs"] = catalog.find_pairs(res["records"])
        for r in res["records"]:
            r.pop("raw", None)  # keep response small; raw stays available to the CLI
        return res

    from .analyze import register
    register(app)
    return app


app = create_app()
