import { useState, useMemo } from "react";
import JSZip from "jszip";
import CsvUploader from "./CsvUploader.jsx";
import DataChart from "./DataChart.jsx";
import BrushChart from "./BrushChart.jsx";
import PipelineEditor from "./PipelineEditor.jsx";
import { parseCsv, rangeOf } from "../../lib/transforms/parseCsv.js";
import { applyPipeline } from "../../lib/transforms/applyPipeline.js";
import {
  spacingStats,
  roundFriendly,
  UNIFORM_CV_THRESHOLD,
} from "../../lib/transforms/dt.js";
import { writeCsv, sanitizeBaseName } from "../../lib/transforms/writeCsv.js";
import { serializePipeline } from "../../lib/transforms/serializePipeline.js";

// Data Transforms — sibling tool to the SVG Manager.
//
// Cleans CSV data destined for GIST's data import. Currently implemented:
//   - CSV upload + auto-detected parse
//   - Pipeline of three transforms: trim (via brush), resample, remap
//   - Live before/after charts
// Coming next: download bundle (cleaned.csv + pipeline.json).
export default function DataTransformPage({ userEmail }) {
  const [filename, setFilename] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [error, setError] = useState(null);

  // Pair parseResult and pipeline updates so they stay consistent — pipeline
  // defaults are derived from the parsed data, so each new upload gets a
  // fresh pipeline. Trim defaults to full range (a no-op until the user
  // touches the brush). Resample/remap default to disabled with sensible
  // param values so toggling them on Just Works.
  const handleLoaded = ({ filename: name, text }) => {
    setError(null);
    setFilename(name);
    try {
      const result = parseCsv(text);
      setParseResult(result);
      setPipeline(initialPipeline(result));
    } catch (e) {
      setParseResult(null);
      setPipeline(null);
      setError(e.message ?? String(e));
    }
  };

  const handleClear = () => {
    setFilename(null);
    setParseResult(null);
    setPipeline(null);
    setError(null);
  };

  return (
    <div style={{ padding: "1rem 0" }}>
      <PageHeader
        hasUpload={!!parseResult}
        onLoaded={handleLoaded}
        onError={setError}
        onClear={handleClear}
      />
      {!parseResult && !error && <EmptyState />}
      {error && <ErrorBanner message={error} />}
      {parseResult && pipeline && (
        <ParsedView
          filename={filename}
          parseResult={parseResult}
          pipeline={pipeline}
          onPipelineChange={setPipeline}
          userEmail={userEmail}
        />
      )}
    </div>
  );
}

function initialPipeline(parseResult) {
  const { rows } = parseResult;
  const stats = spacingStats(rows);
  const [tMin, tMax] = rangeOf(rows, "t");
  const [vMin, vMax] = rangeOf(rows, "v");
  return {
    version: 1,
    steps: [
      { op: "trim", from: tMin, to: tMax },
      {
        op: "resample",
        enabled: false,
        dt: stats ? roundFriendly(stats.median) : 1,
        method: "linear",
      },
      {
        // Output starts empty so the user can type one bound and have the
        // other auto-fill at 1:1 scaling — see RemapCard in PipelineEditor.
        op: "remap",
        enabled: false,
        input: [vMin, vMax],
        output: [null, null],
      },
    ],
  };
}

function PageHeader({ hasUpload, onLoaded, onError, onClear }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        marginBottom: 16,
        gap: 12,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          Data Transforms
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            marginTop: 2,
          }}
        >
          Clean CSV data for the GIST physics sim importer.
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <CsvUploader
          onLoaded={onLoaded}
          onError={onError}
          label={hasUpload ? "Replace CSV" : "Upload CSV"}
        />
        {hasUpload && (
          <button
            onClick={onClear}
            style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--color-text-tertiary)",
        border: "1px dashed var(--color-border)",
        borderRadius: "var(--border-radius-md)",
        fontSize: 13,
      }}
    >
      Upload a CSV to preview it. Phone-export and simple 2-column formats
      are auto-detected.
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        background: "#FEF2F2",
        color: "#991B1B",
        border: "1px solid #FECACA",
        borderRadius: "var(--border-radius-md)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

