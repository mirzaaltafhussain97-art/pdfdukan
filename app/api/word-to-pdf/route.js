import { access, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const run = promisify(execFile);
const limit = 50 * 1024 * 1024;
let busy = false;
const conversionRoot = path.resolve(process.cwd(), 'tmp', 'word-to-pdf-jobs');
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
function localRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  return process.env.NODE_ENV !== 'production' && localHosts.has(url.hostname) &&
    (!origin || origin === url.origin);
}
async function converter() {
  if (process.platform === 'win32') {
    const wordCandidates = [
      'C:/Program Files/Microsoft Office/root/Office16/WINWORD.EXE',
      'C:/Program Files (x86)/Microsoft Office/root/Office16/WINWORD.EXE',
    ];
    for (const candidate of wordCandidates) {
      try {
        await access(candidate);
        return {
          engine: 'microsoft-word',
          label: 'Microsoft Word',
          command: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
        };
      } catch {}
    }
  }

  const officeCandidates = process.platform === 'win32'
    ? ['C:/Program Files/LibreOffice/program/soffice.com', 'C:/Program Files (x86)/LibreOffice/program/soffice.com']
    : ['/usr/bin/libreoffice', '/usr/bin/soffice'];
  for (const candidate of officeCandidates) {
    try {
      await access(candidate);
      return { engine: 'libreoffice', label: 'LibreOffice', command: candidate };
    } catch {}
  }
  throw new Error('Microsoft Word or LibreOffice is required for high-fidelity conversion.');
}
export async function GET(request) {
  if (!localRequest(request)) return Response.json({ error: 'Local converter only. Production needs a dedicated conversion service.' }, { status: 503 });
  try {
    const available = await converter();
    return Response.json({ ready: true, engine: available.engine, label: available.label });
  }
  catch (error) { return Response.json({ ready: false, error: error.message }, { status: 503 }); }
}
export async function POST(request) {
  if (!localRequest(request)) return Response.json({ error: 'This converter is available only on the local preview.' }, { status: 403 });
  if (busy) return Response.json({ error: 'Another document is converting. Please wait.' }, { status: 429 });
  let job;
  busy = true;
  try {
    const available = await converter();
    if (Number(request.headers.get('content-length')) > limit) throw new Error('Maximum DOCX size is 50 MB.');
    const chunks = []; let size = 0;
    for await (const chunk of request.body) {
      size += chunk.length;
      if (size > limit) throw new Error('Maximum DOCX size is 50 MB.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('Choose a valid DOCX file.');
    await mkdir(conversionRoot, { recursive: true });
    job = await mkdtemp(path.join(conversionRoot, 'pdfdukan-word-'));
    const profile = path.join(job, 'profile');
    await mkdir(path.join(profile, 'user'), { recursive: true });
    await writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
    await writeFile(path.join(job, 'input.docx'), bytes);
    const inputPath = path.join(job, 'input.docx');
    const outputPath = path.join(job, 'input.pdf');
    if (available.engine === 'microsoft-word') {
      const scriptPath = path.join(job, 'convert-word.ps1');
      const script = `param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $document = $word.Documents.Open($InputPath, $false, $true)
  $document.ExportAsFixedFormat($OutputPath, 17)
} finally {
  if ($document) { $document.Close(0); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($word) { $word.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}`;
      await writeFile(scriptPath, script, 'utf8');
      await run(available.command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, inputPath, outputPath], { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 });
    } else {
      await run(available.command, ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless', '--nologo', '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', job, inputPath], { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 });
    }
    const pdf = await readFile(outputPath);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('The office engine did not produce a PDF.');
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="converted.pdf"', 'X-Conversion-Engine': available.engine } });
  } catch (error) {
    return Response.json({ error: error.killed ? 'Conversion exceeded two minutes.' : error.message }, { status: 503 });
  } finally {
    if (job && path.dirname(job) === conversionRoot && path.basename(job).startsWith('pdfdukan-word-')) await rm(job, { recursive: true, force: true }).catch(() => {});
    busy = false;
  }
}
