type NativeCapabilities = {
  available: boolean;
  engine: string;
  qpdfAvailable: boolean;
  mutoolAvailable: boolean;
  message: string;
};

type NativePatchRequest = {
  sourceDataUrl: string;
  replacements: Array<{ originalText: string; newText: string }>;
};

type NativePatchResponse = {
  success: boolean;
  engine: string;
  replacedCount: number;
  outputDataUrl?: string;
  message: string;
};

const hasTauriRuntime = () => {
  const w = window as unknown as { __TAURI__?: unknown };
  return Boolean(w.__TAURI__);
};

const getInvoke = async () => {
  if (!hasTauriRuntime()) return null;
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke;
};

export const getNativePdfCapabilities = async (): Promise<NativeCapabilities | null> => {
  try {
    const invoke = await getInvoke();
    if (!invoke) return null;
    return (await invoke("native_pdf_capabilities")) as NativeCapabilities;
  } catch {
    return null;
  }
};

export const runNativePdfPatch = async (request: NativePatchRequest): Promise<NativePatchResponse | null> => {
  try {
    const invoke = await getInvoke();
    if (!invoke) return null;
    return (await invoke("native_pdf_patch", { req: request })) as NativePatchResponse;
  } catch {
    return null;
  }
};

