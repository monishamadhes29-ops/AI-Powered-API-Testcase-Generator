import { useRef, useState } from "react";

export function UploadPanel({ busy, onUpload, onUploadUrl, onClear, visible }: { busy: boolean; onUpload: (file: File) => void; onUploadUrl: (url: string) => void; onClear: () => void; visible: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");

  const accept = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onUpload(file);
  };

  const submitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    onUploadUrl(trimmed);
    setUrl("");
  };

  return (
    <section className="card upload-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Step 1</span>
          <h2>Upload <mark className="hl hl-green">Swagger</mark> specification</h2>
          <p>Choose an OpenAPI YAML, YML, or JSON file, or import one from a URL.</p>
        </div>
        {visible && <button className="button ghost" type="button" onClick={onClear}>Clear</button>}
      </div>
      <button
        type="button"
        className={`drop-zone ${dragging ? "dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files); }}
        disabled={busy}
      >
        <span className="upload-icon" aria-hidden="true">↑</span>
        <strong>{busy ? "Processing specification…" : "Drop your Swagger file here"}</strong>
        <span>or click to browse</span>
        <small>Maximum 5 MB · .yaml · .yml · .json</small>
      </button>
      <input ref={inputRef} type="file" accept=".yaml,.yml,.json,application/json,application/yaml" hidden onChange={(e) => accept(e.target.files)} />

      <div className="or-divider"><span>or</span></div>
      <div className="url-row">
        <input
          type="url"
          placeholder="https://example.com/openapi.json"
          value={url}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") submitUrl(); }}
        />
        <button className="button secondary" type="button" disabled={busy || !url.trim()} onClick={submitUrl}>Fetch</button>
      </div>
    </section>
  );
}
