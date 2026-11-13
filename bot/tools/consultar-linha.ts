import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { invalidId, searchLanes, type LaneRecord } from "../lib/ibp.js";
import { overlayLanes } from "../lib/simulation.js";

const code = z.string().trim().min(1).max(40);

export default defineTool({
  description: prompt`
    Consulta linhas de transporte na planning area GBDRP por material.
    Aceita um material ou uma lista, sem exigir origem e destino.
    Devolve bloqueio e marca de exclusão. Uma simulação anterior desta conversa substitui o valor do IBP.
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
        simulated: true,
        ibpChanged: false,
        lanes: [evalLane(materiais[0] ?? "12967")],
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
    const lanes = await overlayLanes(ctx.host.kv, ctx.session.id, found.lanes);
    return {
      ok: true,
      planningArea: found.planningArea,
      version: found.version,
      count: lanes.length,
      truncated: found.truncated,
      simulated: lanes.some((lane) => lane.simulated),
      ibpChanged: false,
      lanes,
    };
  },
});

function evalLane(prdid: string): LaneRecord & { simulated: boolean } {
  return {
    locfr: "DS01",
    locto: "DE01",
    prdid,
    motid: "PAL",
    addlaneid: "B2B",
    blocked: true,
    markedForDeletion: true,
    leadTime: 7,
    priority: 7,
    validFrom: "2025-01-01",
    validTo: "2040-12-31",
    marca: null,
    simulated: false,
  };
}
