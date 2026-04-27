// Pipeline editor — three step cards (trim, resample, remap). The trim step
// has no enable/disable checkbox; it's controlled by the brush above and the
// numeric inputs here. The other two have an enabled flag.
//
// Each card is "card-shaped" so when we eventually graduate to addable steps
// the visual model already matches.
export default function PipelineEditor({
  pipeline,
  onChange,
  originalRows,
  spacingStats,
  valueLabel,
}) {
  const updateStep = (op, patch) => {
    onChange({
      ...pipeline,
      steps: pipeline.steps.map((s) => (s.op === op ? { ...s, ...patch } : s)),
    });
  };

  const trim = pipeline.steps.find((s) => s.op === "trim");
  const resample = pipeline.steps.find((s) => s.op === "resample");
  const remap = pipeline.steps.find((s) => s.op === "remap");

  const tMin = originalRows[0]?.t ?? 0;
  const tMax = originalRows[originalRows.length - 1]?.t ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <TrimCard
        step={trim}
        tMin={tMin}
        tMax={tMax}
        onChange={(patch) => updateStep("trim", patch)}
      />
      <ResampleCard
        step={resample}
        spacingStats={spacingStats}
        tMin={tMin}
        tMax={tMax}
        onChange={(patch) => updateStep("resample", patch)}
      />
      <RemapCard
        step={remap}
        valueLabel={valueLabel}
        onChange={(patch) => updateStep("remap", patch)}
      />
    </div>
  );
}

function TrimCard({ step, tMin, tMax, onChange }) {
  const isFullRange = step.from <= tMin && step.to >= tMax;
  return (
    <CardShell
      title="Trim"
      subtitle="Crop a time window. Output is rebased to start at t=0."
      active={!isFullRange || tMin !== 0}
    >
      <div style={fieldRowStyle}>
        <Field label="From">
          <NumberInput
            value={step.from}
            onCommit={(v) => onChange({ from: clamp(v, tMin, step.to) })}
            step="any"
          />
        </Field>
        <Field label="To">
          <NumberInput
            value={step.to}
            onCommit={(v) => onChange({ to: clamp(v, step.from, tMax) })}
            step="any"
          />
        </Field>
        <button
          onClick={() => onChange({ from: tMin, to: tMax })}
          style={smallButtonStyle}
        >
          Reset
        </button>
      </div>
    </CardShell>
  );
}

function ResampleCard({ step, spacingStats, tMin, tMax, onChange }) {
  const sampleCount = step.dt > 0
    ? Math.floor((tMax - tMin) / step.dt) + 1
    : 0;
  const cvPct = spacingStats ? (spacingStats.cv * 100).toFixed(2) : "—";
  return (
    <CardShell
      title="Resample"
      subtitle={`Linear interpolation to uniform Δt. Source CV: ${cvPct}%.`}
      enabled={step.enabled}
      onToggleEnabled={(checked) => onChange({ enabled: checked })}
      active={step.enabled}
    >
      <div style={fieldRowStyle}>
        <Field label="Δt">
          <NumberInput
            value={step.dt}
            onCommit={(v) => v > 0 && onChange({ dt: v })}
            step="any"
            disabled={!step.enabled}
          />
        </Field>
        <Field label="Method">
          <select
            value={step.method}
            onChange={(e) => onChange({ method: e.target.value })}
            disabled={!step.enabled}
            style={selectStyle}
          >
            <option value="linear">linear</option>
          </select>
        </Field>
        <span style={hintStyle}>~{sampleCount.toLocaleString()} samples</span>
      </div>
    </CardShell>
  );
}

