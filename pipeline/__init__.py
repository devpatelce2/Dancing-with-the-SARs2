
import sys as _sys
for _s in (_sys.stdout, _sys.stderr):  # Windows consoles default to cp1252; place names can be any script
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
