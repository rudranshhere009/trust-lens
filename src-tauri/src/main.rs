// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use lopdf::content::Content;
use lopdf::{Dictionary, Document, Object, Stream};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePdfCapabilities {
    available: bool,
    engine: String,
    qpdf_available: bool,
    mutool_available: bool,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfReplacementPatch {
    original_text: String,
    new_text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePdfPatchRequest {
    source_data_url: String,
    replacements: Vec<PdfReplacementPatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePdfPatchResponse {
    success: bool,
    engine: String,
    replaced_count: usize,
    output_data_url: Option<String>,
    message: String,
}

fn command_exists(program: &str) -> bool {
    if cfg!(target_os = "windows") {
        Command::new("where")
            .arg(program)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("which")
            .arg(program)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

fn data_url_to_bytes(data_url: &str) -> Result<Vec<u8>, String> {
    let comma = data_url
        .find(',')
        .ok_or_else(|| "Invalid data URL (missing comma separator)".to_string())?;
    let meta = &data_url[..comma];
    let payload = &data_url[comma + 1..];
    if !meta.contains(";base64") {
        return Err("Only base64 data URLs are supported for native PDF patching".to_string());
    }
    base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Failed to decode base64 data URL: {e}"))
}

fn replace_in_text(raw: &[u8], replacements: &[PdfReplacementPatch]) -> (Vec<u8>, usize) {
    let mut text = String::from_utf8_lossy(raw).to_string();
    let mut count = 0usize;
    for r in replacements {
        if r.original_text.is_empty() || r.original_text == r.new_text {
            continue;
        }
        let hits = text.matches(&r.original_text).count();
        if hits > 0 {
            text = text.replace(&r.original_text, &r.new_text);
            count += hits;
        }
    }
    (text.into_bytes(), count)
}

#[tauri::command]
fn native_pdf_capabilities() -> NativePdfCapabilities {
    let qpdf = command_exists("qpdf");
    let mutool = command_exists("mutool");
    NativePdfCapabilities {
        available: true,
        engine: "lopdf-native-object-patch".to_string(),
        qpdf_available: qpdf,
        mutool_available: mutool,
        message: if qpdf || mutool {
            "Native object patch engine is available (lopdf); external tools also detected.".to_string()
        } else {
            "Native object patch engine is available (lopdf).".to_string()
        },
    }
}

#[tauri::command]
fn native_pdf_patch(req: NativePdfPatchRequest) -> Result<NativePdfPatchResponse, String> {
    let replacements: Vec<PdfReplacementPatch> = req
        .replacements
        .into_iter()
        .filter(|r| !r.original_text.trim().is_empty() && r.original_text != r.new_text)
        .collect();
    if replacements.is_empty() {
        return Ok(NativePdfPatchResponse {
            success: false,
            engine: "lopdf-native-object-patch".to_string(),
            replaced_count: 0,
            output_data_url: None,
            message: "No valid replacements were provided.".to_string(),
        });
    }

    let bytes = data_url_to_bytes(&req.source_data_url)?;
    let mut doc = Document::load_mem(&bytes).map_err(|e| format!("Failed to parse PDF: {e}"))?;
    let pages = doc.get_pages();
    let mut replaced_total = 0usize;

    for (_page_no, page_id) in pages {
        let page_data = doc
            .get_page_content(page_id)
            .map_err(|e| format!("Failed to read page content: {e}"))?;
        let mut content = Content::decode(&page_data).map_err(|e| format!("Failed to decode page content: {e}"))?;
        let mut changed_this_page = false;

        for op in content.operations.iter_mut() {
            match op.operator.as_str() {
                "Tj" | "'" | "\"" => {
                    if let Some(Object::String(raw, _)) = op.operands.get_mut(0) {
                        let (next, hits) = replace_in_text(raw, &replacements);
                        if hits > 0 {
                            *raw = next;
                            replaced_total += hits;
                            changed_this_page = true;
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(items)) = op.operands.get_mut(0) {
                        for entry in items.iter_mut() {
                            if let Object::String(raw, _) = entry {
                                let (next, hits) = replace_in_text(raw, &replacements);
                                if hits > 0 {
                                    *raw = next;
                                    replaced_total += hits;
                                    changed_this_page = true;
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if changed_this_page {
            let encoded = content
                .encode()
                .map_err(|e| format!("Failed to encode patched page content: {e}"))?;
            let new_stream_id = doc.add_object(Stream::new(Dictionary::new(), encoded));
            let page_obj = doc
                .get_object_mut(page_id)
                .map_err(|e| format!("Failed to access page object: {e}"))?;
            let page_dict = page_obj
                .as_dict_mut()
                .map_err(|e| format!("Failed to convert page object to dict: {e}"))?;
            page_dict.set("Contents", Object::Reference(new_stream_id));
        }
    }

    if replaced_total == 0 {
        return Ok(NativePdfPatchResponse {
            success: false,
            engine: "lopdf-native-object-patch".to_string(),
            replaced_count: 0,
            output_data_url: None,
            message: "No matching text objects were found for replacement.".to_string(),
        });
    }

    doc.compress();
    let mut out = Vec::<u8>::new();
    doc.save_to(&mut Cursor::new(&mut out))
        .map_err(|e| format!("Failed to save patched PDF: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(out);
    Ok(NativePdfPatchResponse {
        success: true,
        engine: "lopdf-native-object-patch".to_string(),
        replaced_count: replaced_total,
        output_data_url: Some(format!("data:application/pdf;base64,{encoded}")),
        message: "Native object patch completed.".to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![native_pdf_capabilities, native_pdf_patch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