function RemapCard({ step, valueLabel, onChange }) {
  const inputSpan = step.input[1] - step.input[0];
  const isComplete = step.output[0] != null && step.output[1] != null;

  // Auto-fill 1:1 in the OTHER output box if it hasn't been set yet. Once
  // the user has typed both, no further auto-fill — explicit values win.
  const updateOutputMin = (v) => {
    let nextMax = step.output[1];
    if (v != null && nextMax == null && Number.isFinite(inputSpan)) {
      nextMax = v + inputSpan;
    }
    onChange({ output: [v, nextMax] });
  };
  const updateOutputMax = (v) => {
    let nextMin = step.output[0];
    if (v != null && nextMin == null && Number.isFinite(inputSpan)) {
      nextMin = v - inputSpan;
    }
    onChange({ output: [nextMin, v] });
  };

  return (
    <CardShell
      title="Remap"
      subtitle={
        step.enabled && !isComplete
          ? `Type one output bound — the other auto-fills 1:1 with input.`
          : `Linear rescale of "${valueLabel}" into sim-world units.`
      }
      enabled={step.enabled}
      onToggleEnabled={(checked) => onChange({ enabled: checked })}
      active={step.enabled && isComplete}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={fieldRowStyle}>
          <Field label="Input min">
            <NumberInput
              value={step.input[0]}
              onCommit={(v) => onChange({ input: [v, step.input[1]] })}
              disabled={!step.enabled}
            />
          </Field>
          <Field label="Input max">
            <NumberInput
              value={step.input[1]}
              onCommit={(v) => onChange({ input: [step.input[0], v] })}
              disabled={!step.enabled}
            />
          </Field>
        </div>
        <div style={fieldRowStyle}>
          <Field label="Output min">
            <NumberInput
              value={step.output[0]}
              onCommit={updateOutputMin}
              disabled={!step.enabled}
              placeholder={fmtPlaceholder(step.input[0])}
            />
          </Field>
          <Field label="Output max">
            <NumberInput
              value={step.output[1]}
              onCommit={updateOutputMax}
              disabled={!step.enabled}
              placeholder={fmtPlaceholder(step.input[1])}
            />
          </Field>
        </div>
      </div>
    </CardShell>
  );
}

function fmtPlaceholder(x) {
  if (!Number.isFinite(x)) return "";
  return Number.isInteger(x) ? String(x) : Number(x).toFixed(3);
}

function CardShell({
  title,
  subtitle,
  enabled,
  onToggleEnabled,
  active,
  children,
}) {
  const hasToggle = onToggleEnabled != null;
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderLeft: active
          ? "3px solid #2563EB"
          : "3px solid var(--color-border)",
        borderRadius: "var(--border-radius-md)",
        padding: "10px 12px",
        background: active ? "white" : "#FAFAFA",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        {hasToggle && (
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            style={{ margin: 0 }}
          />
        )}
        <strong style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
          {title}
        </strong>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
          {subtitle}
        </span>
      </div>
      <div
        style={{
          opacity: hasToggle && !enabled ? 0.5 : 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        fontSize: 11,
        color: "var(--color-text-tertiary)",
      }}
    >
      <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

// Numeric input that defers the onChange call until blur or Enter, so typing
// "1.5" doesn't fire pipeline updates at "1" and "1." along the way.
//
// `value === null` renders an empty box (used by RemapCard so users can fill
// just one of output min/max and have the other auto-fill 1:1).
function NumberInput({ value, onCommit, disabled, step = "any", placeholder }) {
  return (
    <input
      key={value ?? "empty"}
      type="number"
      defaultValue={value ?? ""}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      onBlur={(e) => {
        const txt = e.target.value;
        if (txt === "") {
          if (value !== null) onCommit(null);
          return;
        }
        const v = Number(txt);
        if (Number.isFinite(v) && v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
      }}
      style={inputStyle}
    />
  );
}

const inputStyle = {
  fontSize: 12,
  padding: "3px 6px",
  width: 100,
  fontFamily: "var(--font-mono, monospace)",
  border: "1px solid var(--color-border)",
  borderRadius: 4,
};

const selectStyle = {
  fontSize: 12,
  padding: "3px 6px",
  border: "1px solid var(--color-border)",
  borderRadius: 4,
};

const fieldRowStyle = {
  display: "flex",
  alignItems: "flex-end",
  gap: 12,
  flexWrap: "wrap",
};

const smallButtonStyle = {
  fontSize: 11,
  padding: "4px 8px",
  color: "var(--color-text-secondary)",
};

const hintStyle = {
  fontSize: 11,
  color: "var(--color-text-tertiary)",
  fontFamily: "var(--font-mono, monospace)",
  alignSelf: "center",
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
