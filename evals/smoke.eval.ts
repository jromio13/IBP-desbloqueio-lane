import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "A transport-lane lookup calls consultar-linha and does not change IBP.",
  async test(t) {
    await t.send(
      "Consulta a linha de transporte. Origem DS01, destino DE01, produto 12967, modo PAL, id adicional B2B. Só diga se está bloqueada.",
    );
    t.succeeded();
    t.calledTool("consultar-linha");
    t.notCalledTool("solicitar-desbloqueio");
    t.notCalledTool("decidir-desbloqueio");
  },
});
