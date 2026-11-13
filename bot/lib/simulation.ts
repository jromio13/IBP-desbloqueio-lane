import { randomBytes } from "node:crypto";
import type { HostKvApi, JsonObject, JsonValue } from "@grok/agent-sdk";
import type { LaneKey, LaneRecord } from "./ibp.js";

export type SimAction = "bloquear" | "desbloquear";

export type SimLane = LaneRecord & {
  simulated: boolean;
};

type StoredFlag = {
  blocked: boolean;
  markedForDeletion: boolean;
};

type Proposal = {
  id: string;
  sessionId: string;
  action: SimAction;
  status: "pending" | "applied";
  lanes: LaneKey[];
  createdAt: string;
  exp: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function laneStorageKey(sessionId: string, lane: LaneKey): string {
  return `sim-lane/${sessionId}/${lane.locfr}|${lane.locto}|${lane.prdid}|${lane.motid}|${lane.addlaneid}`;
}

export async function overlayLanes(
  kv: HostKvApi,
  sessionId: string,
  lanes: LaneRecord[],
): Promise<SimLane[]> {
  const overlaid: SimLane[] = [];
  for (const lane of lanes) {
    const stored = parseFlag(await kv.get(laneStorageKey(sessionId, lane)));
    if (stored === null) {
      overlaid.push({ ...lane, simulated: false });
      continue;
    }
    overlaid.push({
      ...lane,
      blocked: stored.blocked,
      markedForDeletion: stored.markedForDeletion,
      simulated: true,
    });
  }
  return overlaid;
}

export function targetFlags(action: SimAction): StoredFlag {
  if (action === "bloquear") return { blocked: true, markedForDeletion: true };
  return { blocked: false, markedForDeletion: false };
}

export async function saveProposal(
  kv: HostKvApi,
  sessionId: string,
  action: SimAction,
  lanes: LaneKey[],
  now: Date,
): Promise<Proposal> {
  const proposal: Proposal = {
    id: `sim_${randomBytes(6).toString("hex")}`,
    sessionId,
    action,
    status: "pending",
    lanes,
    createdAt: now.toISOString(),
    exp: now.getTime() + DAY_MS,
  };
  await kv.put(proposalKey(proposal.id), toJson(proposal));
  return proposal;
}

export async function loadProposal(kv: HostKvApi, id: string, now: Date): Promise<Proposal | null> {
  const proposal = parseProposal(await kv.get(proposalKey(id)));
  if (proposal === null) return null;
  if (proposal.exp < now.getTime()) {
    await kv.delete(proposalKey(id));
    return null;
  }
  return proposal;
}

export async function applyProposal(
  kv: HostKvApi,
  proposal: Proposal,
): Promise<Proposal> {
  const flags = targetFlags(proposal.action);
  for (const lane of proposal.lanes) {
    await kv.put(laneStorageKey(proposal.sessionId, lane), {
      blocked: flags.blocked,
      markedForDeletion: flags.markedForDeletion,
    });
  }
  const applied: Proposal = { ...proposal, status: "applied" };
  await kv.put(proposalKey(applied.id), toJson(applied));
  return applied;
}

function proposalKey(id: string): string {
  return `sim-proposal/${id}`;
}

function toJson(proposal: Proposal): JsonObject {
  return {
    id: proposal.id,
    sessionId: proposal.sessionId,
    action: proposal.action,
    status: proposal.status,
    lanes: proposal.lanes.map((lane) => ({
      locfr: lane.locfr,
      locto: lane.locto,
      prdid: lane.prdid,
      motid: lane.motid,
      addlaneid: lane.addlaneid,
    })),
    createdAt: proposal.createdAt,
    exp: proposal.exp,
  };
}

function parseFlag(value: JsonValue | undefined): StoredFlag | null {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, JsonValue>;
  if (typeof row.blocked !== "boolean" || typeof row.markedForDeletion !== "boolean") return null;
  return { blocked: row.blocked, markedForDeletion: row.markedForDeletion };
}

function parseProposal(value: JsonValue | undefined): Proposal | null {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, JsonValue>;
  if (typeof row.id !== "string" || typeof row.sessionId !== "string") return null;
  if (row.action !== "bloquear" && row.action !== "desbloquear") return null;
  if (row.status !== "pending" && row.status !== "applied") return null;
  if (typeof row.createdAt !== "string" || typeof row.exp !== "number") return null;
  if (!Array.isArray(row.lanes)) return null;
  const lanes: LaneKey[] = [];
  for (const item of row.lanes) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const lane = item as Record<string, JsonValue>;
    if (
      typeof lane.locfr !== "string" ||
      typeof lane.locto !== "string" ||
      typeof lane.prdid !== "string" ||
      typeof lane.motid !== "string" ||
      typeof lane.addlaneid !== "string"
    ) {
      return null;
    }
    lanes.push({
      locfr: lane.locfr,
      locto: lane.locto,
      prdid: lane.prdid,
      motid: lane.motid,
      addlaneid: lane.addlaneid,
    });
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    action: row.action,
    status: row.status,
    lanes,
    createdAt: row.createdAt,
    exp: row.exp,
  };
}
