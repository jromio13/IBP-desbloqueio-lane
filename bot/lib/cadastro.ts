// Block and unblock requests are stored in DRPZTLANEOBP, version INPUTDADOS.
// The baseline copy is produced later by the daily pre-initialization job.

import {
  asString,
  ibpConfig,
  ibpSend,
  odataQuote,
  odataRows,
  openWriteSession,
  readMessages,
  waitUntilProcessed,
  type Config,
  type IbpFailure,
  type WriteSession,
} from "./ibp.js";

export const INPUT_VERSION = "INPUTDADOS";
export const CADASTRO_ENTITY = "DRPZTLANEOBP";
const STANDARD_FROM = "1970-01-01";
const STANDARD_TO = "9999-12-31";
const LANE_IDS = new Set(["DPLY", "EQ", "CD_ARMEX"]);
const KEY_FIELDS = [
  "ZOBPCLASSIFDRP",
  "ZIDADDLANE",
  "ZMARCA",
  "MOTID",
  "PRDID",
  "LOCTO",
  "LOCFR",
  "ZSUBMARCA",
] as const;
const KEY_FIELD_SET = new Set<string>(KEY_FIELDS);

export type RouteAction = "bloquear" | "desbloquear";

export type RouteInput = {
  locfr: string;
  locto: string;
  motid?: string;
  prdid?: string;
  marca?: string;
  submarca?: string;
  classif?: string;
  addlane?: string;
  leadTime?: number;
  saida?: number;
  transito?: number;
  recebimento?: number;
  marcarExclusao?: boolean;
};

export type Solicitacao = {
  acao: RouteAction;
  justificativa: string;
  rotas: RouteInput[];
};

export type Preview = {
  origem: string;
  destino: string;
  modal: string;
  material: string;
  marca: string;
  submarca: string;
  classificacao: string;
  idLane: string;
  leadTime: string;
  tipoTransferencia: string;
  armex: string;
  vigenciaDe: string;
  vigenciaAte: string;
  bloqueio: string;
  exclusao: string;
  observacao: string;
};

export type RoutePreview = {
  ready: boolean;
  operacao: "criar" | "alterar" | "pendente";
  missing: string[];
  candidatos: Preview[];
  previa: Preview;
};

export type Preparacao = {
  ok: true;
  ready: boolean;
  entidade: typeof CADASTRO_ENTITY;
  versao: typeof INPUT_VERSION;
  baseline: string;
  avisos: string[];
  rotas: RoutePreview[];
};

type RawRow = Record<string, unknown>;

type Prop = {
  name: string;
  type: string;
  nullable: boolean;
};

type Model = {
  entitySet: string;
  transSet: string;
  messageSet: string;
  nav: string;
  props: Map<string, Prop>;
  writeProps: Map<string, Prop>;
  keys: string[];
  versioned: boolean;
  sendVersion: boolean;
  sendPlanning: boolean;
  locfr: string;
  locto: string;
  motid: string | null;
  prdid: string | null;
  marca: string | null;
  submarca: string | null;
  classif: string | null;
  addlane: string | null;
  lead: string | null;
  stock: string | null;
  armex: string | null;
  validFrom: string | null;
  validTo: string | null;
  blocked: string;
  deletion: string | null;
  rounding: string | null;
  observacao: string;
};

type Draft = {
  locfr: string;
  locto: string;
  motid: string;
  prdid: string;
  marca: string;
  submarca: string;
  classif: string;
  addlane: string;
  leadTime: number | null;
  blocked: boolean;
  markedForDeletion: boolean;
  armex: boolean;
  validFrom: string;
  validTo: string;
  justificativa: string;
};

const OMIT = new Set([
  "__metadata",
  "PlanningAreaID",
  "VersionID",
  "CREATEDDATE",
  "LASTMODIFIEDDATE",
  "CREATEDBY",
  "LASTMODIFIEDBY",
  "LASTCHANGEDBY",
]);

const BASELINE_NOTE =
  "A baseline recebe esse cadastro quando rodar o job da Cadeia de Pré-Inicialização Diária.";

export function canonicalCode(value: string): string {
  const trimmed = value.trim();
  return /^[A-Za-z0-9._/-]+$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export function resolveLeadTime(input: RouteInput): { leadTime: number | null; error?: string } {
  const parts = [input.saida, input.transito, input.recebimento];
  const present = parts.filter((part) => part !== undefined);
  if (present.length > 0 && present.length < 3) {
    return { leadTime: null, error: "Informe saída, trânsito e recebimento juntos." };
  }
  if (present.length === 3) {
    const total = Number(input.saida) + Number(input.transito) + Number(input.recebimento);
    if (!Number.isInteger(total) || total < 0 || total > 999) {
      return { leadTime: null, error: "Lead time inválido." };
    }
    return { leadTime: total };
  }
  if (input.leadTime === undefined) return { leadTime: null };
  if (!Number.isInteger(input.leadTime) || input.leadTime < 0 || input.leadTime > 999) {
    return { leadTime: null, error: "Lead time inválido." };
  }
  return { leadTime: input.leadTime };
}

export function odataDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `/Date(${Date.UTC(year, month - 1, day)})/`;
}

