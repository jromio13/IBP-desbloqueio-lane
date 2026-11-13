import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { findLane, invalidId, type LaneKey, type LaneRecord } from "../lib/ibp.js";
import { overlayLanes, saveProposal, targetFlags } from "../lib/simulation.js";

const laneKey = z.object({
  locfr: z.string().trim().min(1).max(20),
  locto: z.string().trim().min(1).max(20),
  prdid: z.string().trim().min(1).max(40),
  motid: z.string().trim().min(1).max(10),
  addlaneid: z.string().trim().min(1).max(40),
});

export default defineTool({
  description: prompt`
    Prepara uma simulação para bloquear ou desbloquear linhas.
    Bloquear marca os dois campos: bloqueio para planejamento e exclusão.
    Desbloquear limpa os dois. Não grava no IBP. Não aplica até confirmar-simulacao.
  `,
  effect: "write",
  inputSchema: z.object({
    acao: z.enum(["bloquear", "desbloquear"]),
    lanes: z.array(laneKey).min(1).max(40),
  }),
  async execute(input, ctx) {
    if (ctx.session.purpose === "eval") {
      return { ok: true, applied: false, ibpChanged: false, proposalId: "sim_eval00000000" };
    }
    for (const lane of input.lanes) {
      if (Object.values(lane).some(invalidId)) return { ok: false, error: "invalid_id" };
    }
    const current: Array<LaneRecord & { simulated: boolean }> = [];
    for (const key of input.lanes) {
      const found = await findLane(key);
      if (!found.ok) return found;
      if (found.lane === null) {
        return { ok: false, error: "not_found", detail: key.prdid };
      }
      const [lane] = await overlayLanes(ctx.host.kv, ctx.session.id, [found.lane]);
      current.push(lane);
    }
    const next = targetFlags(input.acao);
    const proposal = await saveProposal(
      ctx.host.kv,
      ctx.session.id,
      input.acao,
      input.lanes satisfies LaneKey[],
      ctx.now(),
    );
    return {
      ok: true,
      applied: false,
      ibpChanged: false,
      proposalId: proposal.id,
      acao: input.acao,
      fields: ["TLANEBLOCKEDFORPLANNING", "TLANEDEL"],
      lanes: current.map((lane) => ({
        locfr: lane.locfr,
        locto: lane.locto,
        prdid: lane.prdid,
        motid: lane.motid,
        addlaneid: lane.addlaneid,
        blocked: lane.blocked,
        markedForDeletion: lane.markedForDeletion,
        nextBlocked: next.blocked,
        nextMarkedForDeletion: next.markedForDeletion,
        simulated: lane.simulated,
      })),
    };
  },
});
