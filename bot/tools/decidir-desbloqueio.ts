import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { unblockLane } from "../lib/ibp.js";
import { loadRequest, saveRequest, type UnlockRequest } from "../lib/requests.js";
import {
  callerSlackId,
  keyUserSlackId,
  notifySlackUser,
  resultText,
} from "../lib/slack-notify.js";

export default defineTool({
  description: prompt`
    Aprova ou recusa um pedido de desbloqueio.
    Só a Key User pode decidir. Aprovar limpa o bloqueio da linha no IBP.
    Recusar não chama a API. Repetir a mesma decisão não altera a linha de novo.
  `,
  effect: "idempotent",
  inputSchema: z.object({
    requestId: z.string().trim().regex(/^req_[a-f0-9]{12}$/),
    decision: z.enum(["aprovar", "recusar"]),
  }),
  async execute({ requestId, decision }, ctx) {
    if (ctx.session.purpose === "eval") {
      return { ok: true, status: "eval", requestId, decision, changed: false };
    }
    const keyUser = keyUserSlackId();
    const caller = callerSlackId(ctx.session.auth?.attributes);
    if (keyUser === null || caller !== keyUser) {
      return { ok: false, error: "not_key_user" };
    }

    const request = await loadRequest(ctx.host.kv, requestId);
    if (request === null) return { ok: false, error: "not_found" };
    if (request.status !== "pending") {
      return { ok: true, status: request.status, requestId, changed: false, lane: request.lane };
    }

    if (decision === "recusar") {
      const closed = await closeRequest(ctx.host.kv, request, decision, ctx.now());
      const notice = await tellRequester(ctx.host.slack, closed, decision);
      return { ok: true, status: "rejected", requestId, changed: true, notified: notice.notified, lane: closed.lane };
    }

    const unlocked = await unblockLane(request.lane);
    if (!unlocked.ok) return unlocked;
    const closed = await closeRequest(ctx.host.kv, request, decision, ctx.now());
    const notice = await tellRequester(ctx.host.slack, closed, decision);
    return {
      ok: true,
      status: "applied",
      requestId,
      changed: true,
      notified: notice.notified,
      lane: unlocked.lane,
      messages: unlocked.messages,
    };
  },
});

async function closeRequest(
  kv: Parameters<typeof saveRequest>[0],
  request: UnlockRequest,
  decision: "aprovar" | "recusar",
  now: Date,
): Promise<UnlockRequest> {
  const closed: UnlockRequest = {
    ...request,
    status: decision === "aprovar" ? "applied" : "rejected",
    decision,
    decidedAt: now.toISOString(),
  };
  await saveRequest(kv, closed);
  return closed;
}

async function tellRequester(
  slack: Parameters<typeof notifySlackUser>[0],
  request: UnlockRequest,
  decision: "aprovar" | "recusar",
): Promise<{ notified: boolean }> {
  if (request.requesterSlackId === null) return { notified: false };
  const notice = await notifySlackUser(
    slack,
    request.requesterSlackId,
    resultText(request.id, request.lane, decision),
  );
  return { notified: notice.notified };
}
