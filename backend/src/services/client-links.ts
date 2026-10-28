import fs from 'fs';
import path from 'path';

// Mapping between HireTrack companies (JOBS.Client / Venue / payer) and the
// Bitrix24 "Заказчики" (company category 16, synced one-way from 1C). One
// HireTrack company can point at several Bitrix companies (several legal
// entities); one of them is the default that new deals use. Several
// HireTrack companies may point at the same Bitrix company (e.g. private
// persons working through one sole proprietor). Nothing here writes to
// HireTrack or Bitrix - the file below is the staging area ("sandbox").

export type LinkStatus = 'linked' | 'none';

export interface ClientLinkEntity {
  bitrixId: number;
  isDefault: boolean;
}

export interface ClientLink {
  status: LinkStatus;
  entities: ClientLinkEntity[];
  note: string;
  updatedAt: string;
}

interface LinksFile {
  version: 1;
  links: Record<string, ClientLink>;
}

export interface BitrixCompany {
  id: number;
  title: string;
  categoryId: number;
  originId: string;
  inn: string;
  kpp: string;
  requisiteNames: string[];
  htLinkId: number | null;
}

function dataDir(): string {
  return path.resolve(process.cwd(), process.env.CLIENT_LINKS_DATA_DIR || 'data');
}

function linksPath(): string {
  return path.join(dataDir(), 'client-links.json');
}

function logPath(): string {
  return path.join(dataDir(), 'client-links-log.jsonl');
}

function readFile(): LinksFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(linksPath(), 'utf8')) as LinksFile;
    if (parsed && parsed.links && typeof parsed.links === 'object') return parsed;
  } catch {
    // Missing or unreadable file means "no links yet".
  }
  return { version: 1, links: {} };
}

export function getAllLinks(): Record<string, ClientLink> {
  return readFile().links;
}

export interface SaveLinkInput {
  status: LinkStatus;
  entities: { bitrixId: number; isDefault?: boolean }[];
  note?: string;
}

export function normalizeLinkInput(input: SaveLinkInput): ClientLink {
  if (input.status !== 'linked' && input.status !== 'none') {
    throw new Error('status must be "linked" or "none"');
  }
  const seen = new Set<number>();
  const entities: ClientLinkEntity[] = [];
  if (input.status === 'linked') {
    for (const entity of input.entities || []) {
      const bitrixId = Number(entity.bitrixId);
      if (!Number.isInteger(bitrixId) || bitrixId <= 0 || seen.has(bitrixId)) continue;
      seen.add(bitrixId);
      entities.push({ bitrixId, isDefault: Boolean(entity.isDefault) });
    }
    if (!entities.length) throw new Error('A linked company needs at least one Bitrix company');
    // Exactly one default: the first flagged one, else the first entity.
    const defaultIndex = Math.max(0, entities.findIndex((e) => e.isDefault));
    entities.forEach((e, i) => {
      e.isDefault = i === defaultIndex;
    });
  }
  return {
    status: input.status,
    entities,
    note: String(input.note || '').slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
}

function writeAtomic(file: LinksFile): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${linksPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 1), 'utf8');
  fs.renameSync(tmp, linksPath());
}

