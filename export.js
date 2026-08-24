/*
 * export.js — turns a project into a PDF (jsPDF) or a Word document
 * (docx.js), following the layout of the original PDP_XXX_*.docx
 * samples:
 *   Page 1  — cover: logo, title, Termin, Teilnehmer only.
 *   Page 2  — "Anmerkungen" (opening remarks), if any were entered —
 *             its own page, bullet list.
 *   Page 3+ — one location per block: bold heading, description, photos
 *             side by side (with optional captions). The heading,
 *             description and first photo row are always kept together
 *             on one page. Mängelbeseitigung entries get a second
 *             "Mängelbeseitigung:" block with the fix description and
 *             after-photos.
 *   End     — optional deadline ("Frist zur Mängelbeseitigung") and
 *             signature ("Gez.") line.
 * Every page gets a thin border, similar to the original documents.
 */
const Export = (() => {

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function dimsFromSrc(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 800, height: 1067 });
      img.src = src;
    });
  }

  async function blobDims(blob) {
    const url = URL.createObjectURL(blob);
    const dims = await dimsFromSrc(url);
    URL.revokeObjectURL(url);
    return dims;
  }

  function guessImageFormat(dataUrl) {
    return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
  }

  function formatTermin(termin) {
    if (!termin) return "";
    const d = new Date(termin);
    if (isNaN(d)) return termin;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  }

  function formatDateOnly(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  function notesIntro(project) {
    return project.notesAuthor
      ? `Zu Beginn des Termins machte ${project.notesAuthor} zu der Dokumentation über den Bauablauf folgende Anmerkungen:`
      : "Zu Beginn des Termins wurden folgende Anmerkungen gemacht:";
  }

  function notesItems(project) {
    return (project.notes || "").split("\n").map(s => s.trim()).filter(Boolean);
  }

  // ---------------------------------------------------------------- PDF

  async function buildPdf(project, settings) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = 210, pageHeight = 297, margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    function needSpace(h) {
      if (y + h > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    }

    function heading(text, size = 16) {
      needSpace(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.text(text, margin, y);
      y += size * 0.5;
    }

    function bodyText(text, opts = {}) {
      if (!text) return;
      doc.setFont("helvetica", opts.bold ? "bold" : "normal");
      doc.setFontSize(opts.size || 10.5);
      const lines = doc.splitTextToSize(text, contentWidth);
      needSpace(lines.length * 5 + 2);
      doc.text(lines, margin, y);
      y += lines.length * 5 + 2;
    }

    function measureTextHeight(text, size = 10.5) {
      if (!text) return 0;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, contentWidth);
      return lines.length * 5 + 2;
    }

    function underlinedText(text, size = 11) {
      needSpace(8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.text(text, margin, y);
      const w = doc.getTextWidth(text);
      doc.setLineWidth(0.3);
      doc.line(margin, y + 1, margin + w, y + 1);
      y += 7;
    }

    // Photos fill the full column width; height follows their own aspect
    // ratio (capped only as a safety ceiling) so two portrait photos sit
    // close together instead of leaving a wide gap between narrow images.
    const PHOTO_GAP = 5;
    const CELL_W = (contentWidth - PHOTO_GAP) / 2;
    const PHOTO_MAX_H = 130;

    async function measureFirstPhotoRowHeight(photos) {
      if (!photos || !photos.length) return 0;
      const pair = photos.slice(0, 2);
      const dims = await Promise.all(pair.map(p => blobDims(p.blob)));
      const heights = dims.map(d => Math.min(PHOTO_MAX_H, CELL_W * (d.height / d.width)));
      const rowH = Math.max(...heights);
      const hasCaption = pair.some(p => p.caption);
      return rowH + (hasCaption ? 9 : 5);
    }

    async function photoRow(photos) {
      if (!photos || !photos.length) return;
      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2);
        const dims = await Promise.all(pair.map(p => blobDims(p.blob)));
        const heights = dims.map(d => Math.min(PHOTO_MAX_H, CELL_W * (d.height / d.width)));
        const rowH = Math.max(...heights);
        const hasCaption = pair.some(p => p.caption);
        needSpace(rowH + (hasCaption ? 9 : 5));
        for (let j = 0; j < pair.length; j++) {
          const url = await blobToDataURL(pair[j].blob);
          const x = margin + j * (CELL_W + PHOTO_GAP);
          doc.addImage(url, "JPEG", x, y, CELL_W, heights[j]);
          if (pair[j].caption) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8.5);
            doc.text(pair[j].caption, x, y + heights[j] + 4);
          }
        }
        y += rowH + (hasCaption ? 9 : 5);
      }
    }

    function bulletList(items) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      items.forEach((item) => {
        const lines = doc.splitTextToSize(`•  ${item}`, contentWidth - 4);
        needSpace(lines.length * 5 + 2);
        doc.text(lines, margin + 2, y);
        y += lines.length * 5 + 2;
      });
    }

    // ==================================================== COVER PAGE
    if (settings && settings.logoDataUrl) {
      try {
        const dims = await dimsFromSrc(settings.logoDataUrl);
        const maxW = 45, maxH = 22;
        let w = maxW, h = maxW * (dims.height / dims.width);
        if (h > maxH) { h = maxH; w = maxH * (dims.width / dims.height); }
        doc.addImage(settings.logoDataUrl, guessImageFormat(settings.logoDataUrl), pageWidth - margin - w, y, w, h);
        y += h + 10;
      } catch (e) { /* logo is optional, ignore failures */ }
    } else {
      y += 6;
    }

    heading(project.title, 20);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    if (project.termin) { needSpace(7); doc.text(`Termin: ${formatTermin(project.termin)}`, margin, y); y += 7; }
    if (project.teilnehmer && project.teilnehmer.length) {
      const lines = doc.splitTextToSize(`Teilnehmer: ${project.teilnehmer.join(", ")}`, contentWidth);
      needSpace(lines.length * 6 + 2);
      doc.text(lines, margin, y);
      y += lines.length * 6 + 2;
    }

    // ==================================================== ANMERKUNGEN PAGE
    const items = notesItems(project);
    if (items.length) {
      doc.addPage();
      y = margin;
      heading("Anmerkungen", 15);
      y += 2;
      bodyText(notesIntro(project));
      y += 2;
      bulletList(items);
    }

    // ==================================================== ENTRIES
    doc.addPage();
    y = margin;

    for (const entry of project.entries) {
      const descH = measureTextHeight(entry.description);
      const photoH = await measureFirstPhotoRowHeight(entry.photos);
      const reserve = 10 + descH + photoH + 6;
      if (y > margin && y + reserve > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }

      heading(entry.title, 12);
      bodyText(entry.description);
      await photoRow(entry.photos);

      if (entry.fix) {
        const fixDescH = measureTextHeight(entry.fix.description);
        const fixPhotoH = await measureFirstPhotoRowHeight(entry.fix.photos);
        needSpace(8 + fixDescH + fixPhotoH + 4);
        bodyText("Mängelbeseitigung:", { bold: true, size: 11 });
        bodyText(entry.fix.description);
        await photoRow(entry.fix.photos);
      }
      y += 4;
    }

    // ==================================================== SIGNATURE
    if (project.deadline || project.signedBy) {
      needSpace(16);
      y += 4;
      if (project.deadline) {
        underlinedText(`Frist zur Mängelbeseitigung: ${formatDateOnly(project.deadline)}`);
        y += 2;
      }
      if (project.signedBy) {
        needSpace(8);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        const sigDate = project.signedDate ? `, ${formatDateOnly(project.signedDate)}` : "";
        doc.text(`Gez. ${project.signedBy}${sigDate}`, margin, y);
        y += 7;
      }
    }

    // ==================================================== PAGE BORDERS
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(90, 98, 110);
      doc.setLineWidth(0.5);
      doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
    }

    return doc.output("blob");
  }

  // --------------------------------------------------------------- DOCX

  async function buildDocx(project, settings) {
    const {
      Document, Packer, Paragraph, TextRun, ImageRun, UnderlineType, AlignmentType,
      BorderStyle, PageBorderDisplay, PageBorderOffsetFrom, PageBorderZOrder
    } = window.docx;

    const children = [];

    // ==================================================== COVER PAGE
    if (settings && settings.logoDataUrl) {
      try {
        const dims = await dimsFromSrc(settings.logoDataUrl);
        const maxW = 170, maxH = 80;
        let w = maxW, h = maxW * (dims.height / dims.width);
        if (h > maxH) { h = maxH; w = maxH * (dims.width / dims.height); }
        const res = await fetch(settings.logoDataUrl);
        const buf = await res.arrayBuffer();
        const isPng = settings.logoDataUrl.startsWith("data:image/png");
        children.push(new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new ImageRun({ data: buf, transformation: { width: Math.round(w), height: Math.round(h) }, type: isPng ? "png" : "jpg" })],
          spacing: { after: 200 }
        }));
      } catch (e) { /* logo is optional, ignore failures */ }
    }

    children.push(new Paragraph({
      children: [new TextRun({ text: project.title, bold: true, size: 40 })],
      spacing: { after: 200 }
    }));
    if (project.termin) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Termin: ${formatTermin(project.termin)}`, size: 22 })], spacing: { after: 80 } }));
    }
    if (project.teilnehmer && project.teilnehmer.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Teilnehmer: ${project.teilnehmer.join(", ")}`, size: 22 })], spacing: { after: 80 } }));
    }

    let breakBeforeNext = true; // start a fresh page after the cover

    // ==================================================== ANMERKUNGEN PAGE
    const items = notesItems(project);
    if (items.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Anmerkungen", bold: true, size: 30 })],
        spacing: { after: 160 },
        pageBreakBefore: breakBeforeNext
      }));
      breakBeforeNext = false;
      children.push(new Paragraph({ children: [new TextRun({ text: notesIntro(project) })], spacing: { after: 120 } }));
      items.forEach((item) => {
        children.push(new Paragraph({ children: [new TextRun({ text: `•  ${item}` })], spacing: { after: 60 } }));
      });
      breakBeforeNext = true; // entries start on their own page after this
    }

    // ==================================================== ENTRIES
    const PHOTO_GAP_PX = 12;
    const usableWidthPx = 620;
    const cellWidthPx = (usableWidthPx - PHOTO_GAP_PX) / 2;
    const maxHeightPx = 560; // generous ceiling — photos fill the column width instead of shrinking

    async function photoParagraphs(photos) {
      const paras = [];
      const list = photos || [];
      for (let i = 0; i < list.length; i += 2) {
        const pair = list.slice(i, i + 2);
        const runChildren = [];
        for (let j = 0; j < pair.length; j++) {
          const p = pair[j];
          const dims = await blobDims(p.blob);
          let w = cellWidthPx, h = cellWidthPx * (dims.height / dims.width);
          if (h > maxHeightPx) { h = maxHeightPx; w = maxHeightPx * (dims.width / dims.height); }
          const buf = await p.blob.arrayBuffer();
          runChildren.push(new ImageRun({ data: buf, transformation: { width: Math.round(w), height: Math.round(h) }, type: "jpg" }));
          if (j < pair.length - 1) runChildren.push(new TextRun({ text: "  " }));
        }
        paras.push(new Paragraph({ children: runChildren, spacing: { after: pair.some(p => p.caption) ? 40 : 120 } }));
        if (pair.some(p => p.caption)) {
          const capChildren = [];
          pair.forEach((p, j) => {
            capChildren.push(new TextRun({ text: p.caption || "", italics: true, size: 17, color: "6B7684" }));
            if (j < pair.length - 1) capChildren.push(new TextRun({ text: "                              " }));
          });
          paras.push(new Paragraph({ children: capChildren, spacing: { after: 120 } }));
        }
      }
      return paras;
    }

    let firstEntry = true;
    for (const entry of project.entries) {
      children.push(new Paragraph({
        children: [new TextRun({ text: entry.title, bold: true, size: 24 })],
        spacing: { before: 200, after: 80 },
        pageBreakBefore: firstEntry ? breakBeforeNext : false,
        keepNext: true,
        keepLines: true
      }));
      firstEntry = false;

      if (entry.description) {
        children.push(new Paragraph({
          children: [new TextRun({ text: entry.description })],
          spacing: { after: 100 },
          keepNext: true,
          keepLines: true
        }));
      }
      children.push(...(await photoParagraphs(entry.photos)));

      if (entry.fix) {
        children.push(new Paragraph({
          children: [new TextRun({ text: "Mängelbeseitigung:", bold: true, size: 22 })],
          spacing: { before: 100, after: 80 },
          keepNext: true
        }));
        if (entry.fix.description) {
          children.push(new Paragraph({ children: [new TextRun({ text: entry.fix.description })], spacing: { after: 100 }, keepNext: true }));
        }
        children.push(...(await photoParagraphs(entry.fix.photos)));
      }
    }

    // ==================================================== SIGNATURE
    if (project.deadline) {
      children.push(new Paragraph({
        children: [new TextRun({
          text: `Frist zur Mängelbeseitigung: ${formatDateOnly(project.deadline)}`,
          bold: true, underline: { type: UnderlineType.SINGLE }
        })],
        spacing: { before: 200, after: 80 }
      }));
    }
    if (project.signedBy) {
      const sigDate = project.signedDate ? `, ${formatDateOnly(project.signedDate)}` : "";
      children.push(new Paragraph({
        children: [new TextRun({ text: `Gez. ${project.signedBy}${sigDate}`, bold: true })],
        spacing: { before: 100 }
      }));
    }

    // ==================================================== PAGE BORDER
    // Best-effort: older docx bundles may lack the PageBorder* enums, so
    // this degrades gracefully (document still exports, just without the
    // border) instead of failing the whole export.
    const pageProps = {};
    try {
      const side = { style: BorderStyle.SINGLE, size: 18, color: "5A626E", space: 18 };
      const borders = {
        pageBorderTop: side, pageBorderBottom: side, pageBorderLeft: side, pageBorderRight: side
      };
      if (PageBorderDisplay) borders.pageBorderDisplay = PageBorderDisplay.ALL_PAGES;
      if (PageBorderOffsetFrom) borders.pageBorderOffsetFrom = PageBorderOffsetFrom.PAGE;
      if (PageBorderZOrder) borders.pageBorderZOrder = PageBorderZOrder.FRONT;
      pageProps.borders = borders;
    } catch (e) {
      console.warn("Seitenrahmen wird von dieser docx-Version nicht unterstützt:", e);
    }

    let doc;
    try {
      doc = new Document({ sections: [{ properties: { page: pageProps }, children }] });
    } catch (e) {
      console.warn("Seitenrahmen konnte nicht gesetzt werden, Export ohne Rahmen:", e);
      doc = new Document({ sections: [{ properties: {}, children }] });
    }

    return Packer.toBlob(doc);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return { buildPdf, buildDocx, downloadBlob };
})();
