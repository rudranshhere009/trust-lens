import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, FileText, Image as ImageIcon, Paperclip, Plus, Send, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AppTrack } from "@/utils/insideData";
import { loadInsideDocuments, type InsideDocumentRecord } from "@/utils/insideDocumentsData";
import {
  createMessageId,
  createThreadId,
  loadInsideChatStore,
  updateInsideChatStore,
  type ChatMessage,
  type ChatThread,
} from "@/utils/insideChatData";
import { runAssistantApi } from "@/utils/assistantApi";

interface InsideChatProps {
  mode: AppTrack;
}

type AttachedAsset = {
  id: string;
  name: string;
  type: string;
  summary: string;
  extracted_text?: string;
};

const TRACK_LABEL: Record<AppTrack, string> = {
  legal: "Legal Assistant",
  compliance: "Compliance Assistant",
  truthdesk: "AI Assistant",
};

const createDefaultThread = (mode: AppTrack): ChatThread => {
  const now = Date.now();
  return {
    id: createThreadId(),
    track: mode,
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: createMessageId(),
        role: "assistant",
        content: "Select a file from From Files, then ask anything about it.",
        createdAt: now,
      },
    ],
  };
};

export const InsideChat = ({ mode }: InsideChatProps) => {
  const [store, setStore] = useState(() => loadInsideChatStore());
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [attachedAsset, setAttachedAsset] = useState<AttachedAsset | null>(null);
  const [assetRefreshTick, setAssetRefreshTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const threads = useMemo(
    () => store.threads.filter((t) => t.track === mode).sort((a, b) => b.updatedAt - a.updatedAt),
    [store.threads, mode]
  );

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? threads[0] ?? null;

  useEffect(() => {
    const refresh = () => setAssetRefreshTick((t) => t + 1);
    const timer = window.setInterval(refresh, 1500);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const assets = useMemo(() => {
    const all = loadInsideDocuments().documents.sort((a, b) => b.uploadedAt - a.uploadedAt);
    const sameDesk = all.filter((d) => d.track === mode);
    const chosen = sameDesk.length > 0 ? sameDesk : all;
    return chosen;
  }, [mode, assetRefreshTick, store.threads.length]);

  const sync = (updater: Parameters<typeof updateInsideChatStore>[0]) => {
    const next = updateInsideChatStore(updater);
    setStore(next);
  };

  const ensureThread = () => {
    if (activeThread) return activeThread;
    const created = createDefaultThread(mode);
    sync((current) => ({ ...current, threads: [created, ...current.threads] }));
    setActiveThreadId(created.id);
    return created;
  };

  const newThread = () => {
    const created = createDefaultThread(mode);
    sync((current) => ({ ...current, threads: [created, ...current.threads] }));
    setActiveThreadId(created.id);
    setInput("");
    setAttachedAsset(null);
  };

  const removeThread = (id: string) => {
    sync((current) => ({ ...current, threads: current.threads.filter((t) => t.id !== id) }));
    if (activeThreadId === id) setActiveThreadId(null);
  };

  const toAttachedAsset = (doc: InsideDocumentRecord): AttachedAsset => ({
    id: doc.id,
    name: doc.name,
    type: doc.type,
    summary: `${doc.status} | trust ${doc.trustScore} | risks ${doc.risks}`,
    extracted_text: (doc.extractedText || doc.summary || "").slice(0, 4000),
  });

  const attachAsset = (doc: InsideDocumentRecord) => {
    const thread = ensureThread();
    const asset = toAttachedAsset(doc);
    const now = Date.now();
    setAttachedAsset(asset);
    sync((current) => ({
      ...current,
      threads: current.threads.map((t) =>
        t.id === thread.id
          ? {
              ...t,
              title: t.title === "New Chat" ? `${doc.name}`.slice(0, 42) : t.title,
              updatedAt: now,
              messages: [
                ...t.messages,
                {
                  id: createMessageId(),
                  role: "assistant",
                  content: `Attached file: ${doc.name}\nType: ${doc.type}\n${asset.summary}`,
                  createdAt: now,
                },
              ],
            }
          : t
      ),
    }));
    setAssetDialogOpen(false);
    inputRef.current?.focus();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isReplying) return;
    setIsReplying(true);
    try {
      const thread = ensureThread();
      const now = Date.now();
      const user: ChatMessage = { id: createMessageId(), role: "user", content: text, createdAt: now };

      const history = thread.messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      let answer = "";
      try {
        const response = await runAssistantApi({
          mode,
          question: text,
          selected_asset: attachedAsset,
          history,
        });
        answer = response.answer;
      } catch {
        answer = attachedAsset
          ? `Working on attached file \"${attachedAsset.name}\".\n\nQuestion: ${text}\n\nGroq/backend response not available right now. Keep backend running and configure Groq keys to enable full responses.`
          : `Question received: ${text}\n\nAttach a file using From Files for context-aware answers.`;
      }

      const assistant: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: answer,
        createdAt: now + 1,
      };

      sync((current) => ({
        ...current,
        threads: current.threads.map((t) =>
          t.id === thread.id
            ? {
                ...t,
                title: t.title === "New Chat" ? text.slice(0, 42) : t.title,
                updatedAt: now,
                messages: [...t.messages, user, assistant],
              }
            : t
        ),
      }));
      setActiveThreadId(thread.id);
      setInput("");
    } finally {
      setIsReplying(false);
    }
  };

  const formatThreadTime = (ts: number) =>
    new Date(ts).toLocaleString([], {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card className="dashboard-card-effect">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="min-w-0 pr-2 leading-tight text-[1.1rem] truncate">{TRACK_LABEL[mode]}</span>
              <Button size="sm" variant="outline" onClick={newThread}>
                <Plus className="h-4 w-4 mr-1" />
                New
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {threads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No chats yet. Start one.</p>
            ) : (
              threads.map((t) => (
                <div key={t.id} className="rounded-md border p-2 flex items-start justify-between gap-2">
                  <button className="text-left flex-1 min-w-0 text-sm" onClick={() => setActiveThreadId(t.id)}>
                    <div className="font-medium leading-5 truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground leading-4 whitespace-nowrap">{formatThreadTime(t.updatedAt)}</div>
                  </button>
                  <Button size="icon" variant="ghost" onClick={() => removeThread(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="dashboard-card-effect h-[700px] flex flex-col">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                {activeThread?.title || "Conversation"}
              </span>
              <Button size="sm" variant="outline" onClick={() => setAssetDialogOpen(true)}>
                <Paperclip className="h-4 w-4 mr-1" />
                From Files
              </Button>
            </CardTitle>
            {attachedAsset ? (
              <div className="text-xs text-muted-foreground rounded border px-2 py-1 mt-2">
                Attached: {attachedAsset.name} | {attachedAsset.summary}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            <ScrollArea className="h-full p-4">
              {!activeThread ? (
                <p className="text-sm text-muted-foreground">Start a new chat to begin.</p>
              ) : (
                <div className="space-y-3">
                  {activeThread.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-md p-3 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground ml-10" : "bg-muted mr-10"}`}
                    >
                      <div className="text-xs opacity-80 mb-1">{m.role === "user" ? "You" : "Assistant"}</div>
                      {m.content}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
          <div className="border-t p-3 flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Message AI Assistant..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button onClick={() => void send()} disabled={isReplying}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>

      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select File Context</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-2">
            {assets.length === 0 ? (
              <div className="text-sm text-muted-foreground">No uploaded files found in this desk.</div>
            ) : (
              assets.map((doc) => (
                <div key={doc.id} className="rounded border p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {doc.type.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      {doc.name}
                    </div>
                    <div className="text-xs text-muted-foreground">{doc.type} | {doc.status} | trust {doc.trustScore} | risks {doc.risks}</div>
                    <div className="text-xs text-muted-foreground">Desk: {doc.track}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.summary}</div>
                  </div>
                  <Button size="sm" onClick={() => attachAsset(doc)}>Attach</Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
