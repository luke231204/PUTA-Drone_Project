# 🎨 UI/UX Design System Template — Sage & Forest Theme

This template contains a reusable design system, visual guidelines, and component specifications suitable for clean, modern web or desktop applications. It features a premium, paper-like minimalism built with pure HTML & CSS, inspired by macOS/Apple aesthetics and custom sage/forest green Figma palettes.

---

## 🎨 Color Palette & CSS Variables

Place this system of CSS Custom Properties in your main stylesheet (e.g., `index.css` or `styles.css`) under the `:root` pseudo-class:

```css
:root {
  /* ---- Core Surfaces ---- */
  --bg-app:        #f5f6f4;   /* Soft warm sage off-white */
  --bg-sidebar:    rgba(255, 255, 255, 0.85); /* Frosted glass */
  --bg-card:       #ffffff;   /* Pure white */
  --bg-input:      #ffffff;
  --bg-hover:      #dfe6dc;   /* Light sage hover */
  --bg-selected:   #e8eee5;   /* Selection sage tint */

  /* ---- Text Tones ---- */
  --text-primary:   #2a2334;   /* Deep plum brand text (high contrast) */
  --text-secondary: #464255;   /* Slate/Grey-body text */
  --text-tertiary:  #738b68;   /* Cool sage green text */
  --text-quaternary:#a3a3a3;   /* Light gray placeholder/disabled */

  /* ---- Borders ---- */
  --border:        rgba(74, 93, 62, 0.12);  /* Fine sage border */
  --border-strong: rgba(74, 93, 62, 0.22);
  --border-focus:  #4a5d3e;                 /* Focus brand accent */

  /* ---- Brand & Accent Colors ---- */
  --blue:          #4a5d3e;   /* Primary Sage Accent */
  --blue-light:    #e8eee5;   /* Accent selection background */
  --blue-dark:     #2c3b26;   /* Active state/Hover accent */
  
  /* ---- Status Highlights ---- */
  --green:         #22c55e;   /* Success / Completed state */
  --green-light:   #98f7bb;
  --orange:        #f3ab3f;   /* Warning / In-progress state */
  --orange-light:  #fdf4e7;
  --red:           #cb5044;   /* Danger / Not-started state */
  --red-light:     #ffa8a7;
  --purple:        #9f29e8;   /* Tertiary Info Accent */
  
  /* ---- Apple System Greys ---- */
  --gray:          #8e8e93;
  --gray-2:        #aeaeb2;
  --gray-3:        #c7c7cc;
  --gray-4:        #d1d1d6;
  --gray-5:        #e5e5ea;
  --gray-6:        #f2f2f7;

  /* ---- Typography ---- */
  --font:          'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* ---- Geometry & Corners ---- */
  --radius-xs:     6px;
  --radius-sm:     10px;
  --radius-md:     14px;
  --radius-lg:     20px;
  --radius-xl:     24px;
  --radius-pill:   999px;

  /* ---- macOS style Soft Shadows ---- */
  --shadow-xs:     0 1px 2px rgba(0,0,0,0.02);
  --shadow-sm:     0 2px 8px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.02);
  --shadow-md:     0 4px 16px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.02);
  --shadow-lg:     0 8px 32px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.03);
  --shadow-focus:  0 0 0 3px rgba(74, 93, 62, 0.25);

  /* ---- Easing & Animations ---- */
  --ease:          cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1); /* Bouncy Apple feel */
  --t-fast:        0.12s;
  --t-normal:      0.22s;
  --t-slow:        0.35s;
}
```

---

## ✍️ Typography Guidelines

Use **Inter** or standard system sans-serif headers. Keep weights semibold or bold for headers, and regular/medium for body texts:

| Element | Font Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| `h1` | `32px` | `700` (Bold) | `1.2` | Hero pages and main welcome titles |
| `h2` | `24px` | `600` (Semibold) | `1.3` | Page Headers |
| `h3` | `18px` | `600` (Semibold) | `1.4` | Modal/Card Headings |
| `body` / `p` | `14px` | `400` (Regular) | `1.5` | Standard readable paragraph text |
| `.subtitle` | `13px` | `400` | `1.5` | Supporting descriptions under headers |
| `small` / `.badge` | `12px` | `500` (Medium) | `1.0` | Meta fields, status pills, indicators |

---

## 📐 Page Geometry & App Shell Layout

