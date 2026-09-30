#!/usr/bin/env node
/**
 * GastroBar Print — estación de impresión para térmicas (ESC/POS).
 *
 * Corre en el PC del local donde están las impresoras. Toma los tiquetes de la cola
 * de GastroBar y los imprime sin diálogo: USB o compartidas (Windows) y de red (IP).
 * No necesita instalar nada más que Node.js 18 o superior.
 *
 *   node gastrobar-print.mjs vincular CODIGO --app https://tu-gastrobar.vercel.app
 *   node gastrobar-print.mjs              (queda imprimiendo; dejarlo abierto)
 *   node gastrobar-print.mjs impresoras   (lista las impresoras que ve este PC)
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const VERSION = '1.0.0';

// ─── Formato: documento → líneas → bytes ESC/POS ───────────────────────────────

/** Caracteres por línea (fuente A) según el ancho del papel. */
export const COLUMNS = { 80: 48, 58: 32 };

const CP850 = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a, Á: 0xb5, É: 0x90, Í: 0xd6,
  Ó: 0xe0, Ú: 0xe9, '¿': 0xa8, '¡': 0xad, '°': 0xf8, '€': 0xd5, ç: 0x87, Ç: 0x80, '·': 0xfa, '×': 0x9e,
};
const CODEPAGE_SELECT = { cp850: 2, cp1252: 16 };

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Texto → bytes en la tabla de caracteres de la impresora (tildes y ñ incluidas). */
export function encodeText(text, codepage = 'cp850') {
  const out = [];
  // Los montos formateados (es-CO) traen espacios no separables: a la impresora van como espacio normal.
  for (const ch of String(text).replace(/[  ]/g, ' ')) {
    const code = ch.codePointAt(0);
    if (code < 0x80) out.push(code);
    else if (codepage === 'cp850' && CP850[ch] !== undefined) out.push(CP850[ch]);
    else if (codepage === 'cp1252' && ch === '€') out.push(0x80);
    else if (codepage === 'cp1252' && code <= 0xff) out.push(code);
    else {
      const plain = stripAccents(ch);
      out.push(plain.length === 1 && plain.codePointAt(0) < 0x80 ? plain.codePointAt(0) : 0x3f);
    }
  }
  return out;
}

