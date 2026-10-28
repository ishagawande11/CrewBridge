// Thin fetch wrapper. The session lives in an HttpOnly cookie, so the browser sends it automatically.
export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const qs = (obj) => {
  const p = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
  return p.size ? `?${p}` : '';
};

/** Read a File as base64 (without the data: prefix). */
export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Could not read that file'));
  reader.readAsDataURL(file);
});
