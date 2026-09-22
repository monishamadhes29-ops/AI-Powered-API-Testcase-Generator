import { useEffect, useState } from "react";
import type { CorrectionReport, ValidationReport } from "../types";
import { StatusPill } from "./StatusPill";

export function ValidationPanel({
  fileName, report, correction, busy, onCorrect, onGenerate, onClear, visible
}: {
  fileName: string;
  report: ValidationReport;
  correction?: CorrectionReport;
  busy: boolean;
  onCorrect: () => void;
  onGenerate: () => void;
  onClear: () => void;
  visible: boolean;
}) {
  const valid = correction ? correction.isCorrectedSpecificationValid : report.isValid;
  const errors = correction ? correction.remainingErrors : report.errors;

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!busy) { setElapsedSeconds(0); return; }
    const id = setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  return (
    <section className="card">
      <div className="section-heading split">
        <div>
          <span className="eyebrow">Step 2</span>
          <h2><mark className="hl hl-blue">Validation</mark> and <mark className="hl hl-amber">correction</mark></h2>
          <p className="file-name">{fileName}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusPill tone={valid ? "success" : "danger"}>{valid ? "Valid specification" : `${errors.length} error(s)`}</StatusPill>
          {visible && <button className="button ghost" type="button" onClick={onClear}>Clear</button>}
        </div>
      </div>

      <div className="metrics-grid compact">
        <div className="metric"><span>OpenAPI</span><strong>{report.openApiVersion || "Unknown"}</strong></div>
        <div className="metric"><span>Errors</span><strong>{errors.length}</strong></div>
        <div className="metric"><span>Warnings</span><strong>{report.warningCount}</strong></div>
        <div className="metric"><span>Correction</span><strong>{correction?.source || "Not run"}</strong></div>
      </div>

      {!valid && (
        <div className="issue-list">
          {errors.map((issue, index) => (
            <article className="issue error" key={`${issue.code}-${index}`}>
              <strong>{issue.code}</strong>
              <code>{issue.path}</code>
              <p>{issue.message}</p>
            </article>
          ))}
        </div>
      )}

      {correction && correction.changes.length > 0 && (
        <div className="correction-list">
          <h3>Corrections applied</h3>
          {correction.changes.map((change, index) => (
            <article className="issue success" key={`${change.path}-${index}`}>
              <strong>{change.correction}</strong>
              <code>{change.path}</code>
              <p>{change.issue} · Confidence {Math.round(change.confidence * 100)}%</p>
            </article>
          ))}
        </div>
      )}

      <div className="action-row">
        {!valid && <button className="button primary" disabled={busy} onClick={onCorrect}>{busy ? "Correcting…" : "Correct errors"}</button>}
        {valid && <button className="button primary" disabled={busy} onClick={onGenerate}>{busy ? `Generating… (${elapsedSeconds}s)` : "Proceed to generate testcases"}</button>}
      </div>
      {valid && busy && elapsedSeconds >= 5 && (
        <p className="muted" style={{ marginTop: 8 }}>
          Larger specifications are processed in small batches to respect the LLM provider's rate limits — this can take a few minutes. Please keep this tab open.
        </p>
      )}
    </section>
  );
}