function wrap(text, width) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let word of words) {
    while (word.length > width) {
      if (line) lines.push(line), (line = '');
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else lines.push(line), (line = word);
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/**
 * Documento de GastroBar → líneas ya partidas al ancho del papel.
 * Bloques: {t:'text', text, align, bold, big} · {t:'row', left, right, bold} · {t:'rule', char} · {t:'feed', lines}
 */
export function layout(doc, paperWidth = 80) {
  const cols = COLUMNS[paperWidth] ?? 48;
  const lines = [];
  for (const b of doc?.blocks ?? []) {
    if (b.t === 'text') {
      const width = b.big ? Math.floor(cols / 2) : cols;
      for (const text of wrap(b.text, width)) lines.push({ text, align: b.align ?? 'left', bold: Boolean(b.bold), big: Boolean(b.big) });
    } else if (b.t === 'row') {
      const right = String(b.right ?? '');
      const leftWidth = Math.max(8, cols - right.length - 1);
      wrap(b.left, leftWidth).forEach((left, i) => {
        const text = i === 0 ? left + ' '.repeat(Math.max(1, cols - left.length - right.length)) + right : left;
        lines.push({ text, align: 'left', bold: Boolean(b.bold), big: false });
      });
    } else if (b.t === 'rule') {
      lines.push({ text: (b.char ?? '-').repeat(cols), align: 'left', bold: false, big: false });
    } else if (b.t === 'feed') {
      for (let i = 0; i < (b.lines ?? 1); i++) lines.push({ text: '', align: 'left', bold: false, big: false });
    }
  }
  return lines;
}

const ESC = 0x1b;
const GS = 0x1d;
const ALIGN = { left: 0, center: 1, right: 2 };

/** Documento → bytes ESC/POS (genérico: Epson, Bixolon, Xprinter, SAT, 3nStar, Star en emulación…). */
export function renderEscPos(doc, { paperWidth = 80, codepage = 'cp850', cut = true, openDrawer = false, copies = 1 } = {}) {
  const body = [ESC, 0x40];
  if (CODEPAGE_SELECT[codepage] !== undefined) body.push(ESC, 0x74, CODEPAGE_SELECT[codepage]);
  for (const line of layout(doc, paperWidth)) {
    body.push(ESC, 0x61, ALIGN[line.align] ?? 0, ESC, 0x45, line.bold ? 1 : 0, GS, 0x21, line.big ? 0x11 : 0x00);
    body.push(...encodeText(line.text, codepage), 0x0a);
  }
  body.push(GS, 0x21, 0x00, ESC, 0x45, 0, ESC, 0x61, 0, ESC, 0x64, 4);
  if (cut) body.push(GS, 0x56, 0x42, 0x00);
  const bytes = [];
  if (openDrawer) bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa);
  for (let i = 0; i < Math.max(1, Math.min(5, copies)); i++) bytes.push(...body);
  return Buffer.from(bytes);
}

/** Documento → texto plano (modo universal: cualquier impresora con controlador). */
export function renderText(doc, { paperWidth = 80, copies = 1 } = {}) {
  const cols = COLUMNS[paperWidth] ?? 48;
  const text = layout(doc, paperWidth)
    .map(({ text, align }) => {
      const pad = align === 'center' ? Math.floor((cols - text.length) / 2) : align === 'right' ? cols - text.length : 0;
      return ' '.repeat(Math.max(0, pad)) + text;
    })
    .join('\r\n');
  return Array.from({ length: Math.max(1, Math.min(5, copies)) }, () => text).join('\r\n\r\n\r\n');
}

/** Tiquete de prueba: tildes, eñes, filas y ancho. */
export function testDocument(stationName = 'GastroBar') {
  return {
    blocks: [
      { t: 'text', text: 'PRUEBA DE IMPRESIÓN', align: 'center', bold: true, big: true },
      { t: 'text', text: stationName, align: 'center' },
      { t: 'rule' },
      { t: 'text', text: 'Tildes: á é í ó ú  Á É Í Ó Ú' },
      { t: 'text', text: 'Eñes: ñ Ñ  ·  ¿Todo bien? ¡Listo!' },
      { t: 'row', left: '2 x Café con leche', right: '$ 12.000' },
      { t: 'row', left: 'TOTAL', right: '$ 12.000', bold: true },
      { t: 'rule', char: '=' },
      { t: 'text', text: 'Si lees bien las tildes, la tabla de caracteres es la correcta.', align: 'center' },
    ],
  };
}

// ─── Envío a la impresora ──────────────────────────────────────────────────────

const run = promisify(execFile);
const isWindows = process.platform === 'win32';
// Ruta fija: no depende de que PowerShell esté en el PATH de quien abrió el programa.
const POWERSHELL = isWindows ? path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh';

const RAW_PS1 = `param([string]$printer, [string]$file)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class GbRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("No encuentro la impresora '" + printer + "' en Windows");
    try {
      var di = new DOCINFO(); di.pDocName = "GastroBar"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("Windows no aceptó el trabajo (" + Marshal.GetLastWin32Error() + ")");
      StartPagePrinter(h); int w;
      if (!WritePrinter(h, bytes, bytes.Length, out w)) throw new Exception("No se pudo enviar a la impresora (" + Marshal.GetLastWin32Error() + ")");
      EndPagePrinter(h); EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
try {
  [GbRawPrint]::Send($printer, [IO.File]::ReadAllBytes($file))
} catch {
  $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message); exit 1
}
`;

const TEXT_PS1 = `param([string]$printer, [string]$file)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Get-Content -LiteralPath $file -Raw -Encoding UTF8 | Out-Printer -Name $printer
} catch {
  $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message); exit 1
}
`;

function tempFile(name, content) {
  const file = path.join(os.tmpdir(), name);
  writeFileSync(file, content);
  return file;
}

async function powershell(script, args) {
  const ps1 = tempFile(`gastrobar-${script === RAW_PS1 ? 'raw' : 'text'}.ps1`, script);
  try {
    await run(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...args], { timeout: 30_000, windowsHide: true });
  } catch (error) {
    const msg = String(error.stderr || error.message || error).split('\n').find((l) => l.trim() && !l.startsWith('At ')) ?? 'Error de impresión';
    throw new Error(msg.replace(/^.*Exception[^:]*:\s*/, '').trim());
  }
}

function sendNetwork(target, bytes) {
  const [host, port = '9100'] = target.split(':');
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: Number(port) });
    socket.setTimeout(8000);
    socket.on('connect', () => socket.end(bytes));
    socket.on('close', (hadError) => !hadError && resolve());
    socket.on('timeout', () => (socket.destroy(), reject(new Error(`La impresora ${target} no responde`))));
    socket.on('error', (e) => reject(new Error(`No hay conexión con ${target} (${e.code ?? e.message})`)));
  });
}

export async function sendToPrinter(printer, job) {
  const opts = { paperWidth: printer.paper_width, codepage: printer.codepage, cut: printer.cut, openDrawer: job.open_drawer, copies: job.copies };
  if (printer.mode === 'text') {
    const text = renderText(job.payload, opts);
    if (printer.connection === 'network') return sendNetwork(printer.target, Buffer.from(encodeText(text + '\r\n\r\n\r\n\r\n', 'ascii')));
    const file = tempFile(`gastrobar-${job.id}.txt`, text);
    if (isWindows) return powershell(TEXT_PS1, ['-printer', printer.target, '-file', file]);
    return run('lp', ['-d', printer.target, file]).then(() => undefined);
  }
  const bytes = renderEscPos(job.payload, opts);
  if (printer.connection === 'network') return sendNetwork(printer.target, bytes);
  const file = tempFile(`gastrobar-${job.id}.bin`, bytes);
  if (isWindows) return powershell(RAW_PS1, ['-printer', printer.target, '-file', file]);
  return run('lp', ['-d', printer.target, '-o', 'raw', file]).then(() => undefined);
}