function appendLog(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.appendFileSync(logPath(), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch {
    // The audit log is best-effort; never fail a save over it.
  }
}

// input === null resets the company back to "not matched".
export function saveLink(htId: number, input: SaveLinkInput | null): ClientLink | null {
  const file = readFile();
  const key = String(htId);
  const before = file.links[key] || null;
  if (input === null) {
    delete file.links[key];
    writeAtomic(file);
    appendLog({ htId, action: 'reset', before });
    return null;
  }
  const link = normalizeLinkInput(input);
  file.links[key] = link;
  writeAtomic(file);
  appendLog({ htId, action: 'save', before, after: link });
  return link;
}

// ---- Bitrix side (read-only) ----

interface BitrixConfigShape {
  bitrix?: { baseUrl?: string };
}

// The Bitrix webhook lives in the connector's own config, which sits next to
// this app on the HireTrack server; read it from there rather than copying
// the secret into this service's environment.
function defaultConnectorConfigPath(): string {
  return path.resolve(process.cwd(), '..', 'hiretrack_bitrix_connector', 'hiretrack.config.json');
}

function bitrixBaseUrl(): string {
  const configPath = process.env.CLIENT_LINKS_BITRIX_CONFIG || defaultConnectorConfigPath();
  let baseUrl = process.env.CLIENT_LINKS_BITRIX_WEBHOOK || '';
  if (!baseUrl && configPath) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as BitrixConfigShape;
    baseUrl = parsed.bitrix?.baseUrl || '';
  }
  if (!baseUrl) {
    throw new Error(
      'Bitrix is not configured: connector config not found (set CLIENT_LINKS_BITRIX_CONFIG or CLIENT_LINKS_BITRIX_WEBHOOK)'
    );
  }
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

async function bitrixCall(method: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${bitrixBaseUrl()}${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Bitrix ${method} failed: HTTP ${response.status}`);
  const json = (await response.json()) as any;
  if (json.error) throw new Error(`Bitrix ${method}: ${json.error_description || json.error}`);
  return json;
}

async function listAll(method: string, params: Record<string, unknown>, pick: (r: any) => any[]): Promise<any[]> {
  const rows: any[] = [];
  let start = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const response = await bitrixCall(method, { ...params, start });
    rows.push(...pick(response));
    if (response.next === undefined || response.next === null) break;
    start = response.next;
  }
  return rows;
}

let bitrixCache: { at: number; data: BitrixCompany[] } | null = null;

export async function getBitrixCompanies(forceRefresh = false): Promise<BitrixCompany[]> {
  const now = Date.now();
  if (!forceRefresh && bitrixCache && now - bitrixCache.at < 10 * 60_000) return bitrixCache.data;

  // crm.company.list ignores company categories (it only sees the default
  // one), so the 1C "Заказчики" (category 16) are only reachable through the
  // universal crm.item.list for entityTypeId 4.
  const items: any[] = [];
  for (const categoryId of [16, 0]) {
    const rows = await listAll(
      'crm.item.list',
      {
        entityTypeId: 4,
        filter: { categoryId },
        select: ['id', 'title', 'categoryId', 'originId', 'ufCrmHiretrackCompanyId'],
        order: { id: 'ASC' },
      },
      (r) => r.result?.items || []
    );
    items.push(...rows);
  }
  const requisites = await listAll(
    'crm.requisite.list',
    {
      filter: { ENTITY_TYPE_ID: 4 },
      select: [
        'ID',
        'ENTITY_ID',
        'NAME',
        'RQ_INN',
        'RQ_KPP',
        'RQ_COMPANY_NAME',
        'RQ_COMPANY_FULL_NAME',
        'RQ_LAST_NAME',
        'RQ_FIRST_NAME',
        'RQ_SECOND_NAME',
      ],
    },
    (r) => r.result || []
  );
  const byCompany = new Map<number, any[]>();
  for (const requisite of requisites) {
    const key = Number(requisite.ENTITY_ID);
    byCompany.set(key, [...(byCompany.get(key) || []), requisite]);
  }
  const data = items.map<BitrixCompany>((item) => {
    const own = byCompany.get(Number(item.id)) || [];
    const names = new Set<string>();
    for (const r of own) {
      const person = [r.RQ_LAST_NAME, r.RQ_FIRST_NAME, r.RQ_SECOND_NAME].filter(Boolean).join(' ');
      for (const value of [r.NAME, r.RQ_COMPANY_NAME, r.RQ_COMPANY_FULL_NAME, person]) {
        if (value && String(value).trim()) names.add(String(value).trim());
      }
    }
    const first = own.find((r) => r.RQ_INN) || own[0];
    return {
      id: Number(item.id),
      title: String(item.title || ''),
      categoryId: Number(item.categoryId ?? 0),
      originId: String(item.originId || ''),
      inn: first?.RQ_INN ? String(first.RQ_INN).trim() : '',
      kpp: first?.RQ_KPP ? String(first.RQ_KPP).trim() : '',
      requisiteNames: [...names],
      htLinkId: item.ufCrmHiretrackCompanyId ? Number(item.ufCrmHiretrackCompanyId) : null,
    };
  });
  bitrixCache = { at: now, data };
  return data;
}
