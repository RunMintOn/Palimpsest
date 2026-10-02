---
name: Palimpsest
description: A temporal ephemeris for ideas returning at the right moment.
colors:
  midnight-field: "#081828"
  hero-field: "#091625"
  midnight-deep: "#061321"
  observation-violet: "#6748ff"
  relation-cyan: "#39d8df"
  warm-ink: "#f2f2f2"
  muted-ink: "#8ba0ba"
  chart-rule: "#29405a"
typography:
  display:
    fontFamily: "Alike, serif"
    fontSize: "clamp(2.625rem, 5.2vw, 4.875rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Sometype Mono, ui-monospace, monospace"
    fontSize: "clamp(1rem, 1.35vw, 1.3125rem)"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Sometype Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.08em"
  display-zh:
    fontFamily: "Songti SC, STSong, Noto Serif CJK SC, serif"
    fontSize: "clamp(2.375rem, 4.5vw, 4rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body-zh:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "clamp(1rem, 1.35vw, 1.3125rem)"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  none: "0"
  orbit: "50%"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "48px"
  section: "clamp(110px, 13vw, 200px)"
components:
  button-primary:
    backgroundColor: "{colors.observation-violet}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.midnight-field}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "48px"
---

# Design System: Palimpsest

## Overview

**Creative North Star: "The Temporal Ephemeris"**

Palimpsest uses the visual language of a precise observation chart to make memory feel oriented rather than mystical. Large midnight fields create quiet. Fine rules, dated fragments, and sparse violet relationships show old writing resolving around the present thought.

The system is poetic through space and timing. It stays functional through readable source passages, exact labels, direct actions, and disciplined alignment. The world avoids both generic software cards and fantasy-space decoration.

**Key Characteristics:**
- Midnight fields with large areas of active emptiness.
- Warm serif statements paired with measured monospaced information.
- Violet marks active relationships; cyan identifies recovered source material.
- Rules and coordinates organize content without enclosing it in cards.
- Motion resolves information gently; it never funnels or pulls the eye.

## Colors

The palette behaves like an instrument used in low ambient light: dark blue fields, warm readable ink, and two rare signal colors.

### Primary
- **Observation Violet:** Marks the current thought, semantic paths, and primary actions. Its rarity gives it force.

### Secondary
- **Relation Cyan:** Identifies dates, recovered note titles, and source markers. It never competes with the primary action.

### Neutral
- **Midnight Field:** The dominant page ground outside the hero.
- **Hero Field:** The exact `#091625` first-viewport ground inherited from the approved comp.
- **Midnight Deep:** Separates major sections through tonal layering.
- **Warm Ink:** Carries headlines and essential reading text.
- **Muted Ink:** Carries supporting explanation and metadata.
- **Chart Rule:** Defines dividers, coordinate fields, and interface boundaries.

**The Signal Pair Rule.** Violet means the active present or action; cyan means material recovered from the archive. Do not swap their roles.

**The Dark Field Rule.** Dark blue owns the page. Accent colors describe state and relationship rather than filling decorative regions.

## Typography

**Display Font:** Alike (with serif fallback)  
**Body Font:** Sometype Mono (with monospaced fallback)  
**Simplified Chinese Display Font:** Songti SC (with STSong and Noto Serif CJK SC fallbacks)  
**Simplified Chinese Body Font:** PingFang SC (with common local sans-serif fallbacks)  
**Label/Mono Font:** Sometype Mono

**Character:** Alike gives English writing a humane, reflective voice. Sometype Mono makes dates, passages, controls, and system facts feel measured without turning the product into a developer tool. Simplified Chinese uses a local Songti display stack and a local sans-serif body stack to preserve literary character, legibility, fast loading, and reliable access in mainland China.

### Hierarchy
- **Display** (400, responsive 42–78px, 1.04): Major section claims with tight tracking.
- **Headline** (400, 30–50px, 1.12): First-viewport promise and interface statements.
- **Title** (400, 21–30px, 1.35): Passage titles and local section headings.
- **Body** (400, 16–21px, 1.65): Explanatory copy, held near 52–70 characters per line.
- **Label** (400, 11–13px, modest tracking): Dates, coordinates, states, and short uppercase chart labels.
- **Simplified Chinese Display** (400, responsive 38–64px, 1.15): Chinese promises and section claims, sized for natural phrase breaks.
- **Simplified Chinese Body** (400, 16–21px, 1.65): Chinese explanation, navigation, and source passages.

