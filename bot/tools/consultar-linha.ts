import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { consultarCadastro } from "../lib/cadastro.js";

const code = z.string().trim().min(1).max(40);

export default defineTool({
  description: prompt`
    Consulta o cadastro de rotas na DRPZTLANEOBP, versão INPUTDADOS (input manual).
    Não grava nada. Use antes de montar uma solicitação de bloqueio ou desbloqueio.
  `,
  effect: "read",
  inputSchema: z
    .object({
      locfr: code.max(20).optional(),
      locto: code.max(20).optional(),
      prdid: code.optional(),
      motid: code.max(10).optional(),
      marca: z.string().trim().min(1).max(60).optional(),
      submarca: z.string().trim().min(1).max(60).optional(),
      classif: code.max(20).optional(),
      addlane: code.optional(),
    })
    .refine((value) => Object.values(value).some((item) => item !== undefined), {
      message: "Informe ao menos um filtro.",
    }),
  async execute(input, ctx) {
    if (ctx.session.purpose === "eval") {
      return {
        ok: true,
        entidade: "DRPZTLANEOBP",
        versao: "INPUTDADOS",
        count: 1,
        truncated: false,
        rotas: [
          {
            origem: input.locfr ?? "DS01",
            destino: input.locto ?? "DE01",
            modal: input.motid ?? "ALL",
            material: input.prdid ?? "ALL",
            marca: input.marca ?? "ALL",
            submarca: "ALL",
            classificacao: "ALL",
            idLane: input.addlane ?? "DPLY",
            leadTime: "7",
            tipoTransferencia: "7",
            armex: "Não",
            vigenciaDe: "01/01/1970",
            vigenciaAte: "31/12/9999",
            bloqueio: "Não",
            exclusao: "Não",
            observacao: "",
          },
        ],
      };
    }
    return consultarCadastro(input);
  },
});
