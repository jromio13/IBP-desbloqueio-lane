import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "A route lookup calls consultar-linha and does not open a write.",
  async test(t) {
    await t.send("Consulte o cadastro da rota DS01 para DE01. Só mostre a tabela.");
    t.succeeded();
    t.calledTool("consultar-linha");
    t.notCalledTool("preparar-solicitacao");
    t.notCalledTool("atender-solicitacao");
  },
});
