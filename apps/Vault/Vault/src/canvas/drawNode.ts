import { kindColor } from "../nodeUtils";

export function resolveNodeColor(node: any, tagColors: Record<string, string>): string {
  for (const tag of (node.tags ?? [])) {
    if (tagColors[tag]) return tagColors[tag];
  }
  return kindColor(node.kind);
}

function drawShape(ctx: CanvasRenderingContext2D, kindType: string | undefined, x: number, y: number, r: number) {
  ctx.beginPath();
  switch (kindType) {
    case "Note":
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      break;
    case "Folder":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.9, y + r * 0.8);
      ctx.lineTo(x - r * 0.9, y + r * 0.8);
      ctx.closePath();
      break;
    case "Database":
      ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case "CodeFile":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case "Table":
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        i === 0
          ? ctx.moveTo(x + r * Math.cos(angle), y + r * Math.sin(angle))
          : ctx.lineTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
      }
      ctx.closePath();
      break;
    case "Workbook":
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
        i === 0
          ? ctx.moveTo(x + r * Math.cos(angle), y + r * Math.sin(angle))
          : ctx.lineTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
      }
      ctx.closePath();
      break;
    default:
      ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

export function drawNode(
  node: any,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  tagColors: Record<string, string>,
  isSelected: boolean,
  isLinkSource: boolean,
  inLinkMode: boolean,
  fontScale: number = 1.0,
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = 5;
  const baseColor = resolveNodeColor(node, tagColors);
  const color = isLinkSource ? "#374151"
    : inLinkMode && !isSelected ? baseColor + "55"
    : baseColor;

  // Outer glow halo for selected
  if (isSelected) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fillStyle = color;
    drawShape(ctx, node.kind?.type, x, y, r + 5);
    ctx.fill();
    ctx.restore();
  }

  // Node body with colored drop shadow
  ctx.save();
  ctx.shadowColor = isSelected ? color : baseColor + "55";
  ctx.shadowBlur = isSelected ? 14 : 7;
  ctx.shadowOffsetY = isSelected ? 0 : 1.5;

  drawShape(ctx, node.kind?.type, x, y, r);

  // White ring
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // Label — fade in with zoom, always a hint visible
  const labelAlpha = Math.min(1, Math.max(0.2, (globalScale - 0.4) / 0.8));
  if (labelAlpha <= 0) return;

  const fontSize = Math.max(4.5, 6.5 / globalScale) * fontScale;
  ctx.save();
  ctx.globalAlpha = labelAlpha;
  ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const label = node.name.length > 24 ? node.name.slice(0, 22) + "…" : node.name;
  const textWidth = ctx.measureText(label).width;
  const textX = x;
  const textY = y + r + 3.5;
  const padX = 2.5;
  const padY = 1;

  // Semi-transparent pill backdrop
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  roundRect(ctx, textX - textWidth / 2 - padX, textY - padY, textWidth + padX * 2, fontSize + padY * 2, 2);
  ctx.fill();

  ctx.fillStyle = isSelected ? "#374151" : "#6b7280";
  ctx.fillText(label, textX, textY);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
