/*
 * export.js — turns a project into a PDF (jsPDF) or a Word document
 * (docx.js), following the layout of the original PDP_XXX_*.docx
 * samples: an optional company logo, a numbered overview list of all
 * locations, then per-location bold heading, description, photos side
 * by side (with optional captions) — and for Mängelbeseitigung
 * projects, a second "Mängelbeseitigung:" block with the fix
 * description and after-photos. Ends with an optional deadline and
 * signature line, matching "Frist zur Mängelbeseitigung" / "Gez.".
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

    async function photoRow(photos) {
      if (!photos || !photos.length) return;
      const gap = 6;
      const cellW = (contentWidth - gap) / 2;
      const maxH = 74;
      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2);
        const dims = await Promise.all(pair.map(p => blobDims(p.blob)));
        const heights = dims.map(d => Math.min(maxH, cellW * (d.height / d.width)));
        const rowH = Math.max(...heights);
        const hasCaption = pair.some(p => p.caption);
        needSpace(rowH + (hasCaption ? 9 : 4));
        for (let j = 0; j < pair.length; j++) {
          const url = await blobToDataURL(pair[j].blob);
          const drawW = Math.min(cellW, heights[j] * (dims[j].width / dims[j].height));
          const x = margin + j * (cellW + gap);
          doc.addImage(url, "JPEG", x, y, drawW, heights[j]);
          if (pair[j].caption) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(8.5);
            doc.text(pair[j].caption, x, y + rowH + 4);
          }
        }
        y += rowH + (hasCaption ? 9 : 5);
      }
    }

    // ---- logo ----
    if (settings && settings.logoDataUrl) {
      try {
        const dims = await dimsFromSrc(settings.logoDataUrl);
        const maxW = 40, maxH = 18;
        let w = maxW, h = maxW * (dims.height / dims.width);
        if (h > maxH) { h = maxH; w = maxH * (dims.width / dims.height); }
        doc.addImage(settings.logoDataUrl, guessImageFormat(settings.logoDataUrl), pageWidth - margin - w, y, w, h);
      } catch (e) { /* logo is optional, ignore failures */ }
    }

    // ---- header ----
    heading(project.title, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    if (project.termin) { needSpace(6); doc.text(`Termin: ${formatTermin(project.termin)}`, margin, y); y += 6; }
    if (project.teilnehmer && project.teilnehmer.length) {
      needSpace(6);
      doc.text(`Teilnehmer: ${project.teilnehmer.join(", ")}`, margin, y);
      y += 8;
    } else {
      y += 3;
    }

    // ---- overview list ----
    const titledEntries = project.entries.filter(e => e.title);
    if (titledEntries.length > 1) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      titledEntries.forEach((e, i) => {
        needSpace(6);
        doc.text(`${i + 1}. ${e.title}`, margin, y);
        y += 5.5;
      });
      y += 4;
    }

    // ---- entries ----
    for (const entry of project.entries) {
      needSpace(12);
      heading(entry.title, 12);
      bodyText(entry.description);
      await photoRow(entry.photos);

      if (entry.fix) {
        needSpace(10);
        bodyText("Mängelbeseitigung:", { bold: true, size: 11 });
        bodyText(entry.fix.description);
        await photoRow(entry.fix.photos);
      }
      y += 4;
    }

    // ---- deadline & signature ----
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

    return doc.output("blob");
  }

  // --------------------------------------------------------------- DOCX

  async function buildDocx(project, settings) {
    const {
      Document, Packer, Paragraph, TextRun, ImageRun, UnderlineType, AlignmentType
    } = window.docx;

    const children = [];

    // ---- logo ----
    if (settings && settings.logoDataUrl) {
      try {
        const dims = await dimsFromSrc(settings.logoDataUrl);
        const maxW = 160, maxH = 70;
        let w = maxW, h = maxW * (dims.height / dims.width);
        if (h > maxH) { h = maxH; w = maxH * (dims.width / dims.height); }
        const res = await fetch(settings.logoDataUrl);
        const buf = await res.arrayBuffer();
        const isPng = settings.logoDataUrl.startsWith("data:image/png");
        children.push(new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new ImageRun({ data: buf, transformation: { width: Math.round(w), height: Math.round(h) }, type: isPng ? "png" : "jpg" })],
          spacing: { after: 120 }
        }));
      } catch (e) { /* logo is optional, ignore failures */ }
    }

    children.push(new Paragraph({
      children: [new TextRun({ text: project.title, bold: true, size: 32 })],
      spacing: { after: 120 }
    }));
    if (project.termin) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Termin: ${formatTermin(project.termin)}` })] }));
    }
    if (project.teilnehmer && project.teilnehmer.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Teilnehmer: ${project.teilnehmer.join(", ")}` })], spacing: { after: 200 } }));
    }

    // ---- overview list ----
    const titledEntries = project.entries.filter(e => e.title);
    if (titledEntries.length > 1) {
      titledEntries.forEach((e, i) => {
        children.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}. ${e.title}` })], spacing: { after: 40 } }));
      });
      children.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 160 } }));
    }

    const usableWidthPx = 620; // ~ content width at 96dpi for a two-column photo row
    const cellWidthPx = (usableWidthPx - 20) / 2;
    const maxHeightPx = 300;

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
          if (j < pair.length - 1) runChildren.push(new TextRun({ text: "   " }));
        }
        paras.push(new Paragraph({ children: runChildren, spacing: { after: pair.some(p => p.caption) ? 40 : 160 } }));
        if (pair.some(p => p.caption)) {
          const capChildren = [];
          pair.forEach((p, j) => {
            capChildren.push(new TextRun({ text: p.caption || "", italics: true, size: 17, color: "6B7684" }));
            if (j < pair.length - 1) capChildren.push(new TextRun({ text: "                              " }));
          });
          paras.push(new Paragraph({ children: capChildren, spacing: { after: 160 } }));
        }
      }
      return paras;
    }

    for (const entry of project.entries) {
      children.push(new Paragraph({
        children: [new TextRun({ text: entry.title, bold: true, size: 24 })],
        spacing: { before: 200, after: 80 }
      }));
      if (entry.description) {
        children.push(new Paragraph({ children: [new TextRun({ text: entry.description })], spacing: { after: 100 } }));
      }
      children.push(...(await photoParagraphs(entry.photos)));

      if (entry.fix) {
        children.push(new Paragraph({
          children: [new TextRun({ text: "Mängelbeseitigung:", bold: true, size: 22 })],
          spacing: { before: 100, after: 80 }
        }));
        if (entry.fix.description) {
          children.push(new Paragraph({ children: [new TextRun({ text: entry.fix.description })], spacing: { after: 100 } }));
        }
        children.push(...(await photoParagraphs(entry.fix.photos)));
      }
    }

    // ---- deadline & signature ----
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

    const doc = new Document({
      sections: [{ properties: {}, children }]
    });

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
