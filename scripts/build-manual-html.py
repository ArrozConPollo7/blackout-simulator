#!/usr/bin/env python3
"""Genera `docs/manual.html` (imprimible) a partir de `docs/manual-del-juego.md`.

Conversor deliberadamente pequeño: cubre el subconjunto de Markdown que usa el
manual (títulos, tablas, listas, bloques de código, negrita, cursiva y código en
línea). Sin dependencias y sin red: el HTML resultante se puede abrir e imprimir
a PDF desde cualquier navegador (o con `Page.printToPDF` por CDP).

    python3 scripts/build-manual-html.py
"""

from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "manual-del-juego.md"
TARGET = ROOT / "docs" / "manual.html"

CSS = """
:root { --bg:#07100b; --panel:#0d1a12; --line:#1e3a28; --ink:#d6f5e0; --dim:#8fb8a0;
        --green:#2bf075; --amber:#ffb547; --red:#ff4d5e; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
       font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
       font-size:11.5px; line-height:1.55; }
.page { max-width: 940px; margin:0 auto; padding: 28px 34px 60px; }
h1 { font-size:26px; color:var(--green); letter-spacing:.5px; text-transform:uppercase;
     border-bottom:2px solid var(--line); padding-bottom:10px; margin:0 0 18px; }
h2 { font-size:16px; color:var(--green); text-transform:uppercase; letter-spacing:.6px;
     margin:26px 0 8px; border-left:4px solid var(--green); padding-left:9px; page-break-after:avoid; }
h3 { font-size:13px; color:var(--amber); text-transform:uppercase; margin:18px 0 6px; page-break-after:avoid; }
p, li { color:var(--ink); }
strong { color:#fff; }
a { color:var(--amber); text-decoration:none; }
code { background:#0a1710; border:1px solid var(--line); border-radius:3px; padding:1px 4px; color:var(--green); }
pre { background:#050c07; border:1px solid var(--line); border-radius:6px; padding:12px 14px; overflow-x:auto;
      page-break-inside:avoid; }
pre code { background:none; border:none; color:#bfeed0; padding:0; font-size:11px; }
table { width:100%; border-collapse:collapse; margin:10px 0 16px; page-break-inside:avoid; font-size:10.5px; }
th, td { border:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }
th { background:#0e2016; color:var(--green); text-transform:uppercase; font-size:9.5px; letter-spacing:.4px; }
tr:nth-child(even) td { background:#0a150e; }
hr { border:none; border-top:1px solid var(--line); margin:22px 0; }
blockquote { border-left:3px solid var(--amber); margin:10px 0; padding:2px 12px; color:var(--dim); }
ul, ol { padding-left:22px; }
li { margin:2px 0; }
@page { size: A4; margin: 12mm; }
@media print { body { background:#fff; color:#111; } .page { padding:0; }
  h1, h2, h3 { color:#0a5c2c; border-color:#9fd6b4; }
  p, li, td, th { color:#111; }
  strong, em, b, i { color:#000; }
  th { background:#eaf7ef; color:#0a5c2c; } tr:nth-child(even) td { background:#f6fbf8; }
  pre { background:#f4f8f5; border-color:#cfe7d8; } pre code { color:#123; }
  code { background:#f4f8f5; color:#0a5c2c; border-color:#cfe7d8; }
  table, pre, blockquote { page-break-inside:avoid; } a { color:#0a4a8a; } }
"""


def slug(text: str) -> str:
    """Identificador de ancla estilo GitHub (para el índice del manual)."""
    clean = re.sub(r"[`*\[\]]", "", text).strip().lower()
    return re.sub(r"[^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00fc\- ]", "", clean).replace(" ", "-")


def inline(text: str) -> str:
    """Enlaces, negrita, cursiva y código en línea (para el subconjunto del manual)."""
    out = html.escape(text)
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", out)
    return out


def convert(markdown: str) -> str:
    lines = markdown.split("\n")
    out: list[str] = []
    in_code = False
    in_list = False
    table: list[list[str]] = []

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    def flush_table() -> None:
        nonlocal table
        if not table:
            return
        head, *body = table
        out.append("<table><thead><tr>")
        out.extend(f"<th>{inline(c)}</th>" for c in head)
        out.append("</tr></thead><tbody>")
        for row in body:
            out.append("<tr>")
            out.extend(f"<td>{inline(c)}</td>" for c in row)
            out.append("</tr>")
        out.append("</tbody></table>")
        table = []

    for line in lines:
        if line.startswith("```"):
            flush_table()
            close_list()
            if in_code:
                out.append("</code></pre>")
                in_code = False
            else:
                out.append("<pre><code>")
                in_code = True
            continue

        if in_code:
            out.append(html.escape(line))
            continue

        # Tablas: | a | b |  (+ separador |---|---|---|)
        if line.strip().startswith("|") and line.strip().endswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue
            table.append(cells)
            continue
        flush_table()

        if not line.strip():
            close_list()
            continue

        if line.startswith("### "):
            close_list()
            out.append(f'<h3 id="{slug(line[4:])}">{inline(line[4:])}</h3>')
        elif line.startswith("## "):
            close_list()
            out.append(f'<h2 id="{slug(line[3:])}">{inline(line[3:])}</h2>')
        elif line.startswith("# "):
            close_list()
            out.append(f"<h1>{inline(line[2:])}</h1>")
        elif re.match(r"^[-*] ", line):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(line[2:])}</li>")
        elif re.match(r"^\d+\. ", line):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(re.sub(r'^\\d+\\. ', '', line))}</li>")
        elif line.startswith("> "):
            close_list()
            out.append(f"<blockquote>{inline(line[2:])}</blockquote>")
        elif line.strip() == "---":
            close_list()
            out.append("<hr/>")
        else:
            close_list()
            out.append(f"<p>{inline(line)}</p>")

    flush_table()
    close_list()
    if in_code:
        out.append("</code></pre>")
    return "\n".join(out)


def main() -> None:
    body = convert(SOURCE.read_text(encoding="utf-8"))
    TARGET.write_text(
        "<!doctype html>\n<html lang=\"es\"><head><meta charset=\"utf-8\">"
        "<title>BLACKOUT: GRID COLLAPSE — Manual de operación</title>"
        f"<style>{CSS}</style></head><body><div class=\"page\">{body}</div></body></html>\n",
        encoding="utf-8",
    )
    print(f"{TARGET.relative_to(ROOT)} escrito ({TARGET.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
