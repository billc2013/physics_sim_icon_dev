import systemPromptConfig from "../../shared/system_prompt.json";

// Status workflow values, in canonical display order.
export const STATUSES = ["draft", "revised", "approved", "idea_only"];

// Per-status display config: label, accent color, background, dark text.
// Keys: c = accent color, bg = background, dk = dark text on background.
export const STATUS_CONFIG = {
  draft:     { label: "Draft",     c: "#6366F1", bg: "#EEEDFE", dk: "#3C3489" },
  revised:   { label: "Revised",   c: "#D85A30", bg: "#FAECE7", dk: "#712B13" },
  approved:  { label: "Approved",  c: "#1D9E75", bg: "#E1F5EE", dk: "#085041" },
  idea_only: { label: "Idea only", c: "#BA7517", bg: "#FAEEDA", dk: "#412402" },
};

// 8 monochromatic 3-tone color ramps. Each has light/mid/dark hex + display name.
// Used for tagging an SVG with a target palette during generation.
export const COLOR_RAMPS = {
  blue:   { l: "#BFDBFE", m: "#3B82F6", d: "#1E3A8A", n: "Blue" },
  red:    { l: "#FECACA", m: "#EF4444", d: "#991B1B", n: "Red" },
  green:  { l: "#BBF7D0", m: "#22C55E", d: "#166534", n: "Green" },
  amber:  { l: "#FDE68A", m: "#F59E0B", d: "#92400E", n: "Amber" },
  purple: { l: "#DDD6FE", m: "#8B5CF6", d: "#5B21B6", n: "Purple" },
  teal:   { l: "#99F6E4", m: "#14B8A6", d: "#115E59", n: "Teal" },
  gray:   { l: "#E5E7EB", m: "#6B7280", d: "#1F2937", n: "Gray" },
  pink:   { l: "#FBCFE8", m: "#EC4899", d: "#9D174D", n: "Pink" },
};

// localStorage key for the temporary persistence bridge. Removed in Task 3
// when Supabase queries replace localStorage.
export const STORAGE_KEY = "gist-svg-v2";

// Builds the system prompt sent to Claude during generation. Includes the
// full library of existing object names so Claude can avoid duplicates.
//
// Source of truth is shared/system_prompt.json — edited in one place and
// consumed by both this file (for the SystemPrompt overlay) and by
// modal_functions/generate_svg.py (for actual Claude calls). After editing
// the JSON you must run `modal deploy modal_functions/generate_svg.py` for
// the Python side to pick up the change.
export function buildSystemPrompt(items) {
  const rules = systemPromptConfig.rules.map((r) => `- ${r}`).join("\n");
  const library = systemPromptConfig.librarySection
    .replace("{count}", items.length)
    .replace("{names}", items.map((i) => i.id).join(", "));
  return `${systemPromptConfig.header}\n${rules}\n\n${library}`;
}
