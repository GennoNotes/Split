(function () {
  const NL = "\n";
  const $ = (id) => document.getElementById(id);

  function setStatus(msg, level = "info") {
    const box = $("statusBox");
    if (!box) return;
    box.className = level;
    box.textContent = msg;
  }

  function log(msg) {
    console.log(msg);
    const el = $("log");
    if (el) el.textContent += String(msg) + NL;
  }

  function mustGet(id) {
    const el = $(id);
    if (!el) throw new Error("Missing element #" + id);
    return el;
  }

  function parseRange(rangeStr, totalPages) {
    const s = String(rangeStr || "").trim();
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) throw new Error("Range must look like 2-4");

    let start = parseInt(m[1], 10);
    let end = parseInt(m[2], 10);

    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Range numbers invalid");
    if (start < 1 || end < 1) throw new Error("Pages start at 1");
    if (start > end) throw new Error("Start must be <= end");
    if (totalPages && end > totalPages) throw new Error(`End page exceeds document length (${totalPages})`);

    return { start, end };
  }

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let state = {
    file: null,
    totalPages: 0,
    range: null,
    remainingPdfBytes: null,
    extractedPdfBytes: null,
  };

  function updateStartButtonLabel() {
    const btn = $("startBtn");
    const rangeStr = $("removeRange")?.value || "";
    const trimmed = rangeStr.trim();

    if (!trimmed) {
      btn.textContent = "Start";
      return;
    }

    // Show a friendly label even before we know total pages
    const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) {
      btn.textContent = "Start";
      return;
    }
    btn.textContent = `Start (Remove pages ${m[1]}–${m[2]})`;
  }

  async function loadTotalPages(file) {
    const { PDFDocument } = window.PDFLib;
    const buf = await file.arrayBuffer();
    const doc = await PDFDocument.load(buf);
    return doc.getPageCount();
  }

  async function processSplit() {
    const { PDFDocument } = window.PDFLib;
    if (!PDFDocument) throw new Error("pdf-lib not loaded");

    const file = $("pdfIn")?.files?.[0] || null;
    if (!file) {
      setStatus("Please select a PDF file.", "warn");
      return;
    }

    setStatus("Loading PDF…", "info");
    const srcBytes = await file.arrayBuffer();
    const srcDoc = await PDFDocument.load(srcBytes);
    const total = srcDoc.getPageCount();

    const range = parseRange($("removeRange").value, total);

    // Build extracted doc (removed pages)
    setStatus(`Extracting pages ${range.start}–${range.end}…`, "info");
    const extractedDoc = await PDFDocument.create();
    const extractedIdx = [];
    for (let p = range.start; p <= range.end; p++) extractedIdx.push(p - 1);

    const extractedPages = await extractedDoc.copyPages(srcDoc, extractedIdx); // copyPages is the standard pdf-lib approach [web:392]
    extractedPages.forEach((pg) => extractedDoc.addPage(pg));
    const extractedBytes = await extractedDoc.save();

    // Build remaining doc (everything except removed range)
    setStatus("Building remaining PDF…", "info");
    const remainingDoc = await PDFDocument.create();
    const keepIdx = [];
    for (let i = 0; i < total; i++) {
      const pageNum = i + 1;
      if (pageNum < range.start || pageNum > range.end) keepIdx.push(i);
    }

    const keepPages = await remainingDoc.copyPages(srcDoc, keepIdx); // copyPages usage [web:392]
    keepPages.forEach((pg) => remainingDoc.addPage(pg));
    const remainingBytes = await remainingDoc.save();

    state = {
      file,
      totalPages: total,
      range,
      remainingPdfBytes: remainingBytes,
      extractedPdfBytes: extractedBytes,
    };

    $("downloadRemainingBtn").disabled = false;
    $("downloadExtractedBtn").disabled = false;

    setStatus(
      `Done.\nTotal pages: ${total}\nRemoved: ${range.start}-${range.end}\nRemaining pages: ${total - extractedIdx.length}`,
      "info"
    );
  }

  function bindEvents() {
    mustGet("pdfIn").addEventListener("change", async () => {
      $("downloadRemainingBtn").disabled = true;
      $("downloadExtractedBtn").disabled = true;
      state.remainingPdfBytes = null;
      state.extractedPdfBytes = null;

      const file = $("pdfIn")?.files?.[0] || null;
      if (!file) {
        setStatus("Please select a PDF file.", "warn");
        return;
      }
      setStatus("PDF selected. Enter a range like 2-4, then click Start.", "info");

      try {
        const total = await loadTotalPages(file);
        state.totalPages = total;
        log(`Loaded: ${file.name} (${total} pages)`);
      } catch (e) {
        log("Could not read page count: " + (e?.message || e));
      }
    });

    mustGet("removeRange").addEventListener("input", () => {
      updateStartButtonLabel();
      if (!$("pdfIn")?.files?.length) {
        setStatus("Please select a PDF file first.", "warn");
      } else {
        setStatus("Ready. Click Start to remove that range.", "info");
      }
    });

    mustGet("startBtn").addEventListener("click", async () => {
      try {
        await processSplit();
      } catch (e) {
        console.error(e);
        setStatus("Error: " + (e?.message || String(e)), "error");
        log("Error: " + (e?.stack || e?.message || String(e)));
      }
    });

    mustGet("downloadRemainingBtn").addEventListener("click", () => {
      if (!state.remainingPdfBytes || !state.file || !state.range) {
        setStatus("Nothing to download yet. Click Start first.", "warn");
        return;
      }
      const name = state.file.name.replace(/\.pdf$/i, "");
      downloadBytes(state.remainingPdfBytes, `${name}-remaining.pdf`);
    });

    mustGet("downloadExtractedBtn").addEventListener("click", () => {
      if (!state.extractedPdfBytes || !state.file || !state.range) {
        setStatus("Nothing to download yet. Click Start first.", "warn");
        return;
      }
      const name = state.file.name.replace(/\.pdf$/i, "");
      downloadBytes(state.extractedPdfBytes, `${name}-extracted-${state.range.start}-${state.range.end}.pdf`);
    });

    updateStartButtonLabel();
    setStatus("Ready. Select a PDF, enter a range like 2-4.", "info");
    log("Split script loaded.");
  }

  document.addEventListener("DOMContentLoaded", bindEvents);
})();
