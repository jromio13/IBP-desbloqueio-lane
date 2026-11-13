import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { findLane } from "../lib/ibp.js";
import { applyProposal, loadProposal, overlayLanes } from "../lib/simulation.js";

export default defineTool({
  description: prompt`
    Aplica uma simulação já aprovada pela pessoa.
    Só muda a memória desta conversa. Não grava no IBP.
    Repetir o mesmo id não altera de novo.
  `,
  effect: "idempotent",
  inputSchema: z.object({
    proposalId: z.string().trim().regex(/^sim_[a-f0-9]{12}$/),
  }),
  async execute({ proposalId }, ctx) {
    if (ctx.session.purpose === "eval") {
      return { ok: true, applied: false, ibpChanged: false, proposalId, status: "eval" };
    }
    const proposal = await loadProposal(ctx.host.kv, proposalId, ctx.now());
    if (proposal === null) return { ok: false, error: "not_found" };
    if (proposal.sessionId !== ctx.session.id) return { ok: false, error: "not_found" };
    const applied = proposal.status === "applied" ? proposal : await applyProposal(ctx.host.kv, proposal);
    const lanes = [];
    for (const key of applied.lanes) {
      const found = await findLane(key);
      if (!found.ok) return found;
      if (found.lane === null) continue;
      const [lane] = await overlayLanes(ctx.host.kv, ctx.session.id, [found.lane]);
      lanes.push(lane);
    }
    return {
      ok: true,
      applied: true,
      changed: proposal.status !== "applied",
      ibpChanged: false,
      proposalId,
      acao: applied.action,
      lanes,
    };
  },
});
