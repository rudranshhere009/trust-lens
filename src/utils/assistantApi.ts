export interface AssistantAssetPayload {
  id: string;
  name: string;
  type: string;
  summary: string;
  extracted_text?: string;
}

export interface AssistantChatPayload {
  mode: "legal" | "compliance" | "truthdesk";
  question: string;
  selected_asset?: AssistantAssetPayload | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AssistantChatResponse {
  answer: string;
  used_asset: boolean;
}

export const runAssistantApi = async (payload: AssistantChatPayload): Promise<AssistantChatResponse> => {
  const base = (import.meta.env.VITE_FACTCHECK_GRAPH_API as string | undefined)?.trim() || "http://127.0.0.1:8787";
  const res = await fetch(`${base}/api/factcheck/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Assistant API failed: ${res.status}`);
  }
  return (await res.json()) as AssistantChatResponse;
};

