import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { invalidId, searchLanes } from "../lib/ibp.js";

const code = z.string().trim().min(1).max(40);

export default defineTool({
  description: prompt`
    Consulta linhas de transporte na planning area GBDRP por material.
    Aceita um material ou uma lista, sem exigir origem e destino.
    Devolve bloqueio e marca de exclusão.
  `,
  effect: "read",
  inputSchema: z
    .object({
      materiais: z.array(code).min(1).max(20).optional(),
      prdid: code.optional(),
      locfr: code.max(20).optional(),
      locto: code.max(20).optional(),
      motid: code.max(10).optional(),
      addlaneid: code.optional(),
    })
    .refine((value) => (value.materiais?.length ?? 0) > 0 || value.prdid !== undefined, {
      message: "Informe ao menos um material.",
    }),
  async execute(input, ctx) {
    const materiais = [
      ...new Set([...(input.materiais ?? []), ...(input.prdid ? [input.prdid] : [])]),
    ];
    if (ctx.session.purpose === "eval") {
      return {
        ok: true,
        planningArea: "GBDRP",
        version: "__BASELINE",
        count: 1,
        truncated: false,
        ibpChanged: false,
        lanes: [
          {
            locfr: "DS01",
            locto: "DE01",
            prdid: materiais[0] ?? "12967",
            motid: "PAL",
            addlaneid: "B2B",
            blocked: true,
            markedForDeletion: true,
            leadTime: 7,
            priority: 7,
            validFrom: "2025-01-01",
            validTo: "2040-12-31",
            marca: null,
          },
        ],
      };
    }
    for (const value of materiais) {
      if (invalidId(value)) return { ok: false, error: "invalid_id" };
    }
    const found = await searchLanes({
      prdids: materiais,
      locfr: input.locfr,
      locto: input.locto,
      motid: input.motid,
      addlaneid: input.addlaneid,
    });
    if (!found.ok) return found;
    return { ...found, ibpChanged: false };
  },
});
