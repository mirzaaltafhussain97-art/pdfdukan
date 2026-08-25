// Generate lightweight, brand-consistent SVG feature illustrations.
// Each file is self-contained, has a descriptive <title>/<desc>, and avoids
// external fonts, raster data and animation so it remains fast on mobile.

import { writeFileSync } from 'fs';
import { join } from 'path';

const output = join(process.cwd(), 'public', 'images');

const specs = {
  'fill-sign': { kind:'document', label:'FILL & SIGN', accent:'#22c55e', detail:'signature' },
  'html-to-pdf': { kind:'conversion', from:'HTML', to:'PDF', accent:'#06b6d4', detail:'code' },
  'page-numbers': { kind:'document', label:'PAGE NUMBERS', accent:'#8b5cf6', detail:'numbers' },
  'pdf-editor': { kind:'document', label:'PDF EDITOR', accent:'#f97316', detail:'editor' },
  'pdf-organizer': { kind:'document', label:'ORGANIZER', accent:'#38bdf8', detail:'organizer' },
  'pdf-to-excel': { kind:'conversion', from:'PDF', to:'XLSX', accent:'#22c55e', detail:'grid' },
  'pdf-to-ppt': { kind:'conversion', from:'PDF', to:'PPTX', accent:'#fb7185', detail:'slides' },
  'pdf-to-word': { kind:'conversion', from:'PDF', to:'DOCX', accent:'#60a5fa', detail:'text' },
  'watermark': { kind:'document', label:'WATERMARK', accent:'#14b8a6', detail:'watermark' },
  'word-to-pdf': { kind:'conversion', from:'DOCX', to:'PDF', accent:'#3b82f6', detail:'document' },
  'about-product': { kind:'static', label:'ABOUT PDFDUKAN', accent:'#f97316', detail:'product' },
  'contact-support': { kind:'static', label:'CONTACT & SUPPORT', accent:'#38bdf8', detail:'contact' },
  'privacy-protection': { kind:'static', label:'PRIVACY', accent:'#22c55e', detail:'privacy' },
  'terms-agreement': { kind:'static', label:'TERMS', accent:'#8b5cf6', detail:'terms' },
  'cookies-storage': { kind:'static', label:'COOKIES & STORAGE', accent:'#f59e0b', detail:'cookies' },
  'disclaimer-verification': { kind:'static', label:'VERIFY OUTPUTS', accent:'#ef4444', detail:'warning' },
  'help-guide': { kind:'static', label:'HELP CENTER', accent:'#06b6d4', detail:'help' },
  'press-media': { kind:'static', label:'PRESS & MEDIA', accent:'#ec4899', detail:'press' },
};

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;',
}[char]));

function shell(spec, body) {
  const title = `${spec.label || `${spec.from} to ${spec.to}`} feature illustration`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-labelledby="title desc">
  <title id="title">${esc(title)}</title>
  <desc id="desc">A lightweight PDFdukan workflow illustration for ${esc(spec.label || `${spec.from} to ${spec.to}`)}.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101827"/><stop offset="1" stop-color="#1e293b"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff6333"/><stop offset="1" stop-color="${spec.accent}"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#020617" flood-opacity=".28"/></filter>
  </defs>
  <rect width="720" height="420" rx="28" fill="url(#bg)"/>
  <circle cx="78" cy="65" r="86" fill="${spec.accent}" opacity=".10"/>
  <circle cx="650" cy="352" r="110" fill="#ff6333" opacity=".08"/>
  ${body}
</svg>`;
}

function page(x, y, w, h, label, color='#ff6333') {
  return `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#f8fafc"/>
    <path d="M${x+w-48} ${y}h32a16 16 0 0 1 16 16v32z" fill="${color}" opacity=".25"/>
    <rect x="${x+24}" y="${y+28}" width="${Math.max(54,w-82)}" height="13" rx="6.5" fill="${color}" opacity=".88"/>
    <rect x="${x+24}" y="${y+58}" width="${w-48}" height="8" rx="4" fill="#94a3b8" opacity=".42"/>
    <rect x="${x+24}" y="${y+78}" width="${w-70}" height="8" rx="4" fill="#94a3b8" opacity=".32"/>
    <text x="${x+w/2}" y="${y+h-25}" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#334155">${esc(label)}</text></g>`;
}

