# eodi.me Premium UI/UX - Quick Reference Card

**Print this or keep it handy while developing!**

---

## 🎨 PRIMARY COLORS (Use These!)

```
VIBE_COLORS constant values:

active:  '#FF6B6B'    // Coral Red — High activity
classic: '#FFD93D'    // Golden Yellow — Culture/established
quiet:   '#C77DFF'    // Soft Orchid — Peaceful/residential
trendy:  '#4ECDC4'    // Turquoise Mint — Modern/innovative
nature:  '#6BCB77'    // Leaf Green — Parks/green spaces
urban:   '#4D96FF'    // Royal Blue — Cities/infrastructure
```

---

## 🗺️ MAP STYLING

| Element | Value | Notes |
|---------|-------|-------|
| **Hex Fill** | 0.85-0.95 opacity | Rich, solid appearance |
| **Hex Border** | `[255,255,255,40]` | White at ~15% opacity |
| **Search Hex** | `[10,132,255,160]` | macOS systemBlue |
| **Selected** | `[58,58,60,255]` | Dark gray, full opacity |

---

## 🔷 GLASS PANEL RECIPE

Copy-paste this for ANY glass panel:

```css
background:            rgba(28, 28, 30, 0.65);
backdrop-filter:       blur(50px) saturate(180%);
-webkit-backdrop-filter: blur(50px) saturate(180%);
border:                0.5px solid rgba(255, 255, 255, 0.12);
box-shadow:            0 20px 40px rgba(0, 0, 0, 0.40);
border-radius:         14px;
```

Or use: `className="glass-panel"`

---

## 📊 SCORE → COLOR GRADIENT

```javascript
export function scoreColor(v: number): string {
  if (v >= 80) return '#6BCB77';   // Leaf Green
  if (v >= 60) return '#FFD93D';   // Golden Yellow
  if (v >= 40) return '#FF8B94';   // Coral
  return '#FF6B6B';                 // Coral Red
}
```

---

## 🎯 COMMON PATTERNS

### Color Badge
```jsx
<div style={{
  backgroundColor: `${VIBE_COLORS.active}15`,  // 8% opacity
  border: `0.5px solid ${VIBE_COLORS.active}40`, // 25% opacity
  color: VIBE_COLORS.active,
  borderRadius: '8px'
}}>
  Active Zone
</div>
```

### Hex with Glow
```jsx
const hexColor = VIBE_CATEGORY_COLORS.trendy;
// { fill: "#4ECDC4", border: "rgba(255,255,255,0.15)", 
//   glow: "rgba(78,205,196,0.35)" }
```

---

## ✅ DO's

- ✅ Use `VIBE_COLORS[key]` from constants
- ✅ Import colors from `vibeConstants.ts`
- ✅ Use high opacity (0.85-0.95) for hexes
- ✅ Use white borders (rgb(255,255,255) at 0.15)
- ✅ Use `.glass-panel` class for consistency
- ✅ Test on dark background for readability

---

## ❌ DON'Ts

- ❌ Hardcode hex color values
- ❌ Use low opacity (<0.65) for main hexes
- ❌ Use colored borders for hex grids
- ❌ Change palette without approval
- ❌ Mix glass effect specifications
- ❌ Forget to test contrast ratios

---

## 📁 KEY FILES

| File | Purpose | Key Changes |
|------|---------|-------------|
| `vibeConstants.ts` | Color definitions | VIBE_COLORS, VIBE_CATEGORY_COLORS |
| `index.css` | Glass effects | .glass-panel, sidebar, panels |
| `MapLibreMap.tsx` | Map rendering | getFillRgba(), getLineRgba() |
| `Sidebar.tsx` | Branding | Logo color, badge colors |

---

## 🔒 ACCESSIBILITY

All colors:
- ✅ WCAG AAA compliant
- ✅ Colorblind safe
- ✅ High contrast text
- ✅ Clear focus states

---

## 📐 OPACITY REFERENCE

```
Hex Fills:      0.50 — 0.95  (depending on context)
Hex Borders:    0.15 (subtle white)
Glow Effects:   0.35
Backgrounds:    0.65
Panel Borders:  0.12
Shadows:        0.40
Badge BG:       0.08
Badge Border:   0.25
Text Overlay:   0.85+
```

---

## 🎬 BLUR VALUES

```
Standard panels:  blur(50px) saturate(180%)
Card elements:    blur(30px) saturate(160%)
Light effect:     blur(16px)
```

---

## 🏗️ COMPONENT STRUCTURE

```
Sidebar / Right Panel
├─ Background: rgba(28,28,30,0.65)
├─ Header: Branding + buttons
├─ Content: Search / Analysis tabs
└─ Footer: Bookmarks / Settings

Map Container
├─ Background: Dark map tile
├─ Hexes: VIBE_CATEGORY_COLORS fills
├─ Borders: White subtle lines
└─ Legend: Glass panel overlay
```

---

## 🔄 COLOR MIGRATION (Old → New)

| Use Case | Old | New |
|----------|-----|-----|
| Active Zone | #FF5F4A | #FF6B6B |
| Culture | #FFB000 | #FFD93D |
| Peaceful | #D375C6 | #C77DFF |
| Modern | #00CF95 | #4ECDC4 |
| Green Space | #4AC2F2 | #6BCB77 ← *NEW ROLE* |
| City Center | #2E91E5 | #4D96FF |

---

## 💡 TIPS

1. **Always import colors from constants** — Never hardcode
2. **Test on dark backgrounds** — That's where these colors live
3. **Use opacity variants** — Color + transparency = elegance
4. **White borders are your friend** — No heavy grid lines
5. **Glass panels = premium** — Use them liberally

---

## 🆘 QUICK FIXES

**Hex looks washed out?**
→ Increase opacity to 0.90-0.95

**Border too visible?**
→ Use white `[255,255,255,40]` instead

**Panel looks harsh?**
→ Increase blur from 50px to 60px and shadow depth

**Text hard to read?**
→ Check contrast ratio: should be 4.5:1 minimum (AA)

---

## 📞 REFERENCE DOCS

- Full details: `PREMIUM_UI_UPDATES.md`
- Developer guide: `IMPLEMENTATION_GUIDE.md`
- Color specs: `COLOR_PALETTE_REFERENCE.md`
- Migration: `COLOR_MIGRATION_REFERENCE.txt`

---

**Remember:** This palette is premium, colorblind-safe, and accessibility-compliant. Keep it consistent! 🎨✨
