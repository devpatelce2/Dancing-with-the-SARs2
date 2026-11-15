"""API tests use synthetic fixtures and a fake catalogue - they verify code behaviour only."""
import json
from fastapi.testclient import TestClient
from backend.app import main
from pipeline.nisar import catalog

def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SITES_DATA_DIR", str(tmp_path))
    return TestClient(main.create_app())

def test_health_hides_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTHDATA_PASSWORD", "topsecret"); monkeypatch.setenv("EARTHDATA_USERNAME", "u")
    r = client(tmp_path, monkeypatch).get("/api/health")
    assert r.status_code == 200 and r.json()["earthdataConfigured"] is True and "topsecret" not in r.text

def test_sites_empty_is_honest(tmp_path, monkeypatch):
    j = client(tmp_path, monkeypatch).get("/api/sites").json()
    assert j["sites"] == [] and "No processed SAR data" in j["reason"]

def test_site_id_validation_blocks_traversal(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    assert c.get("/api/sites/..%2F..%2Fetc/metadata").status_code in (400, 404)
    assert c.get("/api/sites/nope/metadata").status_code == 404
    assert c.get("/api/sites/Bad_ID/metadata").status_code == 400

def test_metadata_and_change_served(tmp_path, monkeypatch):
    d = tmp_path / "s1"; d.mkdir()
    (d / "meta.json").write_text(json.dumps({"siteId": "s1"})); (d / "change.geojson").write_text('{"type":"FeatureCollection","features":[]}')
    c = client(tmp_path, monkeypatch)
    assert c.get("/api/sites/s1/metadata").json() == {"siteId": "s1"}
    assert c.get("/api/sites/s1/change").json()["type"] == "FeatureCollection"

def test_catalog_search_validation_and_upstream_errors(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    assert c.post("/api/catalog/search", json={"bbox": [10, 0, 5, 1]}).status_code == 422
    def boom(*a, **k): raise catalog.CatalogError("ASF catalogue is unreachable (network error)")
    monkeypatch.setattr(catalog, "search", boom)
    r = c.post("/api/catalog/search", json={"bbox": [0, 0, 1, 1]})
    assert r.status_code == 502 and "unreachable" in r.json()["detail"]
