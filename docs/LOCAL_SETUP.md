# Local setup (Windows, PowerShell, VS Code)
```powershell
# Frontend (Node >= 22.17)
npm ci; npm test; npm run dev
# Python (3.11+)
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt; python -m pytest -q
# Earthdata (token preferred): set for THIS shell only, never commit
$env:EARTHDATA_TOKEN = "<paste token>"
# 1. find granules          2. download            3. inspect          4. process           5. validate (optional)
python -m pipeline.nisar.cli --bbox W S E N --start YYYY-MM-DD --end YYYY-MM-DD
python -m pipeline.nisar.download --url "<downloadUrl from step 1>" --out data-raw
python -m pipeline.nisar.hdf5_inspect data-raw\<file>.h5
python -m pipeline.run_site --site-id <id> --event "<name>" --before data-raw\a.h5 --after data-raw\b.h5 --bbox W S E N --pol HHHH --threshold-db -3
python -m pipeline.validate --site-dir public\data\<id> --reference ref.tif --name "<ref>" --source "<who/where>" --date YYYY-MM-DD
uvicorn backend.app.main:app --reload --port 8000
```
Raw granules stay in `data-raw/` (git-ignored). Earthdata setup: create a free account at urs.earthdata.nasa.gov, approve the ASF DAAC application, generate a token.
