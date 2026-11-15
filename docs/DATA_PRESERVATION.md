# Preserving existing Sentinel-1 / NISAR datasets

This project is a **fresh directory**. It never reads from, writes to, moves or deletes the previous project.
- `npm run inventory -- <old-project-or-data-dir> [...]` walks the given paths **read-only** and writes only `./data-inventory/manifest.json`
  (path, size, mtime, guessed mission, kind). It does not copy or download anything.
- Large products (`.h5`, `.SAFE`, `.zip`) are git-ignored. To make them reachable from the app later, symlink rather than copy:
  `ln -s /path/to/existing/data ./data-external` (git-ignored).
- **Not done yet:** I could not see your old project from this environment, so the inventory has only been tested on a throwaway directory.
  Run it on your machine and review `manifest.json` before any integration work.