/** Impresoras que ve este PC (para elegirlas desde GastroBar). */
export async function discoverPrinters() {
  try {
    if (isWindows) {
      const { stdout } = await run(
        POWERSHELL,
        ['-NoProfile', '-Command', 'Get-Printer | Select-Object Name,DriverName,PortName | ConvertTo-Json -Compress'],
        { timeout: 20_000, windowsHide: true },
      );
      const parsed = stdout.trim() ? JSON.parse(stdout) : [];
      return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ name: p.Name, driver: p.DriverName, port: p.PortName }));
    }
    const { stdout } = await run('lpstat', ['-a'], { timeout: 10_000 });
    return stdout.split('\n').filter(Boolean).map((l) => ({ name: l.split(' ')[0] }));
  } catch {
    return [];
  }
}

// ─── Conexión con GastroBar ────────────────────────────────────────────────────

const CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gastrobar-print.json');
const log = (...args) => console.log(new Date().toLocaleTimeString('es-CO'), ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
}

async function rpc(cfg, fn, body) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || `Error ${res.status}`);
  return data;
}

async function pair(code, appUrl) {
  if (!code || !appUrl) throw new Error('Uso: node gastrobar-print.mjs vincular CODIGO --app https://tu-gastrobar.vercel.app');
  const base = appUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/print/config`);
  if (!res.ok) throw new Error(`No pude conectar con ${base}`);
  const { supabaseUrl, anonKey } = await res.json();
  const cfg = { app: base, supabaseUrl, anonKey };
  const result = await rpc(cfg, 'print_agent_pair', { p_code: code, p_name: os.hostname() });
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...cfg, token: result.token, stationId: result.station_id }, null, 2));
  log(`Vinculado con ${result.tenant}. Ahora ejecuta: node gastrobar-print.mjs`);
}

async function serve() {
  const cfg = loadConfig();
  if (!cfg) throw new Error('Este PC no está vinculado. Ejecuta: node gastrobar-print.mjs vincular CODIGO --app https://tu-gastrobar.vercel.app');
  log(`GastroBar Print ${VERSION} — iniciando…`);
  let printers = new Map();
  let lastBeat = 0;
  let lastDiscovery = 0;
  for (;;) {
    try {
      const now = Date.now();
      if (now - lastBeat > 15_000) {
        const discovered = now - lastDiscovery > 60_000 ? await discoverPrinters() : null;
        if (discovered) lastDiscovery = now;
        const hb = await rpc(cfg, 'print_agent_heartbeat', { p_token: cfg.token, p_version: VERSION, p_discovered: discovered });
        if (!lastBeat) log(`Conectado a ${hb.tenant} como "${hb.station.name}". Impresoras: ${hb.printers.map((p) => p.name).join(', ') || 'ninguna aún'}`);
        printers = new Map(hb.printers.map((p) => [p.id, p]));
        lastBeat = now;
      }
      const jobs = await rpc(cfg, 'print_agent_pull', { p_token: cfg.token, p_limit: 10 });
      for (const job of jobs) {
        const printer = printers.get(job.printer_id);
        try {
          if (!printer) throw new Error('La impresora no está activa en esta estación');
          await sendToPrinter(printer, job);
          await rpc(cfg, 'print_agent_report', { p_token: cfg.token, p_job_id: job.id, p_ok: true });
          log(`✓ ${job.title} → ${printer.name}`);
        } catch (error) {
          await rpc(cfg, 'print_agent_report', { p_token: cfg.token, p_job_id: job.id, p_ok: false, p_error: error.message }).catch(() => undefined);
          log(`✗ ${job.title}: ${error.message}`);
          lastBeat = 0; // refresca la configuración por si cambió
        }
      }
    } catch (error) {
      if (/invalid_print_token/.test(error.message)) {
        throw new Error('Esta estación fue desvinculada en GastroBar. Vuelve a vincularla con un código nuevo.');
      }
      log(`Sin conexión con GastroBar (${error.message}). Reintento en 5 s…`);
      await sleep(5000);
    }
    await sleep(2000);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name) => rest[rest.indexOf(name) + 1];
  if (command === 'vincular' || command === 'pair') return pair(rest[0], flag('--app'));
  if (command === 'impresoras' || command === 'printers') {
    const list = await discoverPrinters();
    return list.forEach((p) => console.log(`- ${p.name}${p.port ? `  (puerto ${p.port})` : ''}`));
  }
  if (command === 'version') return console.log(VERSION);
  return serve();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}
