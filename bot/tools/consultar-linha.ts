import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { invalidId, searchLanes, type LaneRecord } from "../lib/ibp.js";

const field = z.string().trim().min(1).max(40).optional();

export default defineTool({
  description: prompt`
    Consulta linhas de transporte na planning area GBDRP.
    Informe ao menos um código: origem, destino, produto, modo ou id adicional.
    Devolve se cada linha está bloqueada para planejamento.
  `,
  effect: "read",
  inputSchema: z
    .object({
      locfr: field,
      locto: field,
      prdid: field,
      motid: z.string().trim().min(1).max(10).optional(),
      addlaneid: field,
    })
    .refine(
      (value) =>
        value.locfr !== undefined ||
        value.locto !== undefined ||
        value.prdid !== undefined ||
        value.motid !== undefined ||
        value.addlaneid !== undefined,
      { message: "Informe ao menos um campo da linha." },
    ),
  async execute(input, ctx) {
    if (ctx.session.purpose === "eval") {
      return {
        ok: true,
        planningArea: "GBDRP",
        version: "__BASELINE",
        count: 1,
        truncated: false,
        lanes: [evalLane(input)],
      };
    }
    for (const value of Object.values(input)) {
      if (value !== undefined && invalidId(value)) {
        return { ok: false, error: "invalid_id" };
      }
    }
    return searchLanes(input);
  },
});

function evalLane(input: {
  locfr?: string;
  locto?: string;
  prdid?: string;
  motid?: string;
  addlaneid?: string;
}): LaneRecord {
  return {
    locfr: input.locfr ?? "DS01",
    locto: input.locto ?? "DE01",
    prdid: input.prdid ?? "12967",
    motid: input.motid ?? "PAL",
    addlaneid: input.addlaneid ?? "B2B",
    blocked: true,
    markedForDeletion: false,
    leadTime: 7,
    priority: 7,
    validFrom: "2025-01-01",
    validTo: "2040-12-31",
    marca: null,
  };
}
