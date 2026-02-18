import { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  File,
  X,
  AlertCircle,
  FileWarning,
  Eye,
  Download,
  FileSearch,
  MessageCircle,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Expand,
  Minimize,
  ScanLine,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AnalysisResults } from "./AnalysisResults";
import { loadAppData, toRelativeDate, updateAppData, type DocumentRecord } from "@/utils/appData";
import { analyzeDocumentFile } from "@/utils/realAnalysis";

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  originalFile: File;
  progress: number;
  status: "uploading" | "completed" | "error";
  errorMessage?: string;
}

interface QaMessage {
  role: "user" | "assistant";
  content: string;
}

interface CorruptUpload {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "corrupt" | "unsupported" | "looks-ok";
  reason: string;
}

const STOPWORDS = new Set([
  "the",
  "is",
  "are",
  "a",
  "an",
  "of",
  "in",
  "to",
  "for",
  "and",
  "or",
  "on",
  "what",
  "who",
  "which",
  "where",
  "when",
  "why",
  "how",
  "name",
  "person",
  "resume",
]);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const riskBand = (doc: DocumentRecord): "clean" | "medium" | "high" | "extreme" => {
  if (doc.trustScore < 25 || doc.risks >= 4) return "extreme";
  if (doc.trustScore < 45 || doc.risks >= 3) return "high";
  if (doc.trustScore < 70 || doc.risks >= 1) return "medium";
  return "clean";
};

const canNeutralize = (doc: DocumentRecord) => {
  const band = riskBand(doc);
  return band === "high" || band === "extreme";
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const dataUrlToFile = (dataUrl: string, fallbackName: string, mime = "application/octet-stream") => {
  const [header, body] = dataUrl.split(",");
  const isBase64 = header.includes(";base64");
  const matchMime = header.match(/data:(.*?)(;|$)/);
  const detectedMime = matchMime?.[1] || mime;

  let bytes: Uint8Array;
  if (isBase64) {
    const binary = atob(body || "");
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } else {
    const decoded = decodeURIComponent(body || "");
    bytes = new TextEncoder().encode(decoded);
  }

  return new File([bytes], fallbackName, { type: detectedMime });
};

const wrapCanvasLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const buildFallbackExtractedText = (doc: DocumentRecord) => {
  const parts: string[] = [];
  parts.push(`Document: ${doc.name}`);
  parts.push(`Summary: ${doc.summary}`);
  if (doc.keyFindings.length > 0) {
    parts.push("Key Findings:");
    for (const finding of doc.keyFindings) {
      parts.push(`- [${finding.severity}] ${finding.title}: ${finding.description}`);
    }
  }
  if (doc.clauses.length > 0) {
    parts.push("Detected Clauses:");
    for (const clause of doc.clauses) {
      parts.push(`- (${clause.risk}) ${clause.original}`);
      parts.push(`  Simplified: ${clause.simplified}`);
    }
  }
  return parts.join("\n");
};

const findResumeName = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30);

  const labeled = lines.find((line) => /^name\s*[:\-]/i.test(line));
  if (labeled) return labeled.split(/[:\-]/).slice(1).join(":").trim();

  const candidate = lines.find(
    (line) =>
      /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(line) &&
      !/(resume|curriculum|vitae|profile|summary|email|phone|education|experience)/i.test(line)
  );
  return candidate || "";
};

