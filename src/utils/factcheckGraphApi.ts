export interface GraphSourceItem {
  title: string;
  url: string;
  snippet: string;
  source: "web" | "wikipedia" | "duckduckgo";
  quality: "high" | "medium" | "low";
  stance: "support" | "oppose" | "neutral";
  quote: string;
}

export interface GraphSubClaimVerdict {
  sub_claim: string;
  verdict: "True" | "Mostly True" | "Mixed" | "Mostly False" | "False" | "Unverifiable";
  supporting: number;
  opposing: number;
  strongest_links: string[];
  strongest_quotes: string[];
}

export interface GraphRunResponse {
  claim: string;
  verdict: "True" | "Mostly True" | "Mixed" | "Mostly False" | "False" | "Unverifiable";
  confidence: number;
  timeline: string[];
  source_count: number;
  sources: GraphSourceItem[];
  sub_claims: string[];
  table: GraphSubClaimVerdict[];
  gaps: string[];
  recommendations: Array<{ title: string; url: string; whyRelevant: string }>;
}

export const runFactcheckGraphApi = async (payload: {
  claim: string;
  source_url: string;
  context: string;
  input_type: "url" | "image" | "document";
  file_name?: string;
}): Promise<GraphRunResponse> => {
  const base = (import.meta.env.VITE_FACTCHECK_GRAPH_API as string | undefined)?.trim() || "http://127.0.0.1:8787";
  const res = await fetch(`${base}/api/factcheck/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Graph API failed: ${res.status}`);
  return (await res.json()) as GraphRunResponse;
};