function arrow(x1=310, x2=410, y=210, color='#ff6333') {
  return `<path d="M${x1} ${y}h${x2-x1-22}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/><path d="M${x2-28} ${y-20}l28 20-28 20" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function conversion(spec) {
  let detail = '';
  if (spec.detail === 'grid') detail = `<g fill="none" stroke="${spec.accent}" stroke-width="4">${[0,1,2].map(r=>[0,1,2].map(c=>`<rect x="468" y="148" width="44" height="32" transform="translate(${c*45} ${r*33})"/>`).join('')).join('')}</g>`;
  if (spec.detail === 'slides') detail = `<rect x="470" y="146" width="126" height="76" rx="8" fill="${spec.accent}" opacity=".18"/><rect x="486" y="162" width="52" height="8" rx="4" fill="${spec.accent}"/><rect x="486" y="181" width="92" height="7" rx="3.5" fill="#94a3b8" opacity=".55"/>`;
  if (spec.detail === 'code') detail = `<text x="226" y="194" text-anchor="middle" font-family="monospace" font-size="25" font-weight="700" fill="${spec.accent}">&lt;/&gt;</text>`;
  if (spec.detail === 'text' || spec.detail === 'document') detail = `<g fill="#94a3b8" opacity=".55"><rect x="468" y="150" width="112" height="8" rx="4"/><rect x="468" y="171" width="132" height="8" rx="4"/><rect x="468" y="192" width="92" height="8" rx="4"/></g>`;
  return shell(spec, `${page(120,95,210,250,spec.from,'#ff6333')}${arrow(326,430,210,spec.accent)}${page(410,95,210,250,spec.to,spec.accent)}${detail}`);
}

function documentVisual(spec) {
  let detail = '';
  if (spec.detail === 'signature') detail = `<path d="M220 250c34-54 31 42 63-13 18-31 21 41 65-8" fill="none" stroke="${spec.accent}" stroke-width="8" stroke-linecap="round"/><path d="M430 282l72-72 24 24-72 72-38 9z" fill="url(#accent)"/><circle cx="546" cy="312" r="28" fill="${spec.accent}"/><path d="M532 312l10 10 19-24" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (spec.detail === 'numbers') detail = [1,2,3].map((n,i)=>`<g transform="translate(${185+i*120} ${245+i%2*18})"><rect width="92" height="72" rx="12" fill="#fff"/><circle cx="46" cy="36" r="22" fill="${spec.accent}"/><text x="46" y="44" text-anchor="middle" font-family="Arial" font-size="23" font-weight="700" fill="#fff">${n}</text></g>`).join('');
  if (spec.detail === 'editor') detail = `<rect x="218" y="176" width="172" height="50" rx="8" fill="${spec.accent}" opacity=".16" stroke="${spec.accent}" stroke-width="3"/><path d="M447 276l62-62 24 24-62 62-36 10z" fill="url(#accent)"/><circle cx="500" cy="142" r="24" fill="${spec.accent}" opacity=".22"/><path d="M488 142h24M500 130v24" stroke="${spec.accent}" stroke-width="6" stroke-linecap="round"/>`;
  if (spec.detail === 'organizer') detail = [0,1,2,3].map((n)=>`<rect x="${182+(n%2)*130}" y="${135+Math.floor(n/2)*96}" width="102" height="72" rx="10" fill="#fff" stroke="${n===1?spec.accent:'#cbd5e1'}" stroke-width="${n===1?5:2}"/>`).join('') + `<path d="M445 170c55 0 62 52 20 75" fill="none" stroke="${spec.accent}" stroke-width="9" stroke-linecap="round"/><path d="M473 230l-10 23 25-5" fill="none" stroke="${spec.accent}" stroke-width="7" stroke-linecap="round"/>`;
  if (spec.detail === 'watermark') detail = `<g transform="rotate(-28 360 210)"><rect x="180" y="182" width="360" height="56" rx="12" fill="${spec.accent}" opacity=".18"/><text x="360" y="220" text-anchor="middle" font-family="Arial" font-size="34" font-weight="800" letter-spacing="6" fill="${spec.accent}">SAMPLE</text></g><g transform="translate(475 285)"><rect width="112" height="12" rx="6" fill="#475569"/><circle cx="72" cy="6" r="16" fill="${spec.accent}"/></g>`;
  return shell(spec, `${page(155,70,310,280,spec.label,spec.accent)}${detail}`);
}

