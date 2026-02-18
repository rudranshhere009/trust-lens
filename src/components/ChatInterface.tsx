import { useState, useEffect, useRef } from "react";
import { Send, Bot, User, FileText, ExternalLink, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { loadAppData } from "@/utils/appData";

interface Message {
  id: string;
  type: "user" | "bot";
  content: string;
  timestamp: Date;
  citations?: { text: string; source: string }[];
}

const initialWelcomeMessage: Message = {
  id: "1",
  type: "bot",
  content:
    "Hello. I can help with your saved document analyses, fact-check history, and live web-backed quick answers. Ask anything.",
  timestamp: new Date(),
};

const CHAT_STORAGE_KEY = "trustlens_chat_messages";

const timeoutSignal = (ms: number) => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};

const safeFetchJson = async <T,>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { signal: timeoutSignal(7000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

const fetchWebEvidence = async (query: string) => {
  const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&utf8=&format=json&origin=*`;

  const [wikiSearch, ddg] = await Promise.all([
    safeFetchJson<{ query?: { search?: Array<{ title: string; snippet: string }> } }>(wikiSearchUrl),
    safeFetchJson<{ AbstractText?: string; AbstractURL?: string; Heading?: string }>(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    ),
  ]);

  const citations: { text: string; source: string }[] = [];
  const lines: string[] = [];

  const topWiki = wikiSearch?.query?.search?.[0];
  if (topWiki) {
    const cleanSnippet = topWiki.snippet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    lines.push(`Wikipedia: ${cleanSnippet}`);
    citations.push({
      text: `Wikipedia - ${topWiki.title}`,
      source: `https://en.wikipedia.org/wiki/${encodeURIComponent(topWiki.title)}`,
    });
  }

  if (ddg?.AbstractText && ddg?.AbstractURL) {
    lines.push(`DuckDuckGo: ${ddg.AbstractText}`);
    citations.push({
      text: ddg.Heading || "DuckDuckGo source",
      source: ddg.AbstractURL,
    });
  }

  return {
    summary: lines.join("\n\n"),
    citations,
  };
};

export const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) return [initialWelcomeMessage];
      const parsed = JSON.parse(raw) as Array<Omit<Message, "timestamp"> & { timestamp: string }>;
      return parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
    } catch {
      return [initialWelcomeMessage];
    }
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => {
      if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
        if (viewport) {
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
        }
      }
    }, 0);
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }))));
    } catch {
      // ignore persistence errors
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    const appData = loadAppData();
    const lower = userMessage.content.toLowerCase();

    try {
      let botContent = "";
      let citations: { text: string; source: string }[] = [];

      if (lower.includes("document") || lower.includes("contract") || lower.includes("upload")) {
        if (appData.documents.length === 0) {
          botContent = "No analyzed documents found yet. Upload one in Documents to get risk and trust insights.";
        } else {
          const top = appData.documents.slice(0, 3);
          botContent = `Recent analyzed documents:\n${top
            .map((d) => `- ${d.name}: trust ${d.trustScore}, risks ${d.risks}`)
            .join("\n")}`;
        }
      } else if (lower.includes("fact") || lower.includes("misinformation") || lower.includes("claim")) {
        if (appData.factChecks.length === 0) {
          botContent = "No saved fact-check runs yet. Use the Fact Check tab to analyze text or URLs.";
        } else {
          const top = appData.factChecks.slice(0, 3);
          botContent = `Recent fact checks:\n${top
            .map((f) => `- ${f.title}: ${f.status}, score ${f.trustScore}`)
            .join("\n")}`;
        }
      } else {
        const web = await fetchWebEvidence(userMessage.content);
        if (web.summary) {
          botContent = `Live evidence summary:\n\n${web.summary}\n\nUse these links for deeper verification.`;
          citations = web.citations;
        } else {
          botContent =
            "I could not pull reliable live sources right now. Try a more specific query (for example: law name, event, person, or claim).";
        }
      }

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "bot",
        content: botContent,
        timestamp: new Date(),
        citations,
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleNewChat = () => {
    setMessages([initialWelcomeMessage]);
    setInput("");
    setIsLoading(false);
  };

  const handleClearChat = () => {
    setIsClearing(true);
    setMessages([]);
    setTimeout(() => {
      setMessages([initialWelcomeMessage]);
      setInput("");
      setIsClearing(false);
      localStorage.removeItem(CHAT_STORAGE_KEY);
    }, 700);
  };

  return (
    <Card className="h-[600px] flex flex-col dashboard-card-effect">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center space-x-2">
          <Bot className="h-5 w-5" />
          <span>AI Legal Assistant</span>
          <Badge variant="secondary">Live</Badge>
        </CardTitle>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={handleNewChat}>
            New Chat
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearChat} disabled={isClearing}>
            {isClearing ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Clear Chat"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex space-x-3", message.type === "user" ? "justify-end" : "justify-start")}>
                {message.type === "bot" && (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <Bot className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
                <div className={cn("max-w-[80%] rounded-lg p-3 break-words", message.type === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {message.citations.map((citation, index) => (
                        <button
                          type="button"
                          key={index}
                          className="flex items-center space-x-2 text-xs underline-offset-2 hover:underline"
                          onClick={() => window.open(citation.source, "_blank", "noopener,noreferrer")}
                        >
                          <FileText className="h-3 w-3" />
                          <span>{citation.text}</span>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="text-xs opacity-50 mt-1 text-right">{message.timestamp.toLocaleTimeString()}</div>
                </div>
                {message.type === "user" && (
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-secondary-foreground" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex space-x-3">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary-foreground" />
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                  </div>
                </div>
              </div>
            )}
            {isClearing && (
              <div className="flex justify-center items-center flex-1">
                <div className="flex items-center space-x-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Clearing chat...</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="p-4 border-t">
          <div className="flex space-x-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Ask about your documents or any claim..."
              disabled={isLoading || isClearing}
            />
            <Button onClick={() => void handleSend()} disabled={isLoading || isClearing || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
