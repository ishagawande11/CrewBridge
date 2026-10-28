'use strict';

/**
 * Local replacement for the Textract step. No cloud OCR is involved, so the worker types the
 * details printed on the ID next to the scan, and these rules cross-check them against the
 * profile, the calendar, the other accounts and the image itself.
 *
 * The check NEVER verifies anyone. It only attaches flags that help the manager decide.
 */

const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

// True when enough of the profile name's words appear in the name printed on the ID.
function nameMatches(profileName, idName) {
  const profile = tokens(profileName);
  if (!profile.length) return false;
  const doc = new Set(tokens(idName));
  return profile.filter((t) => doc.has(t)).length >= Math.min(2, profile.length);
}

const maskNumber = (n) => `****${String(n).replace(/[^A-Za-z0-9]/g, '').slice(-4)}`;

/** Identify a file by its first bytes (the browser-supplied type is never trusted). */
function sniffFile(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  return null;
}

/** Pixel size of a PNG or JPEG, or null (PDFs and unparseable files). */
function imageSize(buf, type) {
  try {
    if (type === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return null;
}

const INFO_FLAGS = new Set(['EXPIRING_SOON']); // worth a glance, but not a failed check
const MIN_SIDE_PX = 480;

function evaluateId({ declared, profileName, size, duplicateOwner, now = new Date() }) {
  const flags = [];
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  if (declared.expiryDate < today) flags.push('DOCUMENT_EXPIRED');
  else if (declared.expiryDate <= soon) flags.push('EXPIRING_SOON');
  if (!nameMatches(profileName, declared.nameOnId)) flags.push('NAME_MISMATCH');
  if (size && Math.min(size.width, size.height) < MIN_SIDE_PX) flags.push('LOW_RESOLUTION');
  if (duplicateOwner) flags.push('DUPLICATE_ID_NUMBER');

  return { method: 'LOCAL_RULES', passed: flags.every((f) => INFO_FLAGS.has(f)), flags, imageSize: size || null };
}

module.exports = { evaluateId, nameMatches, maskNumber, sniffFile, imageSize, tokens };
