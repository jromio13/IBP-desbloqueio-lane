import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { applyLaneFlags, invalidId } from "../lib/ibp.js";

const laneKey = z.object({
  locfr: z.string().trim().min(1).max(20),
  locto: z.string().trim().min(1).max(20),
  prdid: z.string().trim().min(1).max(40),
  motid: z.string().trim().min(1).max(10),
  addlaneid: z.string().trim().min(1).max(40),
});

export default defineTool({
  description: prompt`
    Atender a solicitação.
    Grava no IBP o bloqueio para planejamento e a marca de exclusão das linhas escolhidas.
    Bloquear marca os dois. Desbloquear limpa os dois.
    Só executa depois que a pessoa clicar em aprovar.
  `,
  effect: "idempotent",
  needsApproval: true,
  inputSchema: z.object({
    acao: z.enum(["bloquear", "desbloquear"]),
    lanes: z.array(laneKey).min(1).max(40),
  }),
  async execute(input, ctx) {
    if (ctx.session.purpose === "eval") {
      return { ok: true, ibpChanged: false, changed: 0, status: "eval", lanes: [] };
    }
    for (const lane of input.lanes) {
      if (Object.values(lane).some(invalidId)) return { ok: false, error: "invalid_id" };
    }
    return applyLaneFlags(input.lanes, input.acao);
  },
});