function ParsedView({
  filename,
  parseResult,
  pipeline,
  onPipelineChange,
  userEmail,
}) {
  const { rows, timeLabel, valueLabel, warnings } = parseResult;
  const [downloadError, setDownloadError] = useState(null);

  const stats = useMemo(() => spacingStats(rows), [rows]);

  const transformedRows = useMemo(
    () => applyPipeline(rows, pipeline.steps),
    [rows, pipeline]
  );

  const trim = pipeline.steps.find((s) => s.op === "trim");
  const handleTrimChange = ({ from, to }) => {
    onPipelineChange({
      ...pipeline,
      steps: pipeline.steps.map((s) =>
        s.op === "trim" ? { ...s, from, to } : s
      ),
    });
  };

  const sourceSummary = useMemo(() => buildSummary(rows), [rows]);
  const outputSummary = useMemo(
    () => buildSummary(transformedRows),
    [transformedRows]
  );

  const showResampleHint =
    stats && stats.cv > UNIFORM_CV_THRESHOLD && !pipeline.steps.find((s) => s.op === "resample").enabled;

  const handleDownload = async () => {
    setDownloadError(null);
    try {
      const baseName = sanitizeBaseName(filename ?? "data");
      const csv = writeCsv(transformedRows, timeLabel, valueLabel);
      const manifest = serializePipeline({
        pipeline,
        sourceFilename: filename,
        parseResult,
        transformedRows,
        userEmail,
      });

      const zip = new JSZip();
      zip.file(`${baseName}_cleaned.csv`, csv);
      zip.file(`${baseName}_pipeline.json`, JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}_cleaned.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(e.message ?? String(e));
    }
  };

  return (
    <div>
      <SummaryCard
        filename={filename}
        timeLabel={timeLabel}
        valueLabel={valueLabel}
        sourceSummary={sourceSummary}
        outputSummary={outputSummary}
      />

      {warnings.length > 0 && <WarningBanner messages={warnings} />}

      {showResampleHint && (
        <HintBanner>
          Source timing is non-uniform (CV{" "}
          {(stats.cv * 100).toFixed(2)}%). Enable Resample to put samples on
          a uniform Δt grid.
        </HintBanner>
      )}

      <SectionLabel>Source — drag the brush to trim</SectionLabel>
      <BrushChart
        rows={rows}
        timeLabel={timeLabel}
        valueLabel={valueLabel}
        trimFrom={trim.from}
        trimTo={trim.to}
        onTrimChange={handleTrimChange}
      />

      <SectionLabel>Pipeline</SectionLabel>
      <PipelineEditor
        pipeline={pipeline}
        onChange={onPipelineChange}
        originalRows={rows}
        spacingStats={stats}
        valueLabel={valueLabel}
      />

      <SectionLabel>Output</SectionLabel>
      <DataChart
        rows={transformedRows}
        timeLabel={timeLabel}
        valueLabel={valueLabel}
        height={240}
      />

      <DownloadBar
        rowCount={transformedRows.length}
        baseName={sanitizeBaseName(filename ?? "data")}
        onDownload={handleDownload}
        error={downloadError}
      />
    </div>
  );
}

function DownloadBar({ rowCount, baseName, onDownload, error }) {
  const disabled = rowCount === 0;
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          background: "var(--color-surface, #F9FAFB)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--border-radius-md)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          Bundle: <code>{baseName}_cleaned.zip</code> &middot;{" "}
          {rowCount.toLocaleString()} row{rowCount === 1 ? "" : "s"} +
          pipeline.json
        </div>
        <button
          onClick={onDownload}
          disabled={disabled}
          style={{
            fontSize: 13,
            padding: "6px 14px",
            fontWeight: 500,
            background: disabled ? "#E5E7EB" : "#2563EB",
            color: disabled ? "#9CA3AF" : "white",
            border: "none",
            borderRadius: "var(--border-radius-md)",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          Download &#8595;
        </button>
      </div>
      {error && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            fontSize: 12,
            background: "#FEF2F2",
            color: "#991B1B",
            border: "1px solid #FECACA",
            borderRadius: "var(--border-radius-md)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function buildSummary(rows) {
  if (rows.length === 0) {
    return { count: 0, tMin: 0, tMax: 0, vMin: 0, vMax: 0 };
  }
  const [tMin, tMax] = rangeOf(rows, "t");
  const [vMin, vMax] = rangeOf(rows, "v");
  return { count: rows.length, tMin, tMax, vMin, vMax };
}

function SummaryCard({
  filename,
  timeLabel,
  valueLabel,
  sourceSummary,
  outputSummary,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <SummaryColumn
        title="Source"
        timeLabel={timeLabel}
        valueLabel={valueLabel}
        summary={sourceSummary}
        filename={filename}
      />
      <SummaryColumn
        title="Output"
        timeLabel={timeLabel}
        valueLabel={valueLabel}
        summary={outputSummary}
        accent
      />
    </div>
  );
}

function SummaryColumn({
  title,
  timeLabel,
  valueLabel,
  summary,
  filename,
  accent,
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: accent ? "#EFF6FF" : "var(--color-surface, #F9FAFB)",
        border: `1px solid ${accent ? "#BFDBFE" : "var(--color-border)"}`,
        borderRadius: "var(--border-radius-md)",
        fontSize: 12,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: accent ? "#1E3A8A" : "var(--color-text-tertiary)",
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {title}
        {filename && (
          <span style={{ marginLeft: 6, fontWeight: 400, textTransform: "none" }}>
            · {filename}
          </span>
        )}
      </div>
      <SummaryRow label="Rows" value={summary.count.toLocaleString()} />
      <SummaryRow
        label={timeLabel}
        value={`${fmt(summary.tMin)} → ${fmt(summary.tMax)}`}
      />
      <SummaryRow
        label={valueLabel}
        value={`${fmt(summary.vMin)} → ${fmt(summary.vMax)}`}
      />
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 12,
        color: "var(--color-text-primary)",
      }}
    >
      <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--color-text-tertiary)",
        fontWeight: 600,
        margin: "16px 0 6px",
      }}
    >
      {children}
    </div>
  );
}

function WarningBanner({ messages }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "#FFFBEB",
        color: "#92400E",
        border: "1px solid #FDE68A",
        borderRadius: "var(--border-radius-md)",
        fontSize: 12,
        marginBottom: 8,
      }}
    >
      {messages.join(" ")}
    </div>
  );
}

function HintBanner({ children }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "#EFF6FF",
        color: "#1E3A8A",
        border: "1px solid #BFDBFE",
        borderRadius: "var(--border-radius-md)",
        fontSize: 12,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function fmt(x) {
  if (!Number.isFinite(x)) return "—";
  return Number(x).toFixed(3);
}
