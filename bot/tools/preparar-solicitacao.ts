import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { prepararSolicitacao, type RouteInput } from "../lib/cadastro.js";

const route = z.object({
  locfr: z.string().trim().min(1).max(20),
  locto: z.string().trim().min(1).max(20),
  motid: z.string().trim().min(1).max(10).optional(),
  prdid: z.string().trim().min(1).max(40).optional(),
  marca: z.string().trim().min(1).max(60).optional(),
  submarca: z.string().trim().min(1).max(60).optional(),
  classif: z.string().trim().min(1).max(20).optional(),
  addlane: z.string().trim().min(1).max(20).optional(),
  leadTime: z.number().int().min(0).max(999).optional(),
  saida: z.number().int().min(0).max(999).optional(),
  transito: z.number().int().min(0).max(999).optional(),
  recebimento: z.number().int().min(0).max(999).optional(),
  marcarExclusao: z.boolean().optional(),
});

export default defineTool({
  description: prompt`
    Monta a prévia do cadastro na DRPZTLANEOBP, versão INPUTDADOS.
    Exige a justificativa, que irá para a observação.
    Não grava. Mostre a prévia e peça aprovação antes de chamar atender-solicitacao.
  `,
  effect: "read",
  inputSchema: z.object({
    acao: z.enum(["bloquear", "desbloquear"]),
    justificativa: z.string().trim().min(5).max(500),
    rotas: z.array(route).min(1).max(10),
  }),
  async execute(input, ctx) {
    if (ctx.session.purpose === "eval") {
      return { ok: true, ready: true, entidade: "DRPZTLANEOBP", versao: "INPUTDADOS", rotas: [] };
    }
    const rotas: RouteInput[] = input.rotas;
    return prepararSolicitacao({ ...input, rotas });
  },
});
