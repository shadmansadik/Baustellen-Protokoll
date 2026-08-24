/*
 * camera.js — turns a raw photo (from the camera <input>) into a
 * stamped photo with GPS position, address and timestamp burned into
 * the image, plus the same data kept as structured metadata for the
 * PDF/Word export.
 */
const Camera = (() => {

  function getPosition() {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
      );
    });
  }

  async function reverseGeocode(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await fetch(url, { headers: { "Accept-Language": "de" } });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.display_name) {
        // Prefer a short "Street number, City" form when available
        const a = data.address || {};
        const street = [a.road, a.house_number].filter(Boolean).join(" ");
        const city = a.city || a.town || a.village || a.municipality || "";
        const short = [street, city].filter(Boolean).join(", ");
        return { short: short || data.display_name, full: data.display_name };
      }
      return null;
    } catch (e) {
      console.warn("Reverse-Geocoding fehlgeschlagen:", e);
      return null;
    }
  }

  async function loadOrientedBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      // Fallback for browsers without imageOrientation support
      return await createImageBitmap(file);
    }
  }

  function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
           `${pad(date.getHours())}:${pad(date.getMinutes())} Uhr`;
  }

  function wrapText(ctx, text, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  async function stampImage(bitmap, meta) {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);

    const lines = [];
    lines.push(meta.timestampText);
    if (meta.addressText) lines.push(meta.addressText);
    if (meta.gps) lines.push(`${meta.gps.lat.toFixed(6)}, ${meta.gps.lng.toFixed(6)}`);

    const fontSize = Math.max(16, Math.round(canvas.width * 0.028));
    ctx.font = `600 ${fontSize}px -apple-system, Roboto, Arial, sans-serif`;
    const lineHeight = fontSize * 135 / 1000 * 1000 / 1000; // keep simple
    const padding = fontSize * 0.6;
    const maxTextWidth = canvas.width - padding * 2;

    // wrap the address line if too long
    let renderLines = [];
    lines.forEach((l, idx) => {
      if (idx === 1) {
        renderLines = renderLines.concat(wrapText(ctx, l, maxTextWidth));
      } else {
        renderLines.push(l);
      }
    });

    const barHeight = renderLines.length * (fontSize * 1.35) + padding * 1.6;
    const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.35, "rgba(0,0,0,0.55)");
    gradient.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight);

    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "bottom";
    let y = canvas.height - padding;
    for (let i = renderLines.length - 1; i >= 0; i--) {
      ctx.fillText(renderLines[i], padding, y);
      y -= fontSize * 1.35;
    }

    // small accent tick top-left of the stamp, purely cosmetic
    ctx.fillStyle = "#F4A340";
    ctx.fillRect(0, canvas.height - barHeight, 5, barHeight);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.86);
    });
  }

  /**
   * Full pipeline: File -> { id, blob, thumbUrl, gps, address, timestamp }
   * onStatus(text) is called with short progress updates for the UI.
   */
  async function processCapturedPhoto(file, onStatus) {
    const now = new Date();
    onStatus && onStatus("Position wird ermittelt …");
    const gps = await getPosition();

    let address = null;
    if (gps) {
      onStatus && onStatus("Adresse wird ermittelt …");
      address = await reverseGeocode(gps.lat, gps.lng);
    }

    onStatus && onStatus("Foto wird gestempelt …");
    const bitmap = await loadOrientedBitmap(file);
    const timestampText = formatTimestamp(now);
    const addressText = address ? address.short : (gps ? "Adresse unbekannt" : "Kein GPS verfügbar");

    const blob = await stampImage(bitmap, {
      timestampText,
      addressText,
      gps
    });

    return {
      id: "photo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      blob,
      gps,
      address: address ? address.short : null,
      addressFull: address ? address.full : null,
      timestamp: now.toISOString(),
      caption: "" // optional short label the user can add afterwards, e.g. "Start Grube"
    };
  }

  /**
   * For photos picked from the gallery/computer instead of taken live.
   * Reads GPS + capture time from the photo's own EXIF data (if present)
   * instead of asking the device for its current location — the photo
   * already has its own position and time baked in.
   */
  async function readExif(file) {
    if (!window.exifr) return { gps: null, dateTaken: null };
    try {
      const data = await window.exifr.parse(file, {
        gps: true,
        pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude"]
      });
      if (!data) return { gps: null, dateTaken: null };
      const gps = (typeof data.latitude === "number" && typeof data.longitude === "number")
        ? { lat: data.latitude, lng: data.longitude, accuracy: null }
        : null;
      const dateTaken = (data.DateTimeOriginal instanceof Date && !isNaN(data.DateTimeOriginal))
        ? data.DateTimeOriginal
        : (data.CreateDate instanceof Date && !isNaN(data.CreateDate) ? data.CreateDate : null);
      return { gps, dateTaken };
    } catch (e) {
      console.warn("EXIF-Auslesen fehlgeschlagen:", e);
      return { gps: null, dateTaken: null };
    }
  }

  async function processUploadedPhoto(file, onStatus) {
    onStatus && onStatus("Foto-Daten werden gelesen …");
    const { gps, dateTaken } = await readExif(file);

    let address = null;
    if (gps) {
      onStatus && onStatus("Adresse wird ermittelt …");
      address = await reverseGeocode(gps.lat, gps.lng);
    }

    onStatus && onStatus("Foto wird gestempelt …");
    const bitmap = await loadOrientedBitmap(file);
    const when = dateTaken || new Date(file.lastModified || Date.now());
    const timestampText = formatTimestamp(when);
    const addressText = address ? address.short : (gps ? "Adresse unbekannt" : "Kein GPS im Foto vorhanden");

    const blob = await stampImage(bitmap, {
      timestampText,
      addressText,
      gps
    });

    return {
      id: "photo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      blob,
      gps,
      address: address ? address.short : null,
      addressFull: address ? address.full : null,
      timestamp: when.toISOString(),
      caption: ""
    };
  }

  return { processCapturedPhoto, processUploadedPhoto, getPosition, reverseGeocode };
})();