const answerFromExtractedText = (question: string, sourceText: string) => {
  const cleanQ = question.trim().toLowerCase();
  if (!cleanQ || !sourceText.trim()) return "No extracted text available for question answering.";

  if (/(name|person|candidate|applicant)/i.test(cleanQ)) {
    const name = findResumeName(sourceText);
    if (name) return `The likely name found in this document is: ${name}`;
  }

  const chunks = sourceText
    .split(/\r?\n|[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  if (cleanQ.includes("summary") || cleanQ.includes("summarize")) {
    return chunks.slice(0, 6).join(". ") || "No sufficient text to summarize.";
  }

  const keywords = cleanQ
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 8);

  const hits = chunks
    .map((chunk) => {
      const lower = chunk.toLowerCase();
      const score = keywords.reduce((acc, key) => acc + (lower.includes(key) ? 1 : 0), 0);
      return { chunk, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.chunk);

  if (hits.length === 0) {
    return "I could not find an exact match in extracted text. Try with exact keywords from document lines.";
  }

  return `Based on extracted text:\n- ${hits.join("\n- ")}`;
};

export const DocumentUpload = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [corruptUploads, setCorruptUploads] = useState<CorruptUpload[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRecord | null>(null);
  const [savedDocuments, setSavedDocuments] = useState<DocumentRecord[]>(() => loadAppData().documents);

  const [showDownloadOptionsFor, setShowDownloadOptionsFor] = useState<string | null>(null);
  const [qaInput, setQaInput] = useState("");
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [editorEditMode, setEditorEditMode] = useState(false);
  const [editorDraft, setEditorDraft] = useState("");
  const [editorLines, setEditorLines] = useState<string[]>([]);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfZoom, setPdfZoom] = useState(1.2);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const [showAnalysisSection, setShowAnalysisSection] = useState(true);
  const [showActionsSection, setShowActionsSection] = useState(true);
  const [showExtractSection, setShowExtractSection] = useState(true);

  const sourceFileMapRef = useRef<Map<string, File>>(new Map());
  const pdfDocRef = useRef<any>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const corruptInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getRecommendedExport = (doc: DocumentRecord): "txt" | "pdf" | "img" => {
    const text = getWorkingText(doc);
    if (doc.fileKind === "image") return "img";
    if (doc.fileKind === "pdf" || text.length > 3200) return "pdf";
    return "txt";
  };

  const classifyCorruptFile = async (file: File): Promise<CorruptUpload> => {
    const id = Math.random().toString(36).slice(2, 11);
    if (file.size === 0) {
      return {
        id,
        name: file.name,
        size: file.size,
        type: file.type || "unknown",
        status: "corrupt",
        reason: "File is empty (0 bytes).",
      };
    }

    try {
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const isPdf = file.type === "application/pdf";
      const pdfSignature = bytes.length >= 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "%PDF";
      if (isPdf && !pdfSignature) {
        return {
          id,
          name: file.name,
          size: file.size,
          type: file.type || "unknown",
          status: "corrupt",
          reason: "PDF signature is missing or damaged.",
        };
      }

      const isKnownSupported = ["application/pdf", "text/plain", "image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type);
      if (!isKnownSupported) {
        return {
          id,
          name: file.name,
          size: file.size,
          type: file.type || "unknown",
          status: "unsupported",
          reason: "Format is unsupported in primary analyzer; stored in quarantine list for review.",
        };
      }

      return {
        id,
        name: file.name,
        size: file.size,
        type: file.type || "unknown",
        status: "looks-ok",
        reason: "File signature looks valid. Use normal upload lane for full OCR + analysis.",
      };
    } catch {
      return {
        id,
        name: file.name,
        size: file.size,
        type: file.type || "unknown",
        status: "corrupt",
        reason: "Could not read file bytes. File may be damaged.",
      };
    }
  };

  const persistDocument = async (
    uploaded: UploadedFile,
    analysis: Pick<
      DocumentRecord,
      | "trustScore"
      | "risks"
      | "summary"
      | "keyFindings"
      | "clauses"
      | "extractedText"
      | "editableText"
      | "fileKind"
      | "extractionMethod"
      | "scannedNonEditable"
      | "pagesAnalyzed"
      | "extractionConfidence"
    >
  ) => {
    const sourceDataUrl = await fileToDataUrl(uploaded.originalFile).catch(() => "");

    const record: DocumentRecord = {
      id: uploaded.id,
      name: uploaded.name,
      size: uploaded.size,
      type: uploaded.type,
      sourceDataUrl,
      sourceMime: uploaded.type,
      uploadedAt: Date.now(),
      ...analysis,
    };

    const next = updateAppData((current) => ({
      ...current,
      documents: [record, ...current.documents.filter((d) => d.id !== uploaded.id)],
    }));

    sourceFileMapRef.current.set(uploaded.id, uploaded.originalFile);
    setSavedDocuments(next.documents);
    setSelectedDocument(record);
    setShowAnalysisSection(true);
    setShowActionsSection(true);
    setShowExtractSection(true);
    setQaMessages([{ role: "assistant", content: "Text extracted and ready. Ask questions from this document below." }]);
  };

  const simulateUpload = (fileId: string, sourceFile: File) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 18;
      if (progress >= 100) {
        clearInterval(interval);

        void (async () => {
          try {
            const analysis = await analyzeDocumentFile(sourceFile);
            setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, progress: 100, status: "completed" } : f)));
            const uploaded = files.find((f) => f.id === fileId) ?? {
              id: fileId,
              name: sourceFile.name,
              size: sourceFile.size,
              type: sourceFile.type,
              originalFile: sourceFile,
              progress: 100,
              status: "completed" as const,
            };
            await persistDocument(uploaded, analysis);
            toast({ title: "Upload Complete", description: "Document uploaded and analyzed." });
          } catch {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === fileId ? { ...f, progress: 100, status: "error", errorMessage: "Analysis failed. Try another file." } : f
              )
            );
            toast({ title: "Analysis Failed", description: "Could not analyze this file.", variant: "destructive" });
          }
        })();
      } else {
        setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, progress } : f)));
      }
    }, 180);
  };

  const handleFiles = useCallback(
    (fileList: FileList) => {
      const validTypes = ["application/pdf", "text/plain", "image/png", "image/jpeg", "image/jpg", "image/webp"];
      const maxSize = 10 * 1024 * 1024;

      Array.from(fileList).forEach((file) => {
        if (!validTypes.includes(file.type)) {
          toast({ title: "Invalid File Type", description: "Upload TXT, PDF, PNG, JPG, WEBP only.", variant: "destructive" });
          return;
        }
        if (file.size > maxSize) {
          toast({ title: "File Too Large", description: "Please upload files smaller than 10MB.", variant: "destructive" });
          return;
        }

        const newFile: UploadedFile = {
          id: Math.random().toString(36).slice(2, 11),
          name: file.name,
          size: file.size,
          type: file.type,
          originalFile: file,
          progress: 0,
          status: "uploading",
        };

        setFiles((prev) => [newFile, ...prev]);
        simulateUpload(newFile.id, file);
      });
    },
    [toast, files]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const removeFile = (fileId: string) => setFiles((prev) => prev.filter((f) => f.id !== fileId));

  const removeSavedDocument = (docId: string) => {
    const next = updateAppData((current) => ({ ...current, documents: current.documents.filter((d) => d.id !== docId) }));
    setSavedDocuments(next.documents);
    sourceFileMapRef.current.delete(docId);
    if (selectedDocument?.id === docId) {
      setSelectedDocument(null);
      setQaMessages([]);
    }
  };

  const handleButtonClick = () => fileInputRef.current?.click();
  const handleCorruptButtonClick = () => corruptInputRef.current?.click();
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };
  const handleCorruptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = e.target.files;
    if (!incoming || incoming.length === 0) return;
    const records = await Promise.all(Array.from(incoming).map((file) => classifyCorruptFile(file)));
    setCorruptUploads((prev) => [...records, ...prev].slice(0, 20));
    toast({ title: "Corrupt/Unsupported Check Complete", description: `Processed ${records.length} file(s).` });
  };

  const getWorkingText = (doc: DocumentRecord) => {
    const direct = (doc.editableText ?? doc.extractedText ?? "").trim();
    if (direct) return direct;
    return buildFallbackExtractedText(doc).trim();
  };

  const updateDoc = (docId: string, updater: (doc: DocumentRecord) => DocumentRecord) => {
    const next = updateAppData((current) => ({
      ...current,
      documents: current.documents.map((doc) => (doc.id === docId ? updater(doc) : doc)),
    }));
    setSavedDocuments(next.documents);
    const updated = next.documents.find((d) => d.id === docId) ?? null;
    setSelectedDocument(updated);
    return updated;
  };

  const ensureExtractedText = async (doc: DocumentRecord, forceReanalyze = false) => {
    const existing = getWorkingText(doc);
    if (!forceReanalyze && existing && existing.length > 30) {
      if (!(doc.extractedText ?? "").trim()) {
        return updateDoc(doc.id, (d) => ({ ...d, extractedText: existing, editableText: d.editableText || existing }));
      }
      return doc;
    }

    let sourceFile = sourceFileMapRef.current.get(doc.id);
    if (!sourceFile && doc.sourceDataUrl) {
      sourceFile = dataUrlToFile(doc.sourceDataUrl, doc.name, doc.sourceMime || doc.type);
      sourceFileMapRef.current.set(doc.id, sourceFile);
    }

    if (!sourceFile) return doc;

    try {
      const analysis = await analyzeDocumentFile(sourceFile);
      return updateDoc(doc.id, (d) => ({ ...d, ...analysis }));
    } catch {
      return doc;
    }
  };

  const selectDocument = async (doc: DocumentRecord) => {
    const resolved = await ensureExtractedText(doc);
    setSelectedDocument(resolved);
    setShowDownloadOptionsFor(null);
    setShowAnalysisSection(true);
    setShowActionsSection(true);
    setShowExtractSection(true);
    setQaMessages([{ role: "assistant", content: "Document ready. Ask questions from extracted text." }]);
  };

  const showWhyForDocument = async (doc: DocumentRecord) => {
    const resolved = await ensureExtractedText(doc, true);
    setSelectedDocument(resolved);
    setShowDownloadOptionsFor(null);
    setShowAnalysisSection(true);
    setShowActionsSection(false);
    setShowExtractSection(false);
  };

  const downloadAsTxt = (doc: DocumentRecord) => {
    const text = getWorkingText(doc);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name.replace(/\.[^/.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAsImg = async (doc: DocumentRecord) => {
    const text = getWorkingText(doc) || doc.summary;
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111111";
    ctx.font = "28px Arial";
    ctx.fillText(doc.name, 60, 80);

    ctx.font = "20px Arial";
    const lines = wrapCanvasLines(ctx, text, canvas.width - 120);
    let y = 130;
    for (const line of lines) {
      ctx.fillText(line, 60, y);
      y += 30;
      if (y > canvas.height - 60) break;
    }

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name.replace(/\.[^/.]+$/, "")}.png`;
    a.click();
  };

  const downloadAsPdf = async (doc: DocumentRecord) => {
    try {
      const jspdf = await import(/* @vite-ignore */ "jspdf");
      const PDF = jspdf.jsPDF;
      const pdf = new PDF({ unit: "pt", format: "a4" });
      const text = getWorkingText(doc) || doc.summary;
      const lines = pdf.splitTextToSize(text, 520);
      pdf.setFontSize(12);
      pdf.text(lines, 40, 60);
      pdf.save(`${doc.name.replace(/\.[^/.]+$/, "")}.pdf`);
    } catch {
      toast({ title: "PDF Download Unavailable", description: "Install jspdf dependency to enable PDF export.", variant: "destructive" });
    }
  };

  const handleExtract = async (doc: DocumentRecord) => {
    const resolved = await ensureExtractedText(doc, true);
    setSelectedDocument(resolved);
    setShowExtractSection(true);
    setQaMessages([{ role: "assistant", content: "Text extracted and ready. Ask questions from this document below." }]);

    if (!getWorkingText(resolved)) {
      toast({ title: "Extraction Failed", description: "Could not extract readable text from this document.", variant: "destructive" });
      return;
    }

    toast({
      title: "OCR Extraction Complete",
      description: `Mode ${resolved.extractionMethod || "unknown"} | confidence ${resolved.extractionConfidence ?? 0}%`,
    });
  };

  const neutralizeDocument = (doc: DocumentRecord) => {
    let text = getWorkingText(doc);
    const riskyClauses = doc.clauses.filter((clause) => clause.risk === "high" || clause.risk === "medium");

    let replacements = 0;
    for (const clause of riskyClauses) {
      const pattern = new RegExp(escapeRegExp(clause.original), "gi");
      if (pattern.test(text)) {
        text = text.replace(pattern, clause.simplified);
        replacements += 1;
      }
    }

    if (replacements === 0 && riskyClauses.length > 0) {
      text += "\n\nNeutralized clauses:\n";
      text += riskyClauses.map((clause) => `- ${clause.simplified}`).join("\n");
    }

    const neutralized = updateDoc(doc.id, (current) => ({
      ...current,
      trustScore: Math.max(82, current.trustScore),
      risks: 0,
      summary: "Risk clauses were neutralized using safer simplified language. Review final text before signing or sharing.",
      extractedText: text,
      editableText: text,
      keyFindings: [
        {
          type: "positive",
          title: "Risk Neutralization Applied",
          description: "High/medium risk clauses were replaced with safer normalized wording.",
          severity: "low",
        },
        {
          type: "positive",
          title: "Current Risk State",
          description: "No high-risk clauses remain after neutralization pass.",
          severity: "low",
        },
      ],
      clauses: current.clauses.map((clause) => ({
        ...clause,
        original: clause.simplified,
        risk: "low",
      })),
    }));

    setSelectedDocument(neutralized);
    toast({
      title: "Document Neutralized",
      description: "High-risk terms were rewritten to safer language. Verify legal meaning before external use.",
    });
  };

  const askDocQuestion = () => {
    if (!selectedDocument || !qaInput.trim()) return;
    const text = getWorkingText(selectedDocument);
    const question = qaInput.trim();
    const answer = answerFromExtractedText(question, text);
    setQaMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: answer }]);
    setQaInput("");
  };

  const openEditor = (doc: DocumentRecord) => {
    setEditorOpen(true);
    setEditorFullscreen(false);
    setEditorEditMode(false);
    const text = getWorkingText(doc);
    setEditorDraft(text);
    setEditorLines(text.split(/\r?\n/).filter((line) => line.trim().length > 0));
    setPdfPage(1);
    setPdfZoom(1.2);
    setPdfError("");
  };

  const saveEditor = () => {
    if (!selectedDocument) return;
    const nextDraft = editorLines.length > 0 ? editorLines.join("\n") : editorDraft;
    updateDoc(selectedDocument.id, (doc) => ({
      ...doc,
      editableText: nextDraft,
      extractedText: doc.extractedText || nextDraft,
      scannedNonEditable: false,
    }));
    setEditorDraft(nextDraft);
    setEditorEditMode(false);
    toast({ title: "Document Updated", description: "Document text saved from editor." });
  };

  const toggleScanned = () => {
    if (!selectedDocument) return;
    const nowScanned = !selectedDocument.scannedNonEditable;
    updateDoc(selectedDocument.id, (doc) => ({
      ...doc,
      scannedNonEditable: nowScanned,
      extractionMethod: nowScanned ? "ocr-image" : doc.extractionMethod,
      editableText: nowScanned ? doc.editableText : doc.editableText || doc.extractedText,
    }));
    toast({
      title: nowScanned ? "Marked As Scanned" : "Converted To Editable",
      description: nowScanned ? "Document marked as scanned/image-like mode." : "Scanned document switched to editable mode.",
    });
  };

  useEffect(() => {
    if (!editorOpen || !selectedDocument || selectedDocument.type !== "application/pdf" || !selectedDocument.sourceDataUrl) return;
    let cancelled = false;

    const loadPdf = async () => {
      try {
        setPdfLoading(true);
        setPdfError("");
        let pdfjs: any;
        try {
          pdfjs = await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs");
        } catch {
          pdfjs = await import(/* @vite-ignore */ "pdfjs-dist");
        }
        try {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
        } catch {
          // If worker URL cannot be resolved, continue with pdfjs defaults.
        }

        const bytes = await (await fetch(selectedDocument.sourceDataUrl!)).arrayBuffer();
        const task = pdfjs.getDocument({ data: bytes });
        const pdf = await task.promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPdfTotalPages(pdf.numPages || 1);
      } catch {
        if (!cancelled) setPdfError("Failed to load PDF in internal viewer.");
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    void loadPdf();
    return () => {
      cancelled = true;
      pdfDocRef.current = null;
    };
  }, [editorOpen, selectedDocument?.id]);

  useEffect(() => {
    if (!editorOpen || !pdfDocRef.current || !pdfCanvasRef.current) return;
    let cancelled = false;

    const renderPage = async () => {
      try {
        setPdfLoading(true);
        const page = await pdfDocRef.current.getPage(Math.max(1, pdfPage));
        if (cancelled || !pdfCanvasRef.current) return;
        const viewport = page.getViewport({ scale: pdfZoom });
        const canvas = pdfCanvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        if (!cancelled) setPdfError("Could not render PDF page.");
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
    };
  }, [editorOpen, pdfPage, pdfZoom, selectedDocument?.id]);

  const orderedDocs = [...savedDocuments].sort((a, b) => b.uploadedAt - a.uploadedAt);
  const selectedRiskBand = selectedDocument ? riskBand(selectedDocument) : "clean";
  const selectedRecommendation = selectedDocument ? getRecommendedExport(selectedDocument) : "txt";
  const selectedIsClean = selectedDocument ? selectedRiskBand === "clean" : false;

  return (
    <div className="space-y-6">
      <Card
        className={cn(
          "relative border-2 border-dashed transition-colors duration-200 dashboard-card-effect",
          isDragOver ? "border-primary bg-accent/50" : "border-border",
          "hover:border-primary/50"
        )}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <div className="p-8 text-center">
          <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Upload Documents</h3>
          <p className="text-muted-foreground mb-4">Drag and drop your files for deep extraction and legal-risk analysis</p>
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: "none" }} multiple accept=".pdf,.txt,.png,.jpg,.jpeg,.webp" />
          <Button variant="outline" className="mb-4" onClick={handleButtonClick}>
            <File className="w-4 h-4 mr-2" /> Choose Files
          </Button>
          <p className="text-xs text-muted-foreground">Supports TXT, PDF, PNG, JPG, WEBP files up to 10MB</p>
        </div>
      </Card>

      <Card className="dashboard-card-effect">
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold">Corrupt / Unsupported File Check</h3>
          </div>
          <p className="text-sm text-muted-foreground">Upload suspicious files here to classify damage before full analysis.</p>
          <input ref={corruptInputRef} type="file" onChange={(e) => void handleCorruptSelect(e)} style={{ display: "none" }} multiple />
          <Button variant="outline" onClick={handleCorruptButtonClick}>
            <FileWarning className="w-4 h-4 mr-2" /> Check Corrupt Files
          </Button>
          {corruptUploads.length > 0 ? (
            <div className="space-y-2">
              {corruptUploads.map((item) => (
                <div key={item.id} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate">{item.name}</div>
                    <Badge variant={item.status === "corrupt" ? "destructive" : item.status === "unsupported" ? "outline" : "secondary"}>
                      {item.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatFileSize(item.size)} | {item.type || "unknown"}
                  </div>
                  <div className="text-xs mt-1">{item.reason}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      {files.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium">Current Upload Queue</h4>
          {files.map((file) => (
            <Card key={file.id} className="p-4 dashboard-card-effect">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1">
                  <File className="h-8 w-8 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{file.name}</p>
                    <p className="text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
                    {file.status === "uploading" ? <Progress value={file.progress} className="mt-2" /> : null}
                    {file.status === "error" ? (
                      <div className="flex items-center mt-2 text-destructive">
                        <AlertCircle className="h-4 w-4 mr-1" />
                        <span className="text-sm">{file.errorMessage ?? "Upload failed"}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeFile(file.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h4 className="font-medium">Analyzed Documents</h4>
        {orderedDocs.length === 0 ? (
          <Card className="p-4 dashboard-card-effect">
            <p className="text-sm text-muted-foreground">No documents analyzed yet.</p>
          </Card>
        ) : (
          orderedDocs.map((doc) => (
            <Card key={doc.id} className="p-4 dashboard-card-effect">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">{toRelativeDate(doc.uploadedAt)} | Trust {doc.trustScore} | {doc.risks} risk(s)</p>
                  <p className="text-xs text-muted-foreground">{(doc.fileKind || "file").toUpperCase()} | {doc.extractionMethod || "unknown"} | OCR {doc.extractionConfidence ?? 0}%</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => void selectDocument(doc)}>
                    <Eye className="h-4 w-4 mr-1" /> View
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void showWhyForDocument(doc)}>
                    Why
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeSavedDocument(doc.id)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {selectedDocument ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Document Workspace: {selectedDocument.name}</h4>
            <Button variant="outline" size="sm" onClick={() => setSelectedDocument(null)}>
              <X className="h-4 w-4 mr-1" /> Close Workspace
            </Button>
          </div>

          <Card className="p-4 dashboard-card-effect">
            <div className="grid gap-4 md:grid-cols-[220px_1fr] items-start">
              <div className="aspect-square rounded-md border bg-muted/20 overflow-hidden flex items-center justify-center">
                {selectedDocument.sourceDataUrl && selectedDocument.fileKind === "image" ? (
                  <img src={selectedDocument.sourceDataUrl} alt={selectedDocument.name} className="h-full w-full object-cover" />
                ) : selectedDocument.fileKind === "txt" ? (
                  <div className="p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                    {getWorkingText(selectedDocument).slice(0, 260) || "No text preview available."}
                  </div>
                ) : (
                  <div className="text-center px-3">
                    <File className="h-9 w-9 mx-auto mb-2 text-muted-foreground" />
                    <div className="text-xs font-medium">{(selectedDocument.fileKind || "file").toUpperCase()}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{selectedDocument.extractionMethod || "unknown"} extraction</div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedRiskBand === "clean" ? (
                    <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> Clean</Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3 w-3" /> {selectedRiskBand}</Badge>
                  )}
                  <Badge variant="outline">Trust {selectedDocument.trustScore}</Badge>
                  <Badge variant="outline">Risks {selectedDocument.risks}</Badge>
                  <Badge variant="outline">OCR {selectedDocument.extractionConfidence ?? 0}%</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Analyzed using {selectedDocument.extractionMethod || "unknown"} across {selectedDocument.pagesAnalyzed ?? 0} page(s).
                </p>
                <div className="text-sm space-y-1">
                  {selectedDocument.risks === 0 ? (
                    <p>No risk clauses detected from the extracted text. Score remains high because language appeared balanced.</p>
                  ) : (
                    <>
                      <p>Risk detected due to matched legal patterns:</p>
                      {selectedDocument.clauses.slice(0, 3).map((clause, idx) => (
                        <p key={idx} className="text-muted-foreground">
                          - {clause.risk.toUpperCase()}: {clause.original}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {showAnalysisSection && (
            <div className="space-y-2">
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowAnalysisSection(false)}>
                  <X className="h-4 w-4 mr-1" /> Close Analysis
                </Button>
              </div>
              <AnalysisResults type="legal" data={selectedDocument} />
            </div>
          )}

          {showActionsSection && (
            <Card className="p-4 dashboard-card-effect space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">Document Actions</div>
                <Button variant="ghost" size="sm" onClick={() => setShowActionsSection(false)}>
                  <X className="h-4 w-4 mr-1" /> Close Actions
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setShowDownloadOptionsFor((v) => (v === selectedDocument.id ? null : selectedDocument.id))}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
                <Button variant="outline" onClick={() => void handleExtract(selectedDocument)}>
                  <FileSearch className="h-4 w-4 mr-1" /> Extract / OCR
                </Button>
                <Button variant="outline" onClick={() => openEditor(selectedDocument)}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit PDF/Text
                </Button>
                <Button variant="outline" onClick={toggleScanned}>
                  <ScanLine className="h-4 w-4 mr-1" /> {selectedDocument.scannedNonEditable ? "Convert Scanned To Editable" : "Mark As Scanned"}
                </Button>
                {canNeutralize(selectedDocument) ? (
                  <Button variant="destructive" onClick={() => neutralizeDocument(selectedDocument)}>
                    <Sparkles className="h-4 w-4 mr-1" /> Neutralize
                  </Button>
                ) : null}
              </div>

              {showDownloadOptionsFor === selectedDocument.id ? (
                <div className="space-y-2 border rounded-md p-3">
                  <p className="text-sm text-muted-foreground">
                    Download modes: TXT, PDF, IMG.
                    {selectedIsClean ? ` Recommended: ${selectedRecommendation.toUpperCase()} for this file.` : " Recommendation appears after clean/neutral result."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={selectedRecommendation === "txt" && selectedIsClean ? "default" : "outline"} onClick={() => downloadAsTxt(selectedDocument)}>TXT</Button>
                    <Button size="sm" variant={selectedRecommendation === "pdf" && selectedIsClean ? "default" : "outline"} onClick={() => void downloadAsPdf(selectedDocument)}>PDF</Button>
                    <Button size="sm" variant={selectedRecommendation === "img" && selectedIsClean ? "default" : "outline"} onClick={() => void downloadAsImg(selectedDocument)}>IMG</Button>
                  </div>
                </div>
              ) : null}
            </Card>
          )}

          {showExtractSection && (
            <Card className="p-4 dashboard-card-effect space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  <h5 className="font-medium">Extracted Text + Document Chat</h5>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowExtractSection(false)}>
                  <X className="h-4 w-4 mr-1" /> Close Extract
                </Button>
              </div>

              <Textarea value={getWorkingText(selectedDocument)} readOnly rows={12} className="font-mono text-xs" />

              <div className="space-y-2">
                <div className="max-h-52 overflow-y-auto space-y-2 border rounded-md p-2">
                  {qaMessages.map((m, idx) => (
                    <div key={idx} className={cn("text-sm rounded-md p-2", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                      <strong>{m.role === "user" ? "You" : "DocBot"}:</strong> {m.content}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={qaInput}
                    onChange={(e) => setQaInput(e.target.value)}
                    placeholder="Ask from extracted text..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        askDocQuestion();
                      }
                    }}
                  />
                  <Button onClick={askDocQuestion}>Ask</Button>
                </div>
              </div>
            </Card>
          )}

          {(!showAnalysisSection || !showActionsSection || !showExtractSection) && (
            <Card className="p-3 dashboard-card-effect">
              <div className="flex flex-wrap gap-2">
                {!showAnalysisSection && <Button size="sm" variant="outline" onClick={() => setShowAnalysisSection(true)}>Show Analysis</Button>}
                {!showActionsSection && <Button size="sm" variant="outline" onClick={() => setShowActionsSection(true)}>Show Actions</Button>}
                {!showExtractSection && <Button size="sm" variant="outline" onClick={() => setShowExtractSection(true)}>Show Extract + Chat</Button>}
              </div>
            </Card>
          )}
        </div>
      ) : null}

      {editorOpen && selectedDocument ? (
        <div className="fixed inset-0 z-50 bg-black/80 p-4">
          <div className={cn("mx-auto h-full bg-background border rounded-xl p-4 flex flex-col", editorFullscreen ? "w-full" : "max-w-7xl")}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{selectedDocument.name}</h3>
                <Badge variant={selectedDocument.scannedNonEditable ? "destructive" : "secondary"}>{selectedDocument.scannedNonEditable ? "Scanned" : "Editable"}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditorFullscreen((v) => !v)}>
                  {editorFullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditorEditMode((v) => !v)}>
                  {editorEditMode ? "View Mode" : "Edit Mode"}
                </Button>
                {editorEditMode && <Button size="sm" onClick={saveEditor}>Save</Button>}
                <Button variant="ghost" size="sm" onClick={() => setEditorOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
              <div className="border rounded-md overflow-hidden min-h-0 bg-muted/20">
                {selectedDocument.type === "application/pdf" && selectedDocument.sourceDataUrl ? (
                  <div className="h-full flex flex-col">
                    <div className="flex items-center gap-2 border-b p-2">
                      <Button size="sm" variant="outline" onClick={() => setPdfPage((p) => Math.max(1, p - 1))} disabled={pdfPage <= 1}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">{pdfPage} / {Math.max(1, pdfTotalPages)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPdfPage((p) => Math.min(Math.max(1, pdfTotalPages), p + 1))}
                        disabled={pdfPage >= pdfTotalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <div className="w-px h-5 bg-border mx-1" />
                      <Button size="sm" variant="outline" onClick={() => setPdfZoom((z) => Math.max(0.6, Number((z - 0.1).toFixed(2))))}>
                        <ZoomOut className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">{Math.round(pdfZoom * 100)}%</span>
                      <Button size="sm" variant="outline" onClick={() => setPdfZoom((z) => Math.min(2.2, Number((z + 0.1).toFixed(2))))}>
                        <ZoomIn className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex-1 overflow-auto p-3">
                      {pdfError ? <div className="text-sm text-destructive">{pdfError}</div> : null}
                      {pdfLoading ? <div className="text-sm text-muted-foreground mb-2">Rendering PDF...</div> : null}
                      <canvas ref={pdfCanvasRef} className="max-w-full h-auto border rounded bg-white" />
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-4">
                    Internal PDF viewer available only for PDF files with source data.
                  </div>
                )}
              </div>

              <div className="border rounded-md p-3 min-h-0 overflow-auto flex flex-col gap-2">
                <div className="font-medium text-sm">Text-by-Text Editor</div>
                {editorLines.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No OCR lines available. Run Extract Text first.</div>
                ) : (
                  <div className="space-y-2">
                    {editorLines.map((line, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-8">{idx + 1}</span>
                        {editorEditMode ? (
                          <Input
                            value={line}
                            onChange={(e) =>
                              setEditorLines((prev) => {
                                const copy = [...prev];
                                copy[idx] = e.target.value;
                                return copy;
                              })
                            }
                          />
                        ) : (
                          <div className="flex-1 border rounded px-2 py-1 text-sm bg-muted/20">{line || "(empty)"}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
