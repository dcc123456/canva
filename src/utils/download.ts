// Download helpers: trigger browser downloads for Blob, Uint8Array, or string
// payloads without polluting the DOM.
export function downloadBlob(
  data: Blob | Uint8Array | string,
  filename: string,
  mime?: string
): void {
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (typeof data === 'string') {
    blob = new Blob([data], { type: mime ?? 'text/plain;charset=utf-8' });
  } else {
    // Copy into a fresh ArrayBuffer to satisfy the BlobPart type which
    // requires ArrayBuffer (not ArrayBufferLike).
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    blob = new Blob([copy.buffer], { type: mime ?? 'application/octet-stream' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Defer cleanup so the click handler completes its work first.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
