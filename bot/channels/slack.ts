import { slackChannel } from "@grok/agent-sdk/channels/slack";

export default slackChannel({
  envPrefix: "TRANSPORTE_DESBLOQUEIO",
  suggestedPrompts: [
    {
      title: "Consultar linha",
      message:
        "Consulta a linha de transporte. Origem DS01, destino DE01, produto 12967, modo PAL, id B2B.",
    },
    {
      title: "Pedir desbloqueio",
      message: "Quero solicitar o desbloqueio dessa linha.",
    },
  ],
});