export function displayDate(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const match = /\/Date\((-?\d+)/.exec(value);
  const date = match === null ? new Date(value) : new Date(Number(match[1]));
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export async function consultarCadastro(
  filters: Partial<RouteInput>,
): Promise<
  | { ok: true; entidade: string; versao: string; count: number; truncated: boolean; rotas: Preview[] }
  | IbpFailure
> {
  const config = ibpConfig();
  if ("error" in config) return config;
  const model = await loadModel(config);
  if ("error" in model) return model;
  const query = routeFilters(model, filters);
  if (!query.ok) return query;
  if (Object.keys(query.filters).length === 0) return { ok: false, error: "missing_key" };
  const fetched = await fetchRows(config, model, query.filters, 41);
  if (!fetched.ok) return fetched;
  const truncated = fetched.rows.length > 40;
  return {
    ok: true,
    entidade: CADASTRO_ENTITY,
    versao: INPUT_VERSION,
    count: Math.min(fetched.rows.length, 40),
    truncated,
    rotas: fetched.rows.slice(0, 40).map((row) => previewFromRow(model, row)),
  };
}

export async function prepararSolicitacao(input: Solicitacao): Promise<Preparacao | IbpFailure> {
  const config = ibpConfig();
  if ("error" in config) return config;
  const invalid = invalidRequest(input);
  if (invalid !== null) return invalid;
  const model = await loadModel(config);
  if ("error" in model) return model;
  const rotas: RoutePreview[] = [];
  const avisos = [BASELINE_NOTE];
  for (const route of input.rotas) {
    const prepared = await prepareRoute(config, model, input, route);
    if ("error" in prepared) return prepared;
    rotas.push(prepared.preview);
    avisos.push(...prepared.avisos);
  }
  return {
    ok: true,
    ready: rotas.every((route) => route.ready),
    entidade: CADASTRO_ENTITY,
    versao: INPUT_VERSION,
    baseline: BASELINE_NOTE,
    avisos: [...new Set(avisos)],
    rotas,
  };
}

export async function gravarSolicitacao(
  input: Solicitacao,
): Promise<
  | (Preparacao & { ibpChanged: boolean; changed: number; messages: string[] })
  | IbpFailure
> {
  const prepared = await prepararSolicitacao(input);
  if (!prepared.ok) return prepared;
  if (!prepared.ready) return { ...prepared, ibpChanged: false, changed: 0, messages: [] };

  const config = ibpConfig();
  if ("error" in config) return config;
  const model = await loadModel(config);
  if ("error" in model) return model;

  const jobs: Array<{ session: WriteSession; transactionId: string }> = [];
  let changed = 0;
  for (const route of input.rotas) {
    const built = await buildWrite(config, model, input, route);
    if ("error" in built) return built;
    if (built.skip) continue;
    const missingKey = blankKey(built.item);
    if (missingKey !== null) return { ok: false, error: "missing_key", detail: missingKey };
    const attributes = requestedAttributes(built.item);
    const posted = await postCadastro(config, model, built.item, attributes);
    if (!posted.ok) {
      return {
        ...posted,
        detail: `Enviados: ${attributes}. ${posted.detail ?? ""}`.slice(0, 300),
      };
    }
    jobs.push({ session: posted.session, transactionId: posted.transactionId });
    changed += 1;
  }

  const messages: string[] = [];
  const waited = await Promise.all(
    jobs.map(async (job) => {
      const done = await waitUntilProcessed(config, job.session, job.transactionId);
      if (!done.ok) return done;
      const texts = await readMessages(config, job.session, job.transactionId, model.messageSet);
      return { ok: true as const, texts };
    }),
  );
  for (const result of waited) {
    if (!result.ok) return result;
    messages.push(...result.texts);
  }

  for (const route of input.rotas) {
    const located = await locateRows(config, model, route);
    if (!located.ok) return located;
    if (located.rows.length !== 1) {
      return { ok: false, error: "not_applied", detail: messages.join(" ").slice(0, 300) };
    }
    const stored = readDraft(model, located.rows[0] ?? {});
    if (stored.blocked !== (input.acao === "bloquear") || stored.justificativa !== input.justificativa.trim()) {
      return { ok: false, error: "not_applied", detail: messages.join(" ").slice(0, 300) };
    }
    if (route.marcarExclusao === true && !stored.markedForDeletion) {
      return { ok: false, error: "not_applied" };
    }
    if (route.marcarExclusao === false && stored.markedForDeletion) {
      return { ok: false, error: "not_applied" };
    }
  }
  const confirmed = await prepararSolicitacao(input);
  if (!confirmed.ok) return confirmed;
  return {
    ...confirmed,
    ibpChanged: changed > 0,
    changed,
    messages: messages.filter((text) => text !== "").slice(0, 5),
  };
}

function invalidRequest(input: Solicitacao): IbpFailure | null {
  if (input.justificativa.trim().length < 5 || input.justificativa.trim().length > 500) {
    return { ok: false, error: "invalid_justificativa" };
  }
  if (/[\u0000-\u001f]/.test(input.justificativa)) {
    return { ok: false, error: "invalid_justificativa" };
  }
  for (const route of input.rotas) {
    if (invalidCode(route.locfr) || invalidCode(route.locto)) {
      return { ok: false, error: "invalid_id" };
    }
    for (const value of [route.motid, route.prdid, route.addlane]) {
      if (value !== undefined && invalidCode(value)) return { ok: false, error: "invalid_id" };
    }
    for (const value of [route.marca, route.submarca, route.classif]) {
      if (value !== undefined && invalidLabel(value)) return { ok: false, error: "invalid_id" };
    }
    const lead = resolveLeadTime(route);
    if (lead.error !== undefined) return { ok: false, error: "invalid_lead_time", detail: lead.error };
  }
  return null;
}

function invalidCode(value: string): boolean {
  return !/^[\p{L}\p{N}._/-]+$/u.test(value.trim()) || value.trim().length > 40;
}

function invalidLabel(value: string): boolean {
  return !/^[\p{L}\p{N} ._/&+-]+$/u.test(value.trim()) || value.trim().length > 60;
}

async function prepareRoute(
  config: Config,
  model: Model,
  input: Solicitacao,
  route: RouteInput,
): Promise<{ preview: RoutePreview; avisos: string[] } | IbpFailure> {
  const built = await buildWrite(config, model, input, route);
  if ("error" in built) return built;
  return { preview: built.preview, avisos: built.avisos };
}

async function buildWrite(
  config: Config,
  model: Model,
  input: Solicitacao,
  route: RouteInput,
): Promise<
  | {
      preview: RoutePreview;
      avisos: string[];
      item: RawRow;
      skip: boolean;
    }
  | IbpFailure
> {
  const locfr = canonicalCode(route.locfr);
  const locto = canonicalCode(route.locto);
  if (route.addlane !== undefined && !LANE_IDS.has(canonicalCode(route.addlane))) {
    return { ok: false, error: "invalid_id", detail: "ID da lane deve ser DPLY, EQ ou CD_ARMEX." };
  }
  const provided = providedDimensions(route);
  const lead = resolveLeadTime(route);
  const avisos = routeAvisos(provided);
  const broad =
    provided.motid === undefined &&
    provided.prdid === undefined &&
    provided.marca === undefined &&
    provided.submarca === undefined &&
    provided.classif === undefined &&
    provided.addlane === undefined;

  if (broad) {
    const found = await fetchRows(config, model, { [model.locfr]: locfr, [model.locto]: locto }, 41);
    if (!found.ok) return found;
    if (found.rows.length > 1) {
      return {
        skip: true,
        avisos,
        item: {},
        preview: pendingPreview(locfr, locto, input, found.rows.slice(0, 40).map((row) => previewFromRow(model, row)), [
          "qual cadastro existente",
        ]),
      };
    }
    if (found.rows.length === 1) {
      return fromExisting(model, input, route, found.rows[0], lead.leadTime, avisos);
    }
    return {
      skip: true,
      avisos,
      item: {},
      preview: pendingPreview(locfr, locto, input, [], [
        "ID da lane (DPLY, EQ ou CD_ARMEX)",
        "lead time em dias (saída + trânsito + recebimento)",
      ]),
    };
  }

  const filters: Record<string, string> = { [model.locfr]: locfr, [model.locto]: locto };
  assignFilter(filters, model.motid, provided.motid ?? "ALL");
  assignFilter(filters, model.prdid, provided.prdid ?? "ALL");
  assignFilter(filters, model.marca, provided.marca ?? "ALL");
  assignFilter(filters, model.submarca, provided.submarca ?? "ALL");
  assignFilter(filters, model.classif, provided.classif ?? "ALL");
  if (provided.addlane !== undefined) assignFilter(filters, model.addlane, provided.addlane);

  const found = await fetchRows(config, model, filters, 41);
  if (!found.ok) return found;
  if (found.rows.length > 1) {
    return {
      skip: true,
      avisos,
      item: {},
      preview: pendingPreview(locfr, locto, input, found.rows.slice(0, 40).map((row) => previewFromRow(model, row)), [
        "qual cadastro existente",
      ]),
    };
  }
  if (found.rows.length === 1) {
    return fromExisting(model, input, route, found.rows[0], lead.leadTime, avisos);
  }

  const missing: string[] = [];
  if (provided.addlane === undefined) missing.push("ID da lane (DPLY, EQ ou CD_ARMEX)");
  if (lead.leadTime === null) missing.push("lead time em dias (saída + trânsito + recebimento)");
  if (model.addlane === null) missing.push("atributo do ID da lane");
  if (model.lead === null && lead.leadTime !== null) missing.push("atributo de lead time");
  const draft = createDraft(locfr, locto, provided, lead.leadTime, input, route.marcarExclusao === true);
  if (missing.length > 0 || draft.addlane === "") {
    return {
      skip: true,
      avisos,
      item: {},
      preview: {
        ready: false,
        operacao: "pendente",
        missing,
        candidatos: [],
        previa: previewFromDraft(draft, input.justificativa.trim()),
      },
    };
  }
  for (const key of KEY_FIELDS) {
    if (draftValue(model, draft, key) === "") missing.push(key);
  }
  if (missing.length > 0) {
    return {
      skip: true,
      avisos,
      item: {},
      preview: {
        ready: false,
        operacao: "pendente",
        missing,
        candidatos: [],
        previa: previewFromDraft(draft, input.justificativa.trim()),
      },
    };
  }
  return {
    skip: false,
    avisos,
    item: itemFromDraft(model, null, draft),
    preview: {
      ready: true,
      operacao: "criar",
      missing: [],
      candidatos: [],
      previa: previewFromDraft(draft, input.justificativa.trim()),
    },
  };
}

function fromExisting(
  model: Model,
  input: Solicitacao,
  route: RouteInput,
  row: RawRow,
  leadTime: number | null,
  avisos: string[],
): { preview: RoutePreview; avisos: string[]; item: RawRow; skip: boolean } {
  const current = readDraft(model, row);
  const draft: Draft = {
    ...current,
    blocked: input.acao === "bloquear",
    justificativa: input.justificativa.trim(),
  };
  if (route.motid !== undefined) draft.motid = canonicalCode(route.motid);
  if (route.prdid !== undefined) draft.prdid = canonicalCode(route.prdid);
  if (route.marca !== undefined) draft.marca = canonicalCode(route.marca);
  if (route.submarca !== undefined) draft.submarca = canonicalCode(route.submarca);
  if (route.classif !== undefined) draft.classif = canonicalCode(route.classif);
  if (route.addlane !== undefined) draft.addlane = canonicalCode(route.addlane);
  if (leadTime !== null) draft.leadTime = leadTime;
  if (route.marcarExclusao !== undefined) draft.markedForDeletion = route.marcarExclusao;
  fillKeyDefaults(draft);
  draft.armex = draft.addlane === "CD_ARMEX";
  if (draft.validFrom === "") draft.validFrom = STANDARD_FROM;
  if (draft.validTo === "") draft.validTo = STANDARD_TO;
  if (draft.addlane === "" || !LANE_IDS.has(draft.addlane)) {
    return {
      skip: true,
      avisos,
      item: {},
      preview: {
        ready: false,
        operacao: "pendente",
        missing: ["ID da lane (DPLY, EQ ou CD_ARMEX)"],
        candidatos: [],
        previa: previewFromDraft(draft, draft.justificativa),
      },
    };
  }
  const item = itemFromDraft(model, row, draft);
  const skip = samePayload(model, row, item);
  return {
    skip,
    avisos,
    item,
    preview: {
      ready: true,
      operacao: "alterar",
      missing: [],
      candidatos: [],
      previa: previewFromDraft(draft, draft.justificativa),
    },
  };
}

function createDraft(
  locfr: string,
  locto: string,
  provided: ReturnType<typeof providedDimensions>,
  leadTime: number | null,
  input: Solicitacao,
  markedForDeletion: boolean,
): Draft {
  const addlane = provided.addlane ?? "";
  return {
    locfr,
    locto,
    motid: provided.motid ?? "ALL",
    prdid: provided.prdid ?? "ALL",
    marca: provided.marca ?? "ALL",
    submarca: provided.submarca ?? "ALL",
    classif: provided.classif ?? "ALL",
    addlane,
    leadTime,
    blocked: input.acao === "bloquear",
    markedForDeletion,
    armex: addlane === "CD_ARMEX",
    validFrom: STANDARD_FROM,
    validTo: STANDARD_TO,
    justificativa: input.justificativa.trim(),
  };
}

async function locateRows(
  config: Config,
  model: Model,
  route: RouteInput,
): Promise<{ ok: true; rows: RawRow[] } | IbpFailure> {
  const locfr = canonicalCode(route.locfr);
  const locto = canonicalCode(route.locto);
  const provided = providedDimensions(route);
  const broad =
    provided.motid === undefined &&
    provided.prdid === undefined &&
    provided.marca === undefined &&
    provided.submarca === undefined &&
    provided.classif === undefined &&
    provided.addlane === undefined;
  if (broad) return fetchRows(config, model, { [model.locfr]: locfr, [model.locto]: locto }, 41);
  const filters: Record<string, string> = { [model.locfr]: locfr, [model.locto]: locto };
  assignFilter(filters, model.motid, provided.motid ?? "ALL");
  assignFilter(filters, model.prdid, provided.prdid ?? "ALL");
  assignFilter(filters, model.marca, provided.marca ?? "ALL");
  assignFilter(filters, model.submarca, provided.submarca ?? "ALL");
  assignFilter(filters, model.classif, provided.classif ?? "ALL");
  if (provided.addlane !== undefined) assignFilter(filters, model.addlane, provided.addlane);
  return fetchRows(config, model, filters, 41);
}

function providedDimensions(route: RouteInput): {
  motid?: string;
  prdid?: string;
  marca?: string;
  submarca?: string;
  classif?: string;
  addlane?: string;
} {
  return {
    motid: route.motid === undefined ? undefined : canonicalCode(route.motid),
    prdid: route.prdid === undefined ? undefined : canonicalCode(route.prdid),
    marca: route.marca === undefined ? undefined : canonicalCode(route.marca),
    submarca: route.submarca === undefined ? undefined : canonicalCode(route.submarca),
    classif: route.classif === undefined ? undefined : canonicalCode(route.classif),
    addlane: route.addlane === undefined ? undefined : canonicalCode(route.addlane),
  };
}

function routeAvisos(provided: ReturnType<typeof providedDimensions>): string[] {
  const avisos: string[] = [];
  if (provided.prdid !== undefined && provided.prdid !== "ALL") {
    avisos.push("SKU específico cria um parâmetro fixo e exige manutenção.");
  }
  if (provided.motid !== undefined && provided.motid !== "ALL") {
    avisos.push("O IBP valida essa unidade no DRPPRODUCTUNIT do material.");
  }
  return avisos;
}

function pendingPreview(
  locfr: string,
  locto: string,
  input: Solicitacao,
  candidatos: Preview[],
  missing: string[],
): RoutePreview {
  return {
    ready: false,
    operacao: "pendente",
    missing,
    candidatos,
    previa: {
      origem: locfr,
      destino: locto,
      modal: "",
      material: "",
      marca: "",
      submarca: "",
      classificacao: "",
      idLane: "",
      leadTime: "",
      tipoTransferencia: "7",
      armex: "Não",
      vigenciaDe: "01/01/1970",
      vigenciaAte: "31/12/9999",
      bloqueio: input.acao === "bloquear" ? "Sim" : "Não",
      exclusao: "Não",
      observacao: input.justificativa.trim(),
    },
  };
}

function previewFromDraft(draft: Draft, observacao: string): Preview {
  return {
    origem: draft.locfr,
    destino: draft.locto,
    modal: draft.motid,
    material: draft.prdid,
    marca: draft.marca,
    submarca: draft.submarca,
    classificacao: draft.classif,
    idLane: draft.addlane,
    leadTime: draft.leadTime === null ? "" : String(draft.leadTime),
    tipoTransferencia: "7",
    armex: draft.armex ? "Sim" : "Não",
    vigenciaDe: displayDate(odataDate(draft.validFrom)),
    vigenciaAte: displayDate(odataDate(draft.validTo)),
    bloqueio: draft.blocked ? "Sim" : "Não",
    exclusao: draft.markedForDeletion ? "Sim" : "Não",
    observacao,
  };
}

function previewFromRow(model: Model, row: RawRow): Preview {
  return previewFromDraft(readDraft(model, row), readText(row, model.observacao));
}

function readDraft(model: Model, row: RawRow): Draft {
  const addlane = readText(row, model.addlane);
  const from = displayDate(row[model.validFrom ?? ""] ?? "");
  const to = displayDate(row[model.validTo ?? ""] ?? "");
  return {
    locfr: readText(row, model.locfr),
    locto: readText(row, model.locto),
    motid: readText(row, model.motid),
    prdid: readText(row, model.prdid),
    marca: readText(row, model.marca),
    submarca: readText(row, model.submarca),
    classif: readText(row, model.classif),
    addlane,
    leadTime: readNumber(row, model.lead),
    blocked: readText(row, model.blocked).toUpperCase() === "X",
    markedForDeletion: readText(row, model.deletion).toUpperCase() === "X",
    armex: addlane === "CD_ARMEX" || readText(row, model.armex).toUpperCase() === "X",
    validFrom: from === "" ? "" : isoFromDisplay(from),
    validTo: to === "" ? "" : isoFromDisplay(to),
    justificativa: readText(row, model.observacao),
  };
}

function isoFromDisplay(value: string): string {
  const [day, month, year] = value.split("/");
  if (year === undefined) return "";
  return `${year}-${month}-${day}`;
}

function itemFromDraft(model: Model, existing: RawRow | null, draft: Draft): RawRow {
  const item: RawRow = {};
  if (existing !== null) {
    for (const [key, value] of Object.entries(existing)) {
      if (OMIT.has(key) || value == null || !model.writeProps.has(key)) continue;
      if (model.rounding !== null && key === model.rounding) continue;
      item[key] = value;
    }
  }
  put(item, model, model.locfr, draft.locfr);
  put(item, model, model.locto, draft.locto);
  put(item, model, model.motid, draft.motid);
  put(item, model, model.prdid, draft.prdid);
  put(item, model, model.marca, draft.marca);
  put(item, model, model.submarca, draft.submarca);
  put(item, model, model.classif, draft.classif);
  put(item, model, model.addlane, draft.addlane);
  if (draft.leadTime !== null) put(item, model, model.lead, draft.leadTime);
  put(item, model, model.stock, 7);
  put(item, model, model.armex, draft.armex ? "X" : "");
  put(item, model, model.validFrom, draft.validFrom === "" ? "" : odataDate(draft.validFrom));
  put(item, model, model.validTo, draft.validTo === "" ? "" : odataDate(draft.validTo));
  put(item, model, model.blocked, draft.blocked ? "X" : "");
  put(item, model, model.deletion, draft.markedForDeletion ? "X" : "");
  put(item, model, model.observacao, draft.justificativa);
  if (model.rounding !== null) delete item[model.rounding];
  return applyRequiredKeys(item, draft);
}

export function applyRequiredKeys(item: RawRow, draft: Draft): RawRow {
  item.ZOBPCLASSIFDRP = textOr(draft.classif, "ALL");
  item.ZIDADDLANE = draft.addlane.trim();
  item.ZMARCA = textOr(draft.marca, "ALL");
  item.MOTID = textOr(draft.motid, "ALL");
  item.PRDID = textOr(draft.prdid, "ALL");
  item.LOCTO = draft.locto.trim();
  item.LOCFR = draft.locfr.trim();
  item.ZSUBMARCA = textOr(draft.submarca, "ALL");
  return item;
}

function textOr(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

function blankKey(item: RawRow): string | null {
  const missing = KEY_FIELDS.filter((name) => asString(item[name]).trim() === "");
  return missing.length === 0 ? null : missing.join(", ");
}

function fillKeyDefaults(draft: Draft): void {
  if (draft.motid === "") draft.motid = "ALL";
  if (draft.prdid === "") draft.prdid = "ALL";
  if (draft.marca === "") draft.marca = "ALL";
  if (draft.submarca === "") draft.submarca = "ALL";
  if (draft.classif === "") draft.classif = "ALL";
}

export function requestedAttributes(item: RawRow): string {
  const rest = Object.keys(item).filter((name) => !KEY_FIELD_SET.has(name));
  return [...KEY_FIELDS, ...rest].join(",");
}

async function postCadastro(
  config: Config,
  model: Model,
  item: RawRow,
  attributes: string,
): Promise<{ ok: true; session: WriteSession; transactionId: string } | IbpFailure> {
  const shapes: Array<Record<string, unknown>> = [
    { [model.nav]: [item] },
    { [model.nav]: { results: [item] } },
  ];
  let last: IbpFailure | null = null;
  for (const shape of shapes) {
    const session = await openWriteSession(config);
    if (!session.ok) return session;
    const posted = await ibpSend(config, `${config.baseUrl}/${model.transSet}`, {
      method: "POST",
      csrf: session.csrf,
      cookie: session.cookie,
      body: JSON.stringify({
        TransactionID: session.transactionId,
        ...(model.sendPlanning ? { PlanningAreaID: config.planningArea } : {}),
        ...(model.sendVersion ? { VersionID: INPUT_VERSION } : {}),
        DoCommit: true,
        DeleteEntries: false,
        RequestedAttributes: attributes,
        ...shape,
      }),
    });
    if (posted.ok) return { ok: true, session, transactionId: session.transactionId };
    last = posted;
    if (!/key and required/i.test(posted.detail ?? "")) return posted;
  }
  return last ?? { ok: false, error: "ibp_http_error" };
}

function put(item: RawRow, model: Model, name: string | null, value: string | number): void {
  if (name === null || !model.writeProps.has(name)) return;
  const prop = model.writeProps.get(name);
  if (prop !== undefined && typeof value === "number" && !isNumeric(prop.type)) {
    item[name] = String(value);
    return;
  }
  if (prop !== undefined && typeof value === "string" && isNumeric(prop.type) && value !== "" && Number.isFinite(Number(value))) {
    item[name] = Number(value);
    return;
  }
  item[name] = value;
}

function samePayload(model: Model, row: RawRow, item: RawRow): boolean {
  for (const [key, value] of Object.entries(item)) {
    const current = row[key];
    if (current == null && value === "") continue;
    if (typeof value === "number" && Number(current) === value) continue;
    if (asString(current) === asString(value)) continue;
    if (model.validFrom === key || model.validTo === key) {
      if (displayDate(current) !== "" && displayDate(current) === displayDate(value)) continue;
    }
    return false;
  }
  return true;
}

function draftValue(model: Model, draft: Draft, key: string): string {
  if (key === model.locfr) return draft.locfr;
  if (key === model.locto) return draft.locto;
  if (key === model.motid) return draft.motid;
  if (key === model.prdid) return draft.prdid;
  if (key === model.marca) return draft.marca;
  if (key === model.submarca) return draft.submarca;
  if (key === model.classif) return draft.classif;
  if (key === model.addlane) return draft.addlane;
  return "";
}

function assignFilter(filters: Record<string, string>, attribute: string | null, value: string): void {
  if (attribute === null || value === "") return;
  filters[attribute] = value;
}

function routeFilters(
  model: Model,
  filters: Partial<RouteInput>,
): { ok: true; filters: Record<string, string> } | IbpFailure {
  const query: Record<string, string> = {};
  const pairs: Array<[string | null, string | undefined, boolean]> = [
    [model.locfr, filters.locfr, true],
    [model.locto, filters.locto, true],
    [model.motid, filters.motid, true],
    [model.prdid, filters.prdid, true],
    [model.marca, filters.marca, false],
    [model.submarca, filters.submarca, false],
    [model.classif, filters.classif, false],
    [model.addlane, filters.addlane, true],
  ];
  for (const [attribute, value, code] of pairs) {
    if (value === undefined || value.trim() === "") continue;
    if (code ? invalidCode(value) : invalidLabel(value)) return { ok: false, error: "invalid_id" };
    if (attribute === null) return { ok: false, error: "campo_ausente" };
    query[attribute] = canonicalCode(value);
  }
  return { ok: true, filters: query };
}

async function fetchRows(
  config: Config,
  model: Model,
  filters: Record<string, string>,
  top: number,
): Promise<{ ok: true; rows: RawRow[] } | IbpFailure> {
  const clauses = Object.entries(filters).map(([field, value]) => `${field} eq '${odataQuote(value)}'`);
  if (model.versioned) {
    clauses.unshift(
      `PlanningAreaID eq '${odataQuote(config.planningArea)}'`,
      `VersionID eq '${odataQuote(INPUT_VERSION)}'`,
    );
  }
  const url = `${config.baseUrl}/${model.entitySet}?$format=json&$top=${top}&$filter=${encodeURIComponent(clauses.join(" and "))}`;
  const response = await ibpSend(config, url, { method: "GET" });
  if (!response.ok) return response;
  return { ok: true, rows: odataRows(response.body) };
}

function readText(row: RawRow, name: string | null): string {
  if (name === null) return "";
  return asString(row[name]).trim();
}

function readNumber(row: RawRow, name: string | null): number | null {
  if (name === null) return null;
  const value = row[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

let modelPromise: Promise<Model | IbpFailure> | null = null;

async function loadModel(config: Config): Promise<Model | IbpFailure> {
  if (modelPromise === null) {
    modelPromise = readModel(config).then((result) => {
      if ("error" in result) modelPromise = null;
      return result;
    });
  }
  return modelPromise;
}

async function readModel(config: Config): Promise<Model | IbpFailure> {
  const response = await ibpSend(config, `${config.baseUrl}/$metadata`, {
    method: "GET",
    accept: "application/xml",
  });
  if (!response.ok) return response;
  const xml = response.text;
  const main = entityXml(xml, CADASTRO_ENTITY);
  const write = entityXml(xml, `${CADASTRO_ENTITY}_VI`) ?? main;
  const trans = entityXml(xml, `${CADASTRO_ENTITY}Trans`);
  if (main === null || write === null || trans === null) {
    return { ok: false, error: "metadata_incompleta", detail: CADASTRO_ENTITY };
  }
  const props = new Map(readProps(main).map((prop) => [prop.name, prop]));
  const writeProps = new Map(readProps(write).map((prop) => [prop.name, prop]));
  const transProps = new Map(readProps(trans).map((prop) => [prop.name, prop]));
  const keys = [
    ...new Set([
      ...KEY_FIELDS,
      ...readKeys(main),
      ...readKeys(write),
    ]),
  ].filter((key) => key !== "PlanningAreaID" && key !== "VersionID");
  for (const name of KEY_FIELDS) {
    if (!writeProps.has(name)) writeProps.set(name, { name, type: "Edm.String", nullable: false });
  }
  const nav = navigationName(trans);
  const observacao = observationAttribute([...writeProps.values()]);
  if (nav === "" || observacao === null) {
    const candidates = [...writeProps.values()]
      .filter((prop) => prop.type === "Edm.String" && prop.name.startsWith("Z"))
      .map((prop) => prop.name)
      .slice(0, 25)
      .join(", ");
    return {
      ok: false,
      error: "campo_observacao_ausente",
      detail: candidates === "" ? nav : candidates,
    };
  }
  const locfr = pick(writeProps, ["LOCFR"]);
  const locto = pick(writeProps, ["LOCTO"]);
  const blocked = pick(writeProps, ["TLANEBLOCKEDFORPLANNING"]);
  if (locfr === null || locto === null || blocked === null) {
    return { ok: false, error: "metadata_incompleta", detail: "LOCFR, LOCTO ou bloqueio" };
  }
  return {
    entitySet: entitySetName(xml, CADASTRO_ENTITY) ?? CADASTRO_ENTITY,
    transSet: entitySetName(xml, `${CADASTRO_ENTITY}Trans`) ?? `${CADASTRO_ENTITY}Trans`,
    messageSet: entitySetName(xml, `${CADASTRO_ENTITY}Message`) ?? `${CADASTRO_ENTITY}Message`,
    nav,
    props,
    writeProps,
    keys,
    versioned: props.has("PlanningAreaID") && props.has("VersionID"),
    sendVersion: transProps.has("VersionID"),
    sendPlanning: transProps.has("PlanningAreaID"),
    locfr: "LOCFR",
    locto: "LOCTO",
    motid: "MOTID",
    prdid: "PRDID",
    marca: "ZMARCA",
    submarca: "ZSUBMARCA",
    classif: "ZOBPCLASSIFDRP",
    addlane: "ZIDADDLANE",
    lead: pick(writeProps, ["ZOBPLEADTIMELANE", "LEADTIME"]),
    stock: pick(writeProps, ["STOCKTRANSFERTYPE"]),
    armex: pick(writeProps, ["ZARMEX"]),
    validFrom: pickValid([...writeProps.keys()], "from"),
    validTo: pickValid([...writeProps.keys()], "to"),
    blocked,
    deletion: pick(writeProps, ["TLANEDEL"]),
    rounding: pick(writeProps, ["TROUNDING"]),
    observacao,
  };
}

function observationAttribute(props: Prop[]): string | null {
  const override = process.env.IBP_OBSERVATION_ATTRIBUTE?.trim() ?? "";
  const names = new Set(props.map((prop) => prop.name));
  if (override !== "") return names.has(override) ? override : null;
  const preferred = [
    "ZOBSERVACAO",
    "ZOBSERVACAO1",
    "ZOBS",
    "OBSERVACAO",
    "ZJUSTIFICATIVA",
    "ZCOMENTARIO",
    "ZCOMENT",
    "ZNOTE",
    "ZTEXTO",
  ];
  for (const name of preferred) if (names.has(name)) return name;
  return props.find((prop) => prop.type === "Edm.String" && /OBS|JUSTIF|COMENT|REMARK/i.test(prop.name))?.name ?? null;
}

function pick(props: Map<string, Prop>, names: string[]): string | null {
  return names.find((name) => props.has(name)) ?? null;
}

function pickValid(names: string[], which: "from" | "to"): string | null {
  const pattern = which === "from" ? /VALID.*(FR|FROM)$/i : /VALID.*TO$/i;
  return names.find((name) => pattern.test(name)) ?? null;
}

function entityXml(xml: string, name: string): string | null {
  const start = xml.indexOf(`<EntityType Name="${name}"`);
  if (start < 0) return null;
  const end = xml.indexOf("</EntityType>", start);
  if (end < 0) return null;
  return xml.slice(start, end);
}

function entitySetName(xml: string, typeName: string): string | null {
  const match = new RegExp(`<EntitySet Name="([^"]+)" EntityType="[^"]*\\.${typeName}"`).exec(xml);
  return match?.[1] ?? null;
}

function readProps(xml: string): Prop[] {
  const props: Prop[] = [];
  for (const match of xml.matchAll(/<Property\b([^>]*?)\/>/g)) {
    const tag = match[1] ?? "";
    const name = /Name="([^"]+)"/.exec(tag)?.[1];
    const type = /Type="([^"]+)"/.exec(tag)?.[1];
    if (name === undefined || type === undefined) continue;
    props.push({ name, type, nullable: !tag.includes('Nullable="false"') });
  }
  return props;
}

function navigationName(xml: string): string {
  const names = [...xml.matchAll(/<NavigationProperty\b([^>]*?)\/>/g)]
    .map((match) => /Name="([^"]+)"/.exec(match[1] ?? "")?.[1] ?? "")
    .filter((name) => name !== "");
  return (
    names.find((name) => name.includes(CADASTRO_ENTITY) && !name.includes("Message")) ??
    names.find((name) => !name.includes("Message")) ??
    names[0] ??
    ""
  );
}

function readKeys(xml: string): string[] {
  const block = xml.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? "";
  return [...block.matchAll(/<PropertyRef Name="([^"]+)"/g)].map((match) => match[1] ?? "");
}

function isNumeric(type: string): boolean {
  return /Int|Decimal|Double|Single|Byte/.test(type);
}
