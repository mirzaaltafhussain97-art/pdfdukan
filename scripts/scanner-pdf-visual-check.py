"""Render local scanner exports for inspection; never alter source PDFs."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib, json, subprocess
from PIL import Image, ImageOps, ImageDraw
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/scanner-pdf-20261103'
VIS = OUT / 'visual'
VIS.mkdir(exist_ok=True)
POPPLER = Path(r'C:\Users\ANM\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe')
rows = json.loads((OUT / 'RESULTS.json').read_text())

def render(row):
    folder = VIS / row['id']
    folder.mkdir(exist_ok=True)
    source = Path(row['source'])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == row['sourceHash']
    reader = PdfReader(row['output'])
    assert len(reader.pages) == row['pages']
    subprocess.run([str(POPPLER), '-scale-to', '950', '-png', row['output'], str(folder / 'page')], check=True, capture_output=True)
    pages = sorted(folder.glob('page-*.png'))
    assert len(pages) == row['pages']
    for start in range(0, len(pages), 12):
        group = pages[start:start+12]
        sheet = Image.new('RGB', (1440, 530*((len(group)+3)//4)), '#e8e8e8')
        draw = ImageDraw.Draw(sheet)
        for n, file in enumerate(group):
            with Image.open(file) as image:
                image.thumbnail((344, 492))
                x, y = (n % 4)*360, (n // 4)*530
                sheet.paste(image, (x+(360-image.width)//2, y+26))
                draw.text((x+10,y+7), f"{row['id']} page {start+n+1}", fill='black')
        sheet.save(VIS / f"{row['id']}-{start+1:02d}-sheet.jpg", quality=92)
    dimensions = []
    for page in reader.pages:
        for reference in page['/Resources']['/XObject'].values():
            obj = reference.get_object()
            if obj.get('/Subtype') == '/Image':
                dimensions.append(int(obj['/Width'])*int(obj['/Height']))
    assert dimensions
    return {'id':row['id'], 'pages':len(pages), 'bytes':Path(row['output']).stat().st_size,
            'sourceUnchanged':True, 'minimumEmbeddedPixels':min(dimensions)}

with ThreadPoolExecutor(max_workers=2) as pool:
    report = list(pool.map(render, rows))
(VIS / 'render-check.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'pdfs':len(report),'renderedPages':sum(r['pages'] for r in report),'allOriginalsUnchanged':all(r['sourceUnchanged'] for r in report)}))
