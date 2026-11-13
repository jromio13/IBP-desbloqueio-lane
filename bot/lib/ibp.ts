// SAP IBP master data. Transportation lanes are DRPTLANE in planning area GBDRP.
// A lane is blocked when TLANEBLOCKEDFORPLANNING is "X".

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// `agent-sdk serve` loads .env.local. A direct tool call does not, so load it here.
function ensureLocalEnv(): void {
  if ((process.env.IBP_USER?.trim() ?? "") !== "" && (process.env.IBP_PASSWORD ?? "") !== "") {
    return;
  }
  const path = join(projectRoot, ".env.local");
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // Leave the tool to report ibp_not_configured.
  }
}

export type LaneKey = {
  locfr: string;
  locto: string;
  prdid: string;
  motid: string;
  addlaneid: string;
};

export type LaneQuery = {
  locfr?: string;
  locto?: string;
  prdid?: string;
  prdids?: string[];
  motid?: string;
  addlaneid?: string;
};

export type LaneRecord = LaneKey & {
  blocked: boolean;
  markedForDeletion: boolean;
  leadTime: number | null;
  priority: number | null;
  validFrom: string | null;
  validTo: string | null;
  marca: string | null;
};

export type LaneSearchResult = {
  ok: true;
  planningArea: string;
  version: string;
  count: number;
  truncated: boolean;
  lanes: LaneRecord[];
};

export type IbpFailure = {
  ok: false;
  error: string;
  detail?: string;
};

const ID_PATTERN = /^[A-Za-z0-9._/-]+$/;
const LIMIT = 40;

type Config = {
  baseUrl: string;
  user: string;
  password: string;
  planningArea: string;
  version: string;
};

export function ibpConfig(): Config | IbpFailure {
  ensureLocalEnv();
  const user = process.env.IBP_USER?.trim() ?? "";
  const password = process.env.IBP_PASSWORD ?? "";
  const planningArea = process.env.IBP_PLANNING_AREA?.trim() || "GBDRP";
  const version = process.env.IBP_VERSION?.trim() || "__BASELINE";
  const baseUrl = (
    process.env.IBP_BASE_URL?.trim() ||
    "https://my400703-api.scmibp.ondemand.com/sap/opu/odata/IBP/MASTER_DATA_API_SRV"
  ).replace(/\/$/, "");
  if (user === "" || password === "") {
    return { ok: false, error: "ibp_not_configured" };
  }
  return { baseUrl, user, password, planningArea, version };
}

export function invalidId(value: string): boolean {
  return !ID_PATTERN.test(value);
}

export async function searchLanes(
  query: LaneQuery,
): Promise<LaneSearchResult | IbpFailure> {
  const config = ibpConfig();
  if ("error" in config) return config;
  const filters = [
    `PlanningAreaID eq '${odataQuote(config.planningArea)}'`,
    `VersionID eq '${odataQuote(config.version)}'`,
  ];
  const fields: Array<[string, string | undefined]> = [
    ["LOCFR", query.locfr],
    ["LOCTO", query.locto],
    ["MOTID", query.motid],
    ["ADDLANEID", query.addlaneid],
  ];
  for (const [field, value] of fields) {
    if (value === undefined || value === "") continue;
    if (invalidId(value)) return { ok: false, error: "invalid_id", detail: field };
    filters.push(`${field} eq '${odataQuote(value)}'`);
  }
  const materials = [
    ...new Set(
      [...(query.prdids ?? []), ...(query.prdid ? [query.prdid] : [])].filter((id) => id !== ""),
    ),
  ];
  if (materials.length > 0) {
    for (const id of materials) {
      if (invalidId(id)) return { ok: false, error: "invalid_id", detail: "PRDID" };
    }
    const clauses = materials.map((id) => `PRDID eq '${odataQuote(id)}'`);
    filters.push(clauses.length === 1 ? clauses[0] : `(${clauses.join(" or ")})`);
  }
  if (filters.length === 2) return { ok: false, error: "missing_key" };

  const url = `${config.baseUrl}/DRPTLANE?$format=json&$top=${LIMIT + 1}&$filter=${encodeURIComponent(filters.join(" and "))}`;
  const response = await ibpGet(config, url);
  if (!response.ok) return response;
  const rows = odataRows(response.body);
  const truncated = rows.length > LIMIT;
  const lanes = rows.slice(0, LIMIT).map(toLane);
  return {
    ok: true,
    planningArea: config.planningArea,
    version: config.version,
    count: lanes.length,
    truncated,
    lanes,
  };
}

