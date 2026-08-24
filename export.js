/*
 * export.js — turns a project into a PDF (jsPDF) or a Word document
 * (docx.js), following the layout of the original PDP_XXX_*.docx
 * samples: bold location heading, description text, photos side by
 * side, and — for Mängelbeseitigung projects — a second "Mängel-
 * beseitigung:" block with the fix description and after-photos.
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

  function blobDims(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({ width: 800, height: 1067 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  function formatTermin(termin) {
    if (!termin) return "";
    const d = new Date(termin);
    if (isNaN(d)) return termin;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  }

  // ---------------------------------------------------------------- PDF

  async function buildPdf(project) {
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

    async function photoRow(photos) {
      if (!photos || !photos.length) return;
      const gap = 6;
      const cellW = (contentWidth - gap) / 2;
      const maxH = 78;
      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2);
        const dims = await Promise.all(pair.map(p => blobDims(p.blob)));
        const heights = dims.map(d => Math.min(maxH, cellW * (d.height / d.width)));
        const rowH = Math.max(...heights);
        needSpace(rowH + 4);
        for (let j = 0; j < pair.length; j++) {
          const url = await blobToDataURL(pair[j].blob);
          const drawW = Math.min(cellW, heights[j] * (dims[j].width / dims[j].height));
          doc.addImage(url, "JPEG", margin + j * (cellW + gap), y, drawW, heights[j]);
        }
        y += rowH + 5;
      }
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

    return doc.output("blob");
  }

  // --------------------------------------------------------------- DOCX

  async function buildDocx(project) {
    const {
      Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel,
      Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle
    } = window.docx;

    const children = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: project.title, bold: true, size: 32 })],
      spacing: { after: 120 }
    }));
    if (project.termin) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Termin: ${formatTermin(project.termin)}` })] }));
    }
    if (project.teilnehmer && project.teilnehmer.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Teilnehmer: ${project.teilnehmer.join(", ")}` })] , spacing: { after: 200 } }));
    }

    const usableWidthPx = 620; // ~ content width at 96dpi for a two-column photo row
    const cellWidthPx = (usableWidthPx - 20) / 2;
    const maxHeightPx = 300;

    async function imageRuns(photos) {
      const runs = [];
      for (const p of (photos || [])) {
        const dims = await blobDims(p.blob);
        let w = cellWidthPx, h = cellWidthPx * (dims.height / dims.width);
        if (h > maxHeightPx) { h = maxHeightPx; w = maxHeightPx * (dims.width / dims.height); }
        const buf = await p.blob.arrayBuffer();
        runs.push(new ImageRun({ data: buf, transformation: { width: Math.round(w), height: Math.round(h) }, type: "jpg" }));
      }
      return runs;
    }

    async function photoParagraphs(photos) {
      const paras = [];
      const runs = await imageRuns(photos);
      for (let i = 0; i < runs.length; i += 2) {
        const pair = runs.slice(i, i + 2);
        const children = [];
        pair.forEach((r, idx) => {
          children.push(r);
          if (idx < pair.length - 1) children.push(new TextRun({ text: "   " }));
        });
        paras.push(new Paragraph({ children, spacing: { after: 160 } }));
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
