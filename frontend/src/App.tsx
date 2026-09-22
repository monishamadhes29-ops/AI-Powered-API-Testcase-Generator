import { useState } from "react";
import { LeafLogo } from "./components/LeafLogo";
import { UploadPanel } from "./components/UploadPanel";
import { ValidationPanel } from "./components/ValidationPanel";
import { TestcasePanel } from "./components/TestcasePanel";
import type { ApiTestCase, CorrectionReport, TestcaseSummary, ValidationReport } from "./types";
import { clearSession, confirmGeneration, correctSwagger, downloadUrl, generatePostman, generateTestCases, uploadSwagger, uploadSwaggerFromUrl } from "./services/api";

const categories = ["positive", "negative", "boundary", "authentication", "authorization", "validation", "error-handling"];

export default function App() {
  const [sessionId, setSessionId] = useState<string>();
  const [fileName, setFileName] = useState("");
  const [validation, setValidation] = useState<ValidationReport>();
  const [correction, setCorrection] = useState<CorrectionReport>();
  const [testCases, setTestCases] = useState<ApiTestCase[]>([]);
  const [summary, setSummary] = useState<TestcaseSummary>();
  const [generationSource, setGenerationSource] = useState("");
  const [generationModel, setGenerationModel] = useState("");
  const [postmanReady, setPostmanReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string }>();

  const resetLocal = () => {
    setSessionId(undefined);
    setFileName("");
    setValidation(undefined);
    setCorrection(undefined);
    setTestCases([]);
    setSummary(undefined);
    setGenerationSource("");
    setGenerationModel("");
    setPostmanReady(false);
    setNotice(undefined);
  };

  const applyUploadResult = (data: { sessionId: string; fileName: string; validationReport: ValidationReport }) => {
    setSessionId(data.sessionId);
    setFileName(data.fileName);
    setValidation(data.validationReport);
    setCorrection(undefined);
    setTestCases([]);
    setSummary(undefined);
    setNotice({ type: data.validationReport.isValid ? "success" : "error", text: data.validationReport.isValid ? "Swagger uploaded and validated successfully." : "Swagger uploaded. Review and correct the validation errors." });
  };

  const handleUpload = async (file: File) => {
    setBusy(true);
    setNotice(undefined);
    try {
      applyUploadResult(await uploadSwagger(file));
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Upload failed." });
    } finally {
      setBusy(false);
    }
  };

  const handleUploadFromUrl = async (url: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      applyUploadResult(await uploadSwaggerFromUrl(url));
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Fetching the specification failed." });
    } finally {
      setBusy(false);
    }
  };

  const handleCorrect = async () => {
    if (!sessionId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await correctSwagger(sessionId);
      setCorrection(result);
      setValidation((current) => current ? { ...current, isValid: result.isCorrectedSpecificationValid, errorCount: result.remainingErrors.length, errors: result.remainingErrors } : current);
      setNotice({
        type: result.isCorrectedSpecificationValid ? "success" : "error",
        text: result.isCorrectedSpecificationValid ? `Swagger corrected using ${result.source}.` : "Some validation errors remain after correction."
      });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Correction failed." });
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!sessionId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await confirmGeneration(sessionId);
      const result = await generateTestCases(sessionId, categories);
      setTestCases(result.testCases);
      setSummary(result.summary);
      setGenerationSource(result.generationSource);
      setGenerationModel(result.generationModel ?? "");
      setNotice(result.partial
        ? { type: "error", text: `${result.summary.totalTestCases} API testcases generated, but some spec sections failed (likely rate limits) and were skipped. Re-run generation to retry those.` }
        : { type: "success", text: `${result.summary.totalTestCases} API testcases generated.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Testcase generation failed." });
    } finally {
      setBusy(false);
    }
  };

  const handlePostman = async () => {
    if (!sessionId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await generatePostman(sessionId);
      setPostmanReady(true);
      setNotice({ type: "success", text: "Postman collection generated and ready to download." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Postman generation failed." });
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = (type: "json" | "excel" | "swagger" | "postman") => {
    if (!sessionId) return;
    window.location.assign(downloadUrl(sessionId, type));
  };

  const handleClear = async () => {
    if (sessionId) {
      try { await clearSession(sessionId); } catch { /* Local state should still be reset. */ }
    }
    resetLocal();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <LeafLogo />
        <div className="topbar-actions">
          <button className="button ghost" type="button" disabled={!sessionId || busy} onClick={handleClear}>Clear</button>
        </div>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">Swagger → Quality Test Coverage</span>
            <h2>Generate <mark className="hl hl-green">reliable API testcases</mark> from <mark className="hl hl-blue">Swagger</mark></h2>
            <p>Upload, validate, correct, generate, review, and export — through one controlled Testleaf-themed workflow.</p>
            <div className="hero-badges">
              <span className="hero-badge">⚡ AI-powered</span>
              <span className="hero-badge">✓ Spec-grounded</span>
              <span className="hero-badge">↓ Postman &amp; Excel export</span>
            </div>
          </div>
          <ol className="flow-rail" aria-label="Application flow">
            {[
              ["01", "Upload"], ["02", "Validate"], ["03", "Correct"], ["04", "Generate"], ["05", "Export"]
            ].map(([number, label], index) => (
              <li className="flow-step" key={number}>
                <span>{number}</span>
                <strong>{label}</strong>
                {index < 4 && <i />}
              </li>
            ))}
          </ol>
        </section>

        {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}</div>}

        {!sessionId && <UploadPanel busy={busy} onUpload={handleUpload} onUploadUrl={handleUploadFromUrl} onClear={handleClear} visible={!!sessionId} />}

        {sessionId && validation && !summary && (
          <ValidationPanel
            fileName={fileName}
            report={validation}
            correction={correction}
            busy={busy}
            onCorrect={handleCorrect}
            onGenerate={handleGenerate}
            onClear={handleClear}
            visible={(validation.errors?.length ?? 0) > 0}
          />
        )}

        {sessionId && summary && (
            <TestcasePanel
              testCases={testCases}
              summary={summary}
              generationSource={generationSource}
              generationModel={generationModel}
              onDownload={handleDownload}
              onGeneratePostman={handlePostman}
              postmanReady={postmanReady}
              busy={busy}
              onClear={handleClear}
              onRegenerate={handleGenerate}
              visible={!!summary}
            />
        )}
      </main>

      <footer>
        <span>© 2026 Testleaf Software Solutions Pvt. Ltd. All rights reserved.</span>
      </footer>
    </div>
  );
}