export async function findLane(
  key: LaneKey,
): Promise<{ ok: true; lane: LaneRecord | null } | IbpFailure> {
  const found = await searchLanes(key);
  if (!found.ok) return found;
  return { ok: true, lane: found.lanes[0] ?? null };
}

export type LaneAction = "bloquear" | "desbloquear";

// Sets both planning block and deletion mark. A repeat with the same result
// does not post again.
export async function applyLaneFlags(
  keys: LaneKey[],
  action: LaneAction,
): Promise<
  | {
      ok: true;
      changed: number;
      ibpChanged: boolean;
      messages: string[];
      planningArea: string;
      version: string;
      truncated: boolean;
      lanes: LaneRecord[];
    }
  | IbpFailure
> {
  const mark = action === "bloquear";
  const pending: LaneKey[] = [];
  for (const key of keys) {
    if (Object.values(key).some(invalidId)) return { ok: false, error: "invalid_id" };
    const current = await findLane(key);
    if (!current.ok) return current;
    if (current.lane === null) return { ok: false, error: "not_found", detail: key.prdid };
    if (current.lane.blocked !== mark || current.lane.markedForDeletion !== mark) {
      pending.push(key);
    }
  }

  let messages: string[] = [];
  if (pending.length > 0) {
    const config = ibpConfig();
    if ("error" in config) return config;
    const session = await openWriteSession(config);
    if (!session.ok) return session;
    const flag = mark ? "X" : "";
    const posted = await ibpSend(config, `${config.baseUrl}/DRPTLANETrans`, {
      method: "POST",
      body: JSON.stringify({
        TransactionID: session.transactionId,
        PlanningAreaID: config.planningArea,
        VersionID: config.version,
        DoCommit: true,
        DeleteEntries: false,
        RequestedAttributes:
          "LOCTO,LOCFR,PRDID,ADDLANEID,MOTID,TLANEBLOCKEDFORPLANNING,TLANEDEL",
        NavDRPTLANE: pending.map((key) => ({
          LOCTO: key.locto,
          LOCFR: key.locfr,
          PRDID: key.prdid,
          ADDLANEID: key.addlaneid,
          MOTID: key.motid,
          TLANEBLOCKEDFORPLANNING: flag,
          TLANEDEL: flag,
        })),
      }),
      csrf: session.csrf,
      cookie: session.cookie,
    });
    if (!posted.ok) return posted;
    messages = await readMessages(config, session, session.transactionId);
    for (const key of pending) {
      const after = await findLane(key);
      if (!after.ok) return after;
      if (
        after.lane === null ||
        after.lane.blocked !== mark ||
        after.lane.markedForDeletion !== mark
      ) {
        return {
          ok: false,
          error: "not_applied",
          detail: messages.join(" ").slice(0, 300),
        };
      }
    }
  }

  const listed = await searchLanes({ prdids: [...new Set(keys.map((key) => key.prdid))] });
  if (!listed.ok) return listed;
  return {
    ok: true,
    changed: pending.length,
    ibpChanged: pending.length > 0,
    messages,
    planningArea: listed.planningArea,
    version: listed.version,
    truncated: listed.truncated,
    lanes: listed.lanes,
  };
}

function odataQuote(value: string): string {
  return value.replaceAll("'", "''");
}

