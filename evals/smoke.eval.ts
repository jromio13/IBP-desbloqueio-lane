import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "A material lookup calls consultar-linha and does not simulate a change.",
  async test(t) {
    await t.send("Consulta as linhas do material 12967. Só mostre a tabela.");
    t.succeeded();
    t.calledTool("consultar-linha");
    t.notCalledTool("atender-solicitacao");
  },
});
