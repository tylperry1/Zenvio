// Approximate on-screen colors for supplier color names (previews only).
const named: Record<string, string> = {
  white: "#ffffff", black: "#111318", navy: "#1d2a4d", "navy blue": "#1d2a4d", "dark heather": "#4a4d55", "heather grey": "#b9bcc2",
  "sport grey": "#a7aab0", grey: "#9ca0a6", gray: "#9ca0a6", charcoal: "#3b3e45", red: "#c62f2f", maroon: "#6b1f2a", royal: "#2251c6",
  "royal blue": "#2251c6", blue: "#2f6fd6", "light blue": "#a9c8ec", green: "#2f8a4b", "forest green": "#244b33", "military green": "#5b6142",
  yellow: "#f2cf3d", gold: "#e3a72f", orange: "#e8762d", pink: "#f2a8c2", purple: "#5e3a8c", brown: "#6b4a33", sand: "#d9c8a7", natural: "#efe6d4",
  cream: "#f4ecd8", ivory: "#f6f1e3", silver: "#c0c4ca",
};
export function swatch(name: string) {
  const key = name.trim().toLowerCase();
  return named[key] || named[key.replace(/^(heather|solid|vintage)\s+/, "")] || "#e7eaf3";
}
/** Whether dark text or light text reads better on a swatch. */
export function onSwatch(name: string) {
  const hex = swatch(name).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#151b38" : "#ffffff";
}