function staticVisual(spec) {
  let detail = '';
  if (spec.detail === 'privacy') detail = `<path d="M480 138l78 28v60c0 56-34 91-78 112-44-21-78-56-78-112v-60z" fill="${spec.accent}" opacity=".20" stroke="${spec.accent}" stroke-width="6"/><rect x="450" y="220" width="60" height="54" rx="10" fill="${spec.accent}"/><path d="M462 220v-16a18 18 0 0 1 36 0v16" fill="none" stroke="#fff" stroke-width="7"/>`;
  if (spec.detail === 'terms') detail = `<g fill="none" stroke="${spec.accent}" stroke-width="5"><rect x="438" y="146" width="28" height="28" rx="6"/><path d="M445 159l8 8 17-22"/><rect x="438" y="202" width="28" height="28" rx="6"/><path d="M445 215l8 8 17-22"/><rect x="438" y="258" width="28" height="28" rx="6"/></g><g fill="#94a3b8" opacity=".55"><rect x="482" y="153" width="96" height="9" rx="4"/><rect x="482" y="209" width="118" height="9" rx="4"/><rect x="482" y="265" width="82" height="9" rx="4"/></g>`;
  if (spec.detail === 'cookies') detail = `<circle cx="500" cy="215" r="92" fill="#f8fafc"/><circle cx="535" cy="160" r="38" fill="#1e293b"/><g fill="${spec.accent}"><circle cx="460" cy="180" r="12"/><circle cx="500" cy="235" r="13"/><circle cx="455" cy="260" r="10"/><circle cx="545" cy="250" r="11"/></g>`;
  if (spec.detail === 'warning') detail = `<path d="M500 125l105 182H395z" fill="${spec.accent}" opacity=".18" stroke="${spec.accent}" stroke-width="6"/><path d="M500 184v62" stroke="${spec.accent}" stroke-width="13" stroke-linecap="round"/><circle cx="500" cy="278" r="8" fill="${spec.accent}"/>`;
  if (spec.detail === 'contact') detail = `<rect x="400" y="145" width="205" height="142" rx="20" fill="#f8fafc"/><path d="M418 169l85 65 84-65" fill="none" stroke="${spec.accent}" stroke-width="8" stroke-linecap="round"/><circle cx="548" cy="302" r="35" fill="${spec.accent}"/><path d="M532 302h32M548 286v32" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`;
  if (spec.detail === 'help') detail = `<circle cx="500" cy="215" r="100" fill="${spec.accent}" opacity=".18"/><path d="M469 186c4-37 65-42 68-2 2 26-37 28-37 58" fill="none" stroke="${spec.accent}" stroke-width="12" stroke-linecap="round"/><circle cx="500" cy="279" r="8" fill="${spec.accent}"/>`;
  if (spec.detail === 'press') detail = `<path d="M421 196l111-50v138l-111-50z" fill="${spec.accent}"/><rect x="397" y="195" width="32" height="42" rx="8" fill="#f8fafc"/><path d="M454 251l20 73h-35l-18-82" fill="#f8fafc"/><path d="M552 177c24 18 24 58 0 76" fill="none" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>`;
  if (spec.detail === 'product') detail = `<g fill="#f8fafc"><rect x="406" y="130" width="84" height="108" rx="13"/><rect x="500" y="160" width="84" height="108" rx="13"/></g><path d="M450 286h110" stroke="${spec.accent}" stroke-width="12" stroke-linecap="round"/><circle cx="450" cy="286" r="24" fill="${spec.accent}"/><circle cx="560" cy="286" r="24" fill="${spec.accent}"/><path d="M450 286h110" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
  return shell(spec, `${page(105,88,255,250,spec.label,spec.accent)}${detail}`);
}

for (const [name, spec] of Object.entries(specs)) {
  const svg = spec.kind === 'conversion' ? conversion(spec)
    : spec.kind === 'document' ? documentVisual(spec)
    : staticVisual(spec);
  writeFileSync(join(output, `${name}.svg`), svg, 'utf8');
  console.log('generated', `${name}.svg`);
}

