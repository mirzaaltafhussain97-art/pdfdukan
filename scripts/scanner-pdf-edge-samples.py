"""Extract a few original PDF photo samples for a local filter comparison."""
import json
from pathlib import Path
from pypdf import PdfReader, PdfWriter
ROOT=Path(__file__).resolve().parents[1]
inventory=json.loads((ROOT/'output/scanner-corner-repair-20261102/source-inventory.json').read_text())['files']
source=next(e for e in inventory if e['id']=='f0065')
out=ROOT/'output/scanner-pdf-edges-20261103';out.mkdir(exist_ok=True)
reader=PdfReader(source['source_path'])
writer=PdfWriter();writer.add_page(reader.pages[12])
with (out/'single-page-13.pdf').open('wb') as stream:writer.write(stream)
for number in [1,4,6,13,14,15,17,19,21,23]:
    image=max(reader.pages[number-1].images,key=lambda im:len(im.data))
    (out/f'page-{number:02d}-source.jpg').write_bytes(image.data)
print('10 original photo samples extracted locally; source PDF unchanged.')