The layouts consist of two primary windows:
1. **Vertical Navigation Sidebar**: Fixed width (`240px`), frosted glass background (`backdrop-filter: blur(24px)`), right border hidden, separated from content by a soft right shadow.
2. **Main Canvas Area**: Flexible scrollable window (`padding: 36px 40px`, background: `var(--bg-app)`).

### Active Sidebar Button Indicator
When a navigation button is active (class `.active`), style it with:
- Background: `var(--blue-light)`
- Text color: `var(--blue)`
- Left border: **Vertical 4px Sage Green bar** (`border-left: 4px solid var(--blue)`) positioned on the left edge of the button to ground the selection.

---

## 🧱 Component Styling Specifications

### 1. Cards (`.card`, `.material-card`, `.stat-card`)
A paper-flat modern appearance using subtle borders instead of heavy shadows:
- Background: `var(--bg-card)`
- Border: `1px solid var(--border)`
- Border Radius: `var(--radius-md)`
- Shadow: `var(--shadow-sm)`
- **Hover Lift transition**: Lifts slightly on hover with a spring curve:
  ```css
  .card-item {
    transition: transform var(--t-normal) var(--ease-spring), box-shadow var(--t-normal) var(--ease);
  }
  .card-item:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
    border-color: var(--border-strong);
  }
  ```

### 2. Buttons
- **Primary Button (`.btn-primary`)**:
  - Background: `var(--blue)` (`#4a5d3e`)
  - Text Color: `#ffffff`
  - Border-Radius: `var(--radius-sm)`
  - Hover State: `var(--blue-dark)` (`#2c3b26`)
- **Secondary Button (`.btn-secondary`)**:
  - Background: `var(--bg-card)`
  - Text Color: `var(--text-secondary)`
  - Border: `1px solid var(--border)`
  - Hover State: `var(--bg-hover)`

### 3. Focus Rings & Form Inputs
- Background: `var(--bg-input)`
- Border: `1px solid var(--border)`
- Border-Radius: `var(--radius-sm)`
- **Focus State**: Uses the Sage Green focus token and a glowing outline ring:
  ```css
  input:focus {
    border-color: var(--border-focus);
    box-shadow: var(--shadow-focus);
    outline: none;
  }
  ```

### 4. Overlays & Modals
- Overlay backdrop: semi-transparent slate grey (`rgba(42, 35, 52, 0.35)`) combined with a blur filter (`backdrop-filter: blur(8px)`).
- Modal box: Centered white card, `20px` corners, and a smooth scale-up entry animation using `var(--ease-spring)`.

---

## 🚀 Timing & Micro-Animations

### Timed Reveal Cascades (e.g., Landing Hero)
Create an organic layout reveal by staggering element entries:
1.  **Logo Wordmark**: Slides down from the top immediately (`transition-delay: 0s`).
2.  **Headline**: Glides up with a `0.2s` delay.
3.  **Meta/Streak Widget**: Reveals with a `0.3s` delay.
4.  **Content/Quotes Box**: Renders with a `0.4s` delay.
5.  **CTA Button**: Appears at the bottom with a `0.5s` delay.

---

## 📊 Analytics: Circular Radial Progress Widget

Replace linear graphs with a circular gauge that draws dynamically via SVG path stroke offsets:

```html
<div class="radial-gauge-wrapper">
  <svg viewBox="0 0 160 160" class="radial-svg">
    <circle class="radial-bg" cx="80" cy="80" r="70" fill="none" stroke-width="16"></circle>
    <circle class="radial-fill" id="radial-fill-bar" cx="80" cy="80" r="70" fill="none" stroke-width="16" stroke-dasharray="440" stroke-dashoffset="440" stroke-linecap="round"></circle>
  </svg>
  <div class="radial-text">
    <span class="radial-percent" id="radial-percent-val">0%</span>
    <span class="radial-label">Average</span>
  </div>
</div>
```

### JavaScript Engine Math
Update the stroke offset programmatically based on the percentage (0 - 100):
```javascript
function updateRadialProgress(percentage) {
  const circle = document.getElementById('radial-fill-bar');
  const valueLabel = document.getElementById('radial-percent-val');
  
  if (!circle || !valueLabel) return;
  
  // Circumference = 2 * PI * Radius (70) ~ 440px
  const circumference = 440;
  const offset = circumference - (circumference * percentage / 100);
  
  circle.style.strokeDashoffset = offset;
  valueLabel.innerText = `${Math.round(percentage)}%`;
}
```
