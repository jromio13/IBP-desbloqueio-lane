import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { findLane, invalidId } from "../lib/ibp.js";
import { newRequestId, saveRequest } from "../lib/requests.js";
import { callerSlackId, keyUserSlackId, notifySlackUser, requestText } from "../lib/slack-notify.js";

const code = z.string().trim().min(1).max(40);

export default defineTool({
  description: prompt`
    Abre um pedido de desbloqueio para uma linha bloqueada.
    Use só depois que a pessoa confirmar o pedido, com a chave completa da linha.
    Não altera o IBP. Avisa a Key User no Slack.
  `,
  effect: "write",
  inputSchema: z.object({
    locfr: code.max(20),
    locto: code.max(20),
    prdid: code,
    motid: code.max(10),
    addlaneid: code,
  }),
  async execute(input, ctx) {
    if (ctx.session.purpose === "eval") {
      return { ok: true, status: "pending_approval", requestId: "req_eval00000000", notified: false };
    }
    const lane = {
      locfr: input.locfr,
      locto: input.locto,
      prdid: input.prdid,
      motid: input.motid,
      addlaneid: input.addlaneid,
    };
    if (Object.values(lane).some(invalidId)) return { ok: false, error: "invalid_id" };
    const keyUser = keyUserSlackId();
    if (keyUser === null) return { ok: false, error: "key_user_not_configured" };

    const found = await findLane(lane);
    if (!found.ok) return found;
    if (found.lane === null) return { ok: false, error: "not_found" };
    if (!found.lane.blocked) {
      return { ok: true, status: "not_blocked", requestId: null, notified: false };
    }

    const request = {
      id: newRequestId(),
      status: "pending" as const,
      lane,
      requesterSlackId: callerSlackId(ctx.session.auth?.attributes),
      createdAt: ctx.now().toISOString(),
    };
    await saveRequest(ctx.host.kv, request);
    const notice = await notifySlackUser(ctx.host.slack, keyUser, requestText(request.id, lane));
    return {
      ok: true,
      status: "pending_approval",
      requestId: request.id,
      notified: notice.notified,
      notifyError: notice.notified ? undefined : notice.error,
    };
  },
});