function toLane(row: Record<string, unknown>): LaneRecord {
  return {
    locfr: asString(row.LOCFR),
    locto: asString(row.LOCTO),
    prdid: asString(row.PRDID),
    motid: asString(row.MOTID),
    addlaneid: asString(row.ADDLANEID),
    blocked: asString(row.TLANEBLOCKEDFORPLANNING).toUpperCase() === "X",
    markedForDeletion: asString(row.TLANEDEL).toUpperCase() === "X",
    leadTime: asNumber(row.LEADTIME),
    priority: asNumber(row.TLANEPRIO),
    validFrom: sapDate(row.TLANEVALIDFR),
    validTo: sapDate(row.TLANEVALIDTO),
    marca: asString(row.ZMARCAS) || null,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function sapDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /\/Date\((-?\d+)/.exec(value);
  if (match === null) return null;
  const date = new Date(Number(match[1]));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function odataRows(body: unknown): Record<string, unknown>[] {
  if (body === null || typeof body !== "object") return [];
  const root = body as { d?: { results?: unknown } };
  const results = root.d?.results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (row): row is Record<string, unknown> => row !== null && typeof row === "object",
  );
}

type WriteSession = {
  ok: true;
  transactionId: string;
  csrf: string;
  cookie: string;
};

async function openWriteSession(config: Config): Promise<WriteSession | IbpFailure> {
  const response = await ibpSend(
    config,
    `${config.baseUrl}/GetTransactionID?$format=json`,
    { method: "GET", csrf: "Fetch" },
  );
  if (!response.ok) return response;
  const transactionId = transactionValue(response.body);
  const csrf = response.csrf ?? "";
  if (transactionId === "" || csrf === "") {
    return { ok: false, error: "ibp_write_session_failed" };
  }
  return { ok: true, transactionId, csrf, cookie: response.cookie };
}

function transactionValue(body: unknown): string {
  if (body === null || typeof body !== "object") return "";
  const value = (body as { d?: { Value?: unknown } }).d?.Value;
  return typeof value === "string" ? value : "";
}

async function readMessages(
  config: Config,
  session: WriteSession,
  transactionId: string,
): Promise<string[]> {
  const filter = encodeURIComponent(`TransactionID eq '${odataQuote(transactionId)}'`);
  const response = await ibpSend(
    config,
    `${config.baseUrl}/DRPTLANEMessage?$format=json&$filter=${filter}`,
    { method: "GET", csrf: session.csrf, cookie: session.cookie },
  );
  if (!response.ok) return [];
  return odataRows(response.body)
    .map((row) => asString(row.MessageText))
    .filter((text) => text !== "")
    .slice(0, 5);
}

type HttpOk = {
  ok: true;
  body: unknown;
  csrf?: string;
  cookie: string;
};

async function ibpGet(config: Config, url: string): Promise<HttpOk | IbpFailure> {
  return ibpSend(config, url, { method: "GET" });
}

async function ibpSend(
  config: Config,
  url: string,
  init: { method: "GET" | "POST"; body?: string; csrf?: string; cookie?: string },
): Promise<HttpOk | IbpFailure> {
  const headers = new Headers();
  headers.set(
    "Authorization",
    `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`,
  );
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.csrf !== undefined) headers.set("X-CSRF-Token", init.csrf);
  if (init.cookie !== undefined && init.cookie !== "") headers.set("Cookie", init.cookie);
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, error: "ibp_unreachable" };
  }
  const text = await response.text();
  const body = text === "" ? null : parseJson(text);
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "ibp_auth_failed" };
  }
  if (!response.ok) {
    return { ok: false, error: "ibp_http_error", detail: errorDetail(body, response.status) };
  }
  const csrf = response.headers.get("x-csrf-token") ?? undefined;
  const cookie = cookieHeader(response, init.cookie);
  return { ok: true, body, csrf, cookie };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorDetail(body: unknown, status: number): string {
  if (body !== null && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: { value?: unknown } | unknown } }).error
      ?.message;
    if (typeof message === "string") return message.slice(0, 300);
    if (message !== null && typeof message === "object" && "value" in message) {
      const value = (message as { value?: unknown }).value;
      if (typeof value === "string") return value.slice(0, 300);
    }
  }
  return `http_${status}`;
}

function cookieHeader(response: Response, previous: string | undefined): string {
  const fresh = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0]?.trim() ?? "")
    .filter((entry) => entry !== "");
  const parts = [previous ?? "", ...fresh].filter((entry) => entry !== "");
  return parts.join("; ");
}
