import type React from "react";

/** Returns today's date as a YYYY-MM-DD string. */
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Formats a duration in minutes as "Xh Ym" or "Ym". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Common label style used in logger forms. */
export const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-muted)",
  marginBottom: 4,
  fontWeight: 500,
};

/** Common vertical field-group style used in logger forms. */
export const FIELD_GROUP: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

/** Common surface card style. */
export const CARD_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};

/** Common submit button style for logger forms. */
export const SUBMIT_BTN_STYLE: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--accent-fg)",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  alignSelf: "flex-start",
  padding: "8px 16px",
};

/** Card with tighter bottom margin (12px) for session/entry lists. */
export const CARD_TIGHT: React.CSSProperties = {
  ...CARD_STYLE,
  padding: 20,
  marginBottom: 12,
};

/** Card with standard bottom margin (16px) for section forms. */
export const CARD_PADDED: React.CSSProperties = {
  ...CARD_STYLE,
  padding: 20,
  marginBottom: 16,
};

/** Full-width text input. */
export const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  fontSize: 14,
  boxSizing: "border-box",
};

/** Smaller input variant for compact grids. */
export const INPUT_SM: React.CSSProperties = {
  ...INPUT_STYLE,
  padding: "6px 10px",
  fontSize: 13,
};

/** Uppercase section label above an input. */
export const SECTION_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
};

/** Primary accent button (inline-flex). */
export const BTN_PRIMARY: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 16px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-sm)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

/** Ghost button with border for secondary actions. */
export const BTN_GHOST: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  background: "none",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  color: "var(--text-secondary)",
  cursor: "pointer",
};

/** Transparent icon-only button. */
export const ICON_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--text-muted)",
  padding: 4,
  display: "flex",
  alignItems: "center",
};
