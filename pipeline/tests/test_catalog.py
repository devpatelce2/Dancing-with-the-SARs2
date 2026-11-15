"""UNIT TESTS on clearly synthetic catalogue structures. These prove code logic only - NOT NISAR coverage or data."""
import pytest
from pipeline.nisar import catalog as c
from pipeline.config import load_auth

def feat(name, t, **p):
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
            "properties": {"sceneName": name, "startTime": t, **p}}

class R:  # fake HTTP response
    def __init__(s, code=200, js=None): s.status_code, s._j = code, js
    def json(s):
        if s._j is None: raise ValueError
        return s._j

def test_bbox_validation():
    with pytest.raises(ValueError): c.validate_bbox(10, 0, 5, 1)
    with pytest.raises(ValueError): c.validate_bbox(0, 0, 100, 100)
    assert c.validate_bbox(0, 0, 1, 1) == (0, 0, 1, 1)

def test_params_validation():
    with pytest.raises(ValueError): c.build_params((0, 0, 1, 1), None, None, "BOGUS")
    with pytest.raises(ValueError): c.build_params((0, 0, 1, 1), "2025-02-01", "2025-01-01")
    with pytest.raises(ValueError): c.build_params((0, 0, 1, 1), None, None, "GCOV", 9999)
    p = c.build_params((0, 0, 1, 1), "2025-01-01", "2025-02-01")
    assert p["dataset"] == "NISAR" and p["processingLevel"] == "GCOV" and p["intersectsWith"].startswith("POLYGON((")

def test_search_normalizes_and_rejects_bad_features():
    fc = {"type": "FeatureCollection", "features": [feat("G1", "2025-01-01T00:00:00Z", flightDirection="ascending"), {"properties": {}}]}
    out = c.search((0, 0, 1, 1), http_get=lambda *a, **k: R(200, fc))
    assert out["returned"] == 2 and out["usable"] == 1 and out["records"][0]["flightDirection"] == "ASCENDING"
    assert "No radar pixel data" in out["note"]

@pytest.mark.parametrize("resp", [R(500, {}), R(200, None), R(200, {"type": "x"})])
def test_search_errors_are_clean(resp):
    with pytest.raises(c.CatalogError): c.search((0, 0, 1, 1), http_get=lambda *a, **k: resp)

def test_search_network_error():
    import requests
    def boom(*a, **k): raise requests.ConnectionError("x")
    with pytest.raises(c.CatalogError): c.search((0, 0, 1, 1), http_get=boom)

def test_pairing_reports_unknowns_not_guesses():
    recs = [c.normalize_feature(feat("A", "2025-01-01T00:00:00Z", pathNumber=5, flightDirection="ASCENDING")),
            c.normalize_feature(feat("B", "2025-01-13T00:00:00Z", pathNumber=5, flightDirection="ASCENDING")),
            c.normalize_feature(feat("C", "2025-01-25T00:00:00Z", pathNumber=9, flightDirection="ASCENDING"))]
    pairs = c.find_pairs(recs)
    assert [(p["before"], p["after"]) for p in pairs] == [("A", "B")]
    assert "polarization" in pairs[0]["unknownFields"] and pairs[0]["status"] == "candidate-needs-confirmation"

def test_auth_never_leaks_in_repr():
    a = load_auth({"EARTHDATA_USERNAME": "u", "EARTHDATA_PASSWORD": "secret-pw"})
    assert a.available and "secret-pw" not in repr(a)
    assert not load_auth({}).available
