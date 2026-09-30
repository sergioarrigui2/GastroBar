// Tipos del programa GastroBar Print (para las pruebas de la app).
export type Block =
  | { t: 'text'; text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; big?: boolean }
  | { t: 'row'; left: string; right: string; bold?: boolean }
  | { t: 'rule'; char?: '-' | '=' }
  | { t: 'feed'; lines?: number };
export type Doc = { blocks: Block[] };
export type Line = { text: string; align: 'left' | 'center' | 'right'; bold: boolean; big: boolean };
export type RenderOptions = { paperWidth?: 58 | 80; codepage?: 'cp850' | 'cp1252' | 'ascii'; cut?: boolean; openDrawer?: boolean; copies?: number };
export const VERSION: string;
export const COLUMNS: { 80: number; 58: number };
export function encodeText(text: string, codepage?: 'cp850' | 'cp1252' | 'ascii'): number[];
export function layout(doc: Doc, paperWidth?: 58 | 80): Line[];
export function renderEscPos(doc: Doc, options?: RenderOptions): Buffer;
export function renderText(doc: Doc, options?: { paperWidth?: 58 | 80; copies?: number }): string;
export function testDocument(stationName?: string): Doc;
export function discoverPrinters(): Promise<Array<{ name: string; driver?: string; port?: string }>>;
export function sendToPrinter(printer: { connection: 'windows' | 'network'; target: string; paper_width: 58 | 80; codepage: 'cp850' | 'cp1252' | 'ascii'; mode: 'escpos' | 'text'; cut: boolean }, job: { id: string; payload: Doc; copies: number; open_drawer: boolean }): Promise<void>;
