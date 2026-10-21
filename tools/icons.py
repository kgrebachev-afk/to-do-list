# Génère les icônes PNG de l'application (une seule fois ; les PNG sont versionnés)
import pathlib
from playwright.sync_api import sync_playwright
OUT = pathlib.Path(__file__).resolve().parent.parent / 'src/web/icons'
def svg(size, maskable=False, rounded=True):
    r = 0 if maskable else size * 0.22
    s = size / 32
    stroke = 3.1 * s * (0.72 if maskable else 1)
    # coche centrée ; pour l'icône masquable, réduite dans la zone de sécurité (80 %)
    k = 0.72 if maskable else 1
    def pt(x, y): return (size / 2 + (x - 16) * s * k, size / 2 + (y - 16) * s * k)
    a, b, c = pt(9, 16.6), pt(13.6, 21.2), pt(23.2, 11)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11808B"/><stop offset="1" stop-color="#0A5B63"/></linearGradient></defs>
      <rect width="{size}" height="{size}" rx="{r}" fill="url(#g)"/>
      <path d="M{a[0]:.2f} {a[1]:.2f} L{b[0]:.2f} {b[1]:.2f} L{c[0]:.2f} {c[1]:.2f}" fill="none" stroke="#fff" stroke-width="{stroke:.2f}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>'''
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size, mask in [('icon-192.png', 192, False), ('icon-512.png', 512, False), ('maskable-512.png', 512, True), ('apple-touch-icon.png', 180, True)]:
        pg = b.new_page(viewport={'width': size, 'height': size})
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg(size, mask)}</body></html>')
        pg.screenshot(path=str(OUT / name), omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
        pg.close()
    b.close()
print('icônes générées dans', OUT)