**The Two Registers Rule.** Serif carries meaning and reflection. Monospace carries operation, provenance, and action in English. Chinese uses Songti for reflection and system sans-serif for operation; numeric measurements can remain monospaced.

## Layout

The system uses continuous fields instead of a stack of same-size cards. Desktop sections use two- or three-column compositions separated by one-pixel rules. Content aligns to long axes and dated paths. Section spacing is intentionally large.

The first viewport follows the approved 1586:992 chart proportion. Below 900px, multi-column sections become a single reading sequence. Below 520px, the chart simplifies to two recovered passages and one current thought; secondary chart furniture disappears before the mechanism becomes illegible.

English and Simplified Chinese use separate static routes. The root route chooses a browser language on first visit. A compact `中文 / EN` control remains visible at every breakpoint, and a manual choice overrides later browser-language detection.

**The Continuous Field Rule.** Prefer alignment, rules, and whitespace over container chrome. A border exists to measure or separate, not to manufacture a card.

## Elevation & Depth

The system is flat by default. Tonal shifts between midnight surfaces establish most depth. Shadows use a downward offset and neutral black. Violet and cyan light can identify an active observation point, but they do not create ambient neon decoration.

### Shadow Vocabulary
- **Action lift** (`0 8px 20px rgba(0,0,0,.47)`): Primary action at rest.
- **Raised interface** (`0 32px 80px rgba(0,0,0,.4)`): Large product demonstration only.
- **Active point** (`0 4px 18px rgba(0,0,0,.6)`): Observation marker separation from the chart field.

**The Flat-By-Default Rule.** Rules and tonal layers establish structure. Shadows are reserved for an actionable control or one focal interface object.

## Shapes

Corners stay square on controls, panels, and interface regions. Circular geometry belongs only to coordinates, observation markers, and orbital measurement. One-pixel rules carry the chart language.

**The Earned Circle Rule.** A circle must represent a point, orbit, coordinate, or status. It is not a generic container shape.

## Components

### Buttons
- **Shape:** Square and measured (0px radius), with a one-pixel border.
- **Primary:** Observation violet field, warm ink, 48px height, and a neutral downward shadow.
- **Hover / Focus:** The violet deepens. Focus uses a two-pixel pale-violet ring outside the control.
- **Secondary:** Midnight field with a cyan-blue border and warm ink.

### Cards / Containers
- **Corner Style:** Square.
- **Background:** Tonal midnight layers.
- **Shadow Strategy:** Flat unless the container is the principal product demonstration.
- **Border:** One-pixel chart rule.
- **Internal Padding:** 16–28px, according to information density.

### Navigation
The masthead is a thin ruled strip over the page field. The official Obsidian gradient mark and serif wordmark anchor the left; do not redraw, distort, or recolor the mark. English links use small monospaced text; Chinese links use the local sans-serif stack. The language switch remains visible at every breakpoint. Mobile keeps the brand and language switch while removing secondary navigation.

### Observation Marker
A cyan crosshair identifies an old passage. A larger violet target identifies the current note. Faint dashed archive orbits connect recovered passages behind the sharper semantic relationships. Sparse measured star points, hanging axes, and ticks complete the chart field. Each marker stays paired with a date or state label and a readable passage.

### Source Passage
A source passage leads with date and title, then shows real excerpt text. It uses hierarchy and a fine rule rather than rounded card chrome.

## Do's and Don'ts

### Do:
- **Do** use large quiet fields around recovered passages.
- **Do** make the relationship between current writing and old material visible.
- **Do** preserve readable dates, source titles, and original passage text.
- **Do** simplify chart furniture on small screens before shrinking meaningful text.
- **Do** localize Chinese copy for natural phrasing instead of preserving English line breaks mechanically.
- **Do** use one orchestrated resolve motion with an exponential ease-out.

### Don't:
- **Don't** use tightening spirals, a glowing capture axis, or motion that pulls the eye into a funnel.
- **Don't** use saturated corporate-blue blocks, white editorial grids, or hard red annotation lines.
- **Don't** turn the chart into fantasy space art, star wallpaper, or mystical decoration.
- **Don't** replace continuous fields with generic rounded cards or icon tiles.
- **Don't** invent testimonials, adoption figures, or performance claims as visual proof.
