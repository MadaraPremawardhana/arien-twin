"""Assemble src/ into one self-contained HTML file: index.html at the repository root (served by GitHub Pages)."""
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
html = (src / "template.html").read_text()
parts = {
    "/*@@STYLE@@*/": (src / "style.css").read_text(),
    "/*@@PHYSICS@@*/": (src / "physics.js").read_text(),
    "/*@@WEATHER@@*/": (src / "weather.js").read_text(),
    "/*@@APP@@*/": (src / "app.js").read_text(),
}
for marker, body in parts.items():
    assert html.count(marker) == 1, marker
    assert "</script" not in body.lower() or marker == "/*@@STYLE@@*/", f"{marker} contains a closing script tag"
    html = html.replace(marker, body)
out = root / "index.html"
out.write_text(html)
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
