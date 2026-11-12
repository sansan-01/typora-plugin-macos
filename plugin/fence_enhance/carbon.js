const DEFAULT_FONT_FAMILY = "Menlo, Consolas, monospace"
const FONT_SIZE = 15
const LINE_HEIGHT = 24
const MARGIN = 32
const INSET = 24
const HEADER = 46
const SCALE = 2
const WINDOW_COLORS = ["#ff5f57", "#ffbd2e", "#28c840"]
const COLORS = {
  comment: "#94a3b8",
  string: "#a7f3d0",
  keyword: "#d8b4fe",
  atom: "#f9a8d4",
  number: "#fdba74",
  def: "#93c5fd",
  property: "#93c5fd",
  operator: "#cbd5e1",
  tag: "#f9a8d4",
  attribute: "#93c5fd",
}
const TOKEN_ALIASES = { def: "definition", atom: "number", builtin: "variable", qualifier: "attribute" }

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function expandTabs(text, column, size) {
  let value = ""
  for (const character of text) {
    const width = character === "\t" ? size - column % size : 1
    value += character === "\t" ? " ".repeat(width) : character
    column += width
  }
  return { text: value, column }
}

function escapeSvgText(text) {
  return text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "\uFFFD")
    .replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char])
}

function renderSvg({ width, height, rows, language, fontFamily, background, foreground }) {
  const dots = WINDOW_COLORS.map((color, i) =>
    `<circle cx="${MARGIN + 22 + i * 16}" cy="${MARGIN + 22}" r="4.5" fill="${color}"/>`).join("")
  const text = rows.map((row, index) => {
    let x = MARGIN + INSET
    const y = MARGIN + HEADER + INSET + index * LINE_HEIGHT + LINE_HEIGHT / 2
    return row.map(token => {
      const part = `<text x="${x}" y="${y}" fill="${token.color}">${escapeSvgText(token.text)}</text>`
      x += token.width
      return part
    }).join("")
  }).join("\n")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="background" x2="100%" y2="100%">
      <stop stop-color="#a5b4fc"/><stop offset="1" stop-color="#e9d5ff"/>
    </linearGradient>
    <filter id="shadow" x="-15%" y="-30%" width="130%" height="160%">
      <feDropShadow dx="0" dy="9" stdDeviation="10" flood-color="#0f172a" flood-opacity=".36"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#background)"/>
  <rect x="${MARGIN}" y="${MARGIN}" width="${width - MARGIN * 2}" height="${height - MARGIN * 2}" rx="14" fill="${background}" filter="url(#shadow)"/>
  ${dots}
  <g font-family="${escapeSvgText(fontFamily).replace(/"/g, "&quot;")}" font-size="${FONT_SIZE}" dominant-baseline="central" xml:space="preserve">
    <text x="${width - MARGIN - INSET}" y="${MARGIN + 22}" text-anchor="end" fill="${foreground}" opacity=".8">${escapeSvgText(language)}</text>
    ${text}
  </g>
</svg>`
}

function renderCarbon(code, language, cm, format, { theme, font } = {}) {
  const lines = code.split(/\r\n|\r|\n/)
  if (lines.length > 150) return null
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const fontFamily = typeof font === "string" && font ? `${JSON.stringify(font)}, ${DEFAULT_FONT_FAMILY}` : DEFAULT_FONT_FAMILY
  const fontCss = `${FONT_SIZE}px ${fontFamily}`
  const colors = theme?.highlights || COLORS
  const background = colors.background || "#182132"
  const foreground = colors.text || "#e2e8f0"
  ctx.font = fontCss

  const tabSize = Math.max(1, Math.min(16, Number(cm?.getOption?.("tabSize")) || 4))
  const rows = lines.map((line, index) => {
    const tokens = cm?.getLineTokens?.(index)
    const parts = tokens?.map(token => token.string).join("") === line
      ? tokens : [{ string: line, type: null }]
    let column = 0
    return parts.map(token => {
      const expanded = expandTabs(token.string, column, tabSize)
      column = expanded.column
      const type = token.type?.split(" ").map(name => theme ? TOKEN_ALIASES[name] || name : name)
        .find(name => Object.hasOwn(colors, name))
      return { text: expanded.text, width: ctx.measureText(expanded.text).width, color: colors[type] || foreground }
    })
  })
  const widest = Math.max(220, ...rows.map(row => row.reduce((width, token) => width + token.width, 0)))
  const width = Math.ceil(widest) + (MARGIN + INSET) * 2
  const height = (MARGIN + INSET) * 2 + HEADER + rows.length * LINE_HEIGHT
  const languageLabel = Array.from(language).slice(0, 24).join("")
  if (format === "svg") return renderSvg({ width, height, rows, language: languageLabel, fontFamily, background, foreground })
  if (width * SCALE > 8192 || height * SCALE > 8192 || width * height * SCALE ** 2 > 16_000_000) return null

  canvas.width = width * SCALE
  canvas.height = height * SCALE
  ctx.scale(SCALE, SCALE)
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, "#a5b4fc")
  gradient.addColorStop(1, "#e9d5ff")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.shadowColor = "rgba(15, 23, 42, .36)"
  ctx.shadowBlur = 20
  ctx.shadowOffsetY = 9
  ctx.fillStyle = background
  roundedRect(ctx, MARGIN, MARGIN, width - MARGIN * 2, height - MARGIN * 2, 14)
  ctx.fill()
  ctx.shadowColor = "transparent"
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  WINDOW_COLORS.forEach((color, index) => {
    ctx.beginPath()
    ctx.fillStyle = color
    ctx.arc(MARGIN + 22 + index * 16, MARGIN + 22, 4.5, 0, 2 * Math.PI)
    ctx.fill()
  })
  ctx.font = fontCss
  ctx.textBaseline = "middle"
  ctx.textAlign = "right"
  ctx.fillStyle = foreground
  ctx.globalAlpha = .8
  ctx.fillText(languageLabel, width - MARGIN - INSET, MARGIN + 22)
  ctx.globalAlpha = 1
  ctx.textAlign = "left"
  rows.forEach((row, index) => {
    let x = MARGIN + INSET
    const y = MARGIN + HEADER + INSET + index * LINE_HEIGHT + LINE_HEIGHT / 2
    for (const token of row) {
      ctx.fillStyle = token.color
      ctx.fillText(token.text, x, y)
      x += token.width
    }
  })
  const data = canvas.toDataURL("image/png")
  return data.startsWith("data:image/png;base64,") ? data.split(",", 2)[1] : null
}

module.exports = renderCarbon
