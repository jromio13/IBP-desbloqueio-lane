import { randomBytes } from "node:crypto";
import type { HostKvApi, JsonObject, JsonValue } from "@grok/agent-sdk";
import type { LaneKey } from "./ibp.js";

export type UnlockDecision = "aprovar" | "recusar";

export type UnlockRequest = {
  id: string;
  status: "pending" | "applied" | "rejected";
  lane: LaneKey;
  requesterSlackId: string | null;
  createdAt: string;
  decidedAt?: string;
  decision?: UnlockDecision;
};

const PREFIX = "unlock-request/";

export function newRequestId(): string {
  return `req_${randomBytes(6).toString("hex")}`;
}

export async function saveRequest(
  kv: HostKvApi,
  request: UnlockRequest,
): Promise<void> {
  await kv.put(`${PREFIX}${request.id}`, toJson(request));
}

export async function loadRequest(
  kv: HostKvApi,
  id: string,
): Promise<UnlockRequest | null> {
  const value = await kv.get(`${PREFIX}${id}`);
  return parseRequest(value);
}

function toJson(request: UnlockRequest): JsonObject {
  const lane: JsonObject = {
    locfr: request.lane.locfr,
    locto: request.lane.locto,
    prdid: request.lane.prdid,
    motid: request.lane.motid,
    addlaneid: request.lane.addlaneid,
  };
  const body: JsonObject = {
    id: request.id,
    status: request.status,
    lane,
    requesterSlackId: request.requesterSlackId,
    createdAt: request.createdAt,
  };
  if (request.decidedAt !== undefined) body.decidedAt = request.decidedAt;
  if (request.decision !== undefined) body.decision = request.decision;
  return body;
}

function parseRequest(value: JsonValue | undefined): UnlockRequest | null {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, JsonValue>;
  const lane = row.lane;
  if (lane === null || typeof lane !== "object" || Array.isArray(lane)) return null;
  const key = lane as Record<string, JsonValue>;
  const status = row.status;
  if (status !== "pending" && status !== "applied" && status !== "rejected") return null;
  if (
    typeof row.id !== "string" ||
    typeof key.locfr !== "string" ||
    typeof key.locto !== "string" ||
    typeof key.prdid !== "string" ||
    typeof key.motid !== "string" ||
    typeof key.addlaneid !== "string" ||
    typeof row.createdAt !== "string"
  ) {
    return null;
  }
  const request: UnlockRequest = {
    id: row.id,
    status,
    lane: {
      locfr: key.locfr,
      locto: key.locto,
      prdid: key.prdid,
      motid: key.motid,
      addlaneid: key.addlaneid,
    },
    requesterSlackId: typeof row.requesterSlackId === "string" ? row.requesterSlackId : null,
    createdAt: row.createdAt,
  };
  if (typeof row.decidedAt === "string") request.decidedAt = row.decidedAt;
  if (row.decision === "aprovar" || row.decision === "recusar") request.decision = row.decision;
  return request;
}
