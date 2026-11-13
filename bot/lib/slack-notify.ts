import type { HostSlackClient } from "@grok/agent-sdk";
import type { LaneKey } from "./ibp.js";

type SlackClient = {
  conversations: {
    open: (args: { users: string }) => Promise<{
      ok?: boolean;
      error?: string;
      channel?: { id?: string };
    }>;
  };
  chat: {
    postMessage: (args: { channel: string; text: string }) => Promise<{
      ok?: boolean;
      error?: string;
    }>;
  };
};

export function keyUserSlackId(): string | null {
  const id = process.env.KEY_USER_SLACK_ID?.trim() ?? "";
  return /^[UW][A-Z0-9]+$/.test(id) ? id : null;
}

export function callerSlackId(attributes: Record<string, string> | undefined): string | null {
  const id = attributes?.user_id?.trim() ?? "";
  return /^[UW][A-Z0-9]+$/.test(id) ? id : null;
}

export async function notifySlackUser(
  slack: HostSlackClient,
  userId: string,
  text: string,
): Promise<{ notified: true } | { notified: false; error: string }> {
  let client: SlackClient;
  try {
    client = (await slack.getClient()) as SlackClient;
  } catch {
    return { notified: false, error: "slack_not_configured" };
  }
  try {
    const opened = await client.conversations.open({ users: userId });
    const channel = opened.channel?.id;
    if (opened.ok === false || channel === undefined || channel === "") {
      return { notified: false, error: opened.error ?? "slack_dm_failed" };
    }
    const posted = await client.chat.postMessage({ channel, text });
    if (posted.ok === false) {
      return { notified: false, error: posted.error ?? "slack_post_failed" };
    }
    return { notified: true };
  } catch {
    return { notified: false, error: "slack_post_failed" };
  }
}

export function requestText(id: string, lane: LaneKey): string {
  return [
    `Pedido ${id} para desbloquear uma linha de transporte.`,
    "Planning area GBDRP.",
    `Origem ${lane.locfr}. Destino ${lane.locto}. Produto ${lane.prdid}.`,
    `Modo ${lane.motid}. Id adicional ${lane.addlaneid}.`,
    `Responda neste chat: aprovar ${id}`,
    `Ou responda: recusar ${id}`,
  ].join("\n");
}

export function resultText(id: string, lane: LaneKey, decision: "aprovar" | "recusar"): string {
  const line = `Origem ${lane.locfr}, destino ${lane.locto}, produto ${lane.prdid}, modo ${lane.motid}, id ${lane.addlaneid}.`;
  if (decision === "aprovar") {
    return `Pedido ${id} aprovado. A linha foi desbloqueada. ${line}`;
  }
  return `Pedido ${id} recusado. A linha continua bloqueada. ${line}`;
}
