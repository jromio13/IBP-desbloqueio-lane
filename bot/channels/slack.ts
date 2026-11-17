import { slackChannel } from "@grok/agent-sdk/channels/slack";

export default slackChannel({
  envPrefix: "TRANSPORTE_DESBLOQUEIO",
  suggestedPrompts: [
    {
      title: "Consultar cadastro",
      message: "Consulte o cadastro da rota com origem DS01 e destino DE01.",
    },
    {
      title: "Pedir bloqueio",
      message: "Quero bloquear a rota DS01 para DE01. Justificativa: rota temporariamente sem operação.",
    },
  ],
});
