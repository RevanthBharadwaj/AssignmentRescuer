# Design

The interface follows the visual language of a modern creative studio site: dark, quiet, type led, with one bright accent. The reference was studied for its tokens and layout patterns only. No logo, mascot, imagery or copy from it is used, and the app uses its own name and wording.

## Principles

1. **Type does the work.** Big, tightly tracked headlines and generous space instead of boxes and icons.
2. **One accent.** Lime cream is used for primary actions, label chips, the active stage and display type. Orange is kept for warnings and changes that need attention.
3. **Workflow as a dock.** The four stages of the app sit in a segmented bar fixed to the bottom of the window, each with a short verb: capture it, confirm it, plan it, trace it.
4. **Calm data.** Dates and source excerpts use a monospace face; lists are ruled lines, not cards, wherever possible.

## Tokens

All tokens live at the top of `src/ui/styles.css`.

| Token | Value | Use |
|---|---|---|
| `--gray-950` | `#101114` | App background |
| `--gray-900` | `#1c1d21` | Cards |
| `--gray-800` | `#303136` | Hairlines |
| `--gray-700` | `#46484e` | Input borders, stat dividers |
| `--gray-300` | `#cacbce` | Lede and body text |
| `--gray-400` / `--gray-500` | `#a6a8ad` / `#7b7d84` | Muted and faint text |
| `--lime-50` → `--lime-300` | `#f9fef1` → `#d6f1a7` | Lime cream gradient for display type and the wordmark |
| `--lime-200` | `#e7fbc3` | Chips, primary buttons, active dock segment |
| `--lime-400` | `#bde37a` | Focus accents, olive mix base |
| `--olive` | lime-400 at 24% over gray-950 | Dock background |
| `--accent-500` | `#ff5c34` | Warnings, change markers, pending badge |
| `--radius` | `0.625rem` | Cards |
| `--radius-sm` | `4px` | Buttons and inputs |

## Type

| Role | Face | Size / weight / tracking |
|---|---|---|
| Display ("Your semester") | DM Sans Variable | clamp(56px, 9vw, 128px) / 600 / −0.045em, lime cream gradient |
| Page title (h1) | DM Sans | 34px / 600 / −0.02em |
| Section title (h2) | DM Sans | 26px / 600 / −0.015em |
| Lede | DM Sans | 26px / 400, gray-300 |
| Stats | DM Sans | up to 92px / 600 / −0.03em, lime-50 |
| Body | DM Sans | 15px / 400 |
| Dates, excerpts, clock, step numbers | JetBrains Mono Variable | 12–13px |
| Signature wordmark | Noto Serif 300 | up to 380px, lime cream gradient, cropped at the bottom of Home |

Fonts are installed from npm (`@fontsource-variable/dm-sans`, `@fontsource-variable/jetbrains-mono`, `@fontsource/noto-serif`) and bundled into the app, so nothing loads from the network.

## Components

| Component | Pattern |
|---|---|
| Top bar | Gradient wordmark left; Home and Features as small text links; local clock in mono on the right |
| Dock | Four equal segments on olive; active segment lime-200 with dark text; pending count as an orange badge on Review |
| Chip | Square lime-200 label above every page and section title, lowercase |
| Stats | Three oversized numbers separated by vertical hairlines |
| Steps | Ruled list, mono `01`–`07` numbers, question, answer right aligned |
| Buttons | Primary lime-200 with dark text; secondary outlined; text links underlined with an arrow (→) |
| Review card | Gray-900 card; orange left rule for updates and conflicts; fields as a small label grid |
| Source trace | Collapsible; excerpt in mono with a lime left rule |

## Accessibility

Text contrast on the dark background stays at WCAG AA or better for body text. Every interactive element has a visible lime focus ring. Dock buttons carry plain accessible names ("Review, 3 pending"). Motion is limited to short colour transitions and is disabled when the system asks for reduced motion.
