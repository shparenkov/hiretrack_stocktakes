import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Manual "push now" for the Client Links mapping. The real work is done by the
// Bitrix connector's resync_if_changed.js (the same script the daily scheduled
// task HiretrackCompanyResyncDaily runs): it re-derives the company fields of
// the existing deals from HireTrack + client-links.json and writes the
// differences to Bitrix. Run with --force so a click always does the pass, and
// so the script records the mapping hash and the daily task stays quiet.

const TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_TAIL_LINES = 40;

export interface SyncCounts {
  checked: number;
  changed: number;
  updated: number;
  skipped: number;
}

export interface SyncRun {
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  summary: string;
  counts: SyncCounts | null;
  outputTail: string[];
}

export interface SyncStatus {
  running: boolean;
  current: SyncRun | null;
  last: SyncRun | null;
  // Last successful pass (manual or daily), read from the connector's state file.
  lastSyncedAt: string | null;
  lastSyncedSummary: string | null;
  // True when client-links.json differs from what the last successful pass saw.
  pendingChanges: boolean;
  available: boolean;
}

let current: SyncRun | null = null;
let last: SyncRun | null = null;

function connectorDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.CLIENT_LINKS_CONNECTOR_DIR || path.join('..', 'hiretrack_bitrix_connector')
  );
}

function linksFile(): string {
  return path.join(path.resolve(process.cwd(), process.env.CLIENT_LINKS_DATA_DIR || 'data'), 'client-links.json');
}

function currentHash(): string {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(linksFile())).digest('hex');
  } catch {
    return 'no-file';
  }
}

function readConnectorState(): { hash?: string; at?: string; summary?: string } {
  try {
    const raw = fs.readFileSync(path.join(connectorDir(), 'runtime', 'resync-state.json'), 'utf8');
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return {};
  }
}

function scriptPath(): string {
  return path.join(connectorDir(), 'resync_if_changed.js');
}

function parseCounts(summary: string): SyncCounts | null {
  const m = /(\d+) deal\(s\) checked, (\d+) need changes(?:, (\d+) updated)?.*?(\d+) skipped/.exec(summary);
  if (!m) return null;
  return { checked: Number(m[1]), changed: Number(m[2]), updated: Number(m[3] || 0), skipped: Number(m[4]) };
}

function appendLog(text: string): void {
  try {
    fs.appendFileSync(path.join(connectorDir(), 'resync-daily.log'), `${text}\n`);
  } catch {
    // The log is a convenience; never fail the run because of it.
  }
}

export function getSyncStatus(): SyncStatus {
  const state = readConnectorState();
  return {
    running: current !== null,
    current,
    last,
    lastSyncedAt: state.at || null,
    lastSyncedSummary: state.summary || null,
    pendingChanges: state.hash !== currentHash(),
    available: fs.existsSync(scriptPath()),
  };
}

export function startSync(): { started: boolean; status: SyncStatus } {
  if (current) return { started: false, status: getSyncStatus() };
  if (!fs.existsSync(scriptPath())) {
    throw new Error('Коннектор не найден на сервере (resync_if_changed.js).');
  }

  const run: SyncRun = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: null,
    summary: '',
    counts: null,
    outputTail: [],
  };
  current = run;
  appendLog(`[${run.startedAt}] manual sync from Client Links page`);

  const lines: string[] = [];
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) lines.push(line);
    }
    run.outputTail = lines.slice(-OUTPUT_TAIL_LINES);
  };

  const finish = (ok: boolean, summary: string) => {
    if (run.finishedAt) return;
    run.finishedAt = new Date().toISOString();
    run.ok = ok;
    run.summary = summary;
    run.counts = parseCounts(summary);
    run.outputTail = lines.slice(-OUTPUT_TAIL_LINES);
    appendLog(lines.join('\n'));
    last = run;
    current = null;
  };

  const child = spawn(process.execPath, [scriptPath(), '--force'], {
    cwd: connectorDir(),
    windowsHide: true,
  });
  const timer = setTimeout(() => {
    child.kill();
    finish(false, 'Прервано по таймауту (30 минут).');
  }, TIMEOUT_MS);

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (error) => {
    clearTimeout(timer);
    finish(false, `Не удалось запустить: ${error.message}`);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    // The script's last "done:/FAILED" line carries the resync summary.
    const tail = [...lines].reverse().find((l) => /deal\(s\) checked|FAILED|failed/.test(l)) || lines[lines.length - 1] || '';
    finish(code === 0, tail.replace(/^\[[^\]]*\]\s*(done:\s*)?/, ''));
  });

  return { started: true, status: getSyncStatus() };
}
