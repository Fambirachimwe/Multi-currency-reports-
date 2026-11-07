UI Context
Theme
Dark-only, desktop-first enterprise reporting workspace inspired by the supplied GAAP Unity Departmental Sales Report screenshot. The visual language is restrained and information-dense: charcoal backgrounds, subtly differentiated panels, thin neutral borders, crisp white text, and cyan-blue highlights for the active report and interactive elements. Avoid large decorative cards, gradients, heavy shadows, and excessive rounded corners. Preserve the familiar reporting workflow (filter selectors above a wide results grid), but improve spacing, legibility, accessibility, and responsive behavior. The screenshot is a visual reference, not a requirement to copy GAAP branding or navigation verbatim.

The screenshot's dominant canvas color was sampled as #363640. Other palette values below are approximate matches or deliberate supporting design choices, not claims of exact pixel matches. Use semantic CSS variables throughout; do not hardcode colors in JSX or component-level Tailwind classes.
Colors
Role	CSS Variable	Value	Notes
Page background	--bg-base	#363640	Sampled dominant screenshot background
Sidebar background	--bg-sidebar	#363640	Same charcoal field as page
Elevated surface	--bg-surface	#3E3E47	Approximate screenshot toolbar/search surface
Hover surface	--bg-hover	#484852	Interactive hover
Selected surface	--bg-selected	#414B59	Muted blue-charcoal selection
Overlay background	--bg-overlay	#303039	Dialog/popover surface
Primary text	--text-primary	#F5F5F7	Main text and report values
Secondary text	--text-secondary	#D3D3DB	Secondary labels
Muted text	--text-muted	#B0B4C3	Hints, descriptions, placeholders
Primary accent	--accent-primary	#00A9F4	Approximate bright blue from report tab
Accent hover	--accent-hover	#39BDFB	Hover/focus variant
Accent foreground	--accent-foreground	#101A24	Text on bright accent backgrounds
Border	--border-default	#50505C	Thin grid/panel dividers
Strong border	--border-strong	#656573	Focused/selected panel outline
Error	--state-error	#F87171	Validation and fetch failures
Success	--state-success	#4ADE80	Successful report generation
Warning	--state-warning	#FBBF24	Partial/uncertain data
USD currency tag	--currency-usd	#4ADE80	Optional currency identification only
ZWG currency tag	--currency-zwg	#60A5FA	Optional currency identification only


Define tokens in frontend/src/styles/globals.css (or the single established global stylesheet). Example:
:root {
  color-scheme: dark;
  --bg-base: #363640;
  --bg-sidebar: #363640;
  --bg-surface: #3e3e47;
  --bg-hover: #484852;
  --bg-selected: #414b59;
  --bg-overlay: #303039;
  --text-primary: #f5f5f7;
  --text-secondary: #d3d3db;
  --text-muted: #b0b4c3;
  --accent-primary: #00a9f4;
  --accent-hover: #39bdfb;
  --accent-foreground: #101a24;
  --border-default: #50505c;
  --border-strong: #656573;
  --state-error: #f87171;
  --state-success: #4ade80;
  --state-warning: #fbbf24;
  --currency-usd: #4ade80;
  --currency-zwg: #60a5fa;
}
Map these tokens to Tailwind semantic utilities and shadcn/ui theme variables (--background, --foreground, --card, --popover, --primary, --border, --ring, etc.). Use a single source of truth and maintain adequate contrast, especially for small table text. Currency tags are supplemental indicators; currency codes must remain visible as text. Never rely on color alone to distinguish currencies.
Typography
Role	Font	Variable
UI text	Inter, fallback Arial/sans-serif	--font-sans
Code/mono, IDs	JetBrains Mono, fallback monospace	--font-mono


- Body: text-sm (14px) by default; 13–14px may be used in dense tables, never at the expense of legibility.
- Page titles: text-lg to text-xl, font-semibold.
- Filter headings: text-sm, font-semibold.
- Table headings: text-xs or text-sm, font-medium, consistent casing.
- Numeric amounts: tabular numerals (tabular-nums), right-aligned, with consistent decimal formatting and visible currency labels.
- Avoid all-caps for long labels and avoid decorative typography.
Border Radius
Context	Class
Inline / small UI, chips, inputs	rounded-sm
Cards / panels, filter tiles	rounded-md
Modals / overlays	rounded-lg
Pills (only where meaningful)	rounded-full


Favor square or gently rounded reporting panels to reflect the reference screenshot. Use thin borders over strong box shadows.
Component Library
Use shadcn/ui on top of Tailwind CSS in React + Vite (JavaScript, not TypeScript). Shared UI primitives live in frontend/src/components/ui/; add and maintain them using the shadcn CLI where practical. Feature-specific components live under frontend/src/features/ or frontend/src/components/reports/, depending on the chosen monorepo structure.

Recommended primitives: Button, Card, Popover, Dialog, Select, Command, Checkbox, Input, Calendar, Table, Tabs, Badge, Tooltip, Skeleton, Alert, and Toast/Sonner. For large result sets, use a performant data-grid/table solution with virtualization or server-side pagination as appropriate; do not force a basic HTML table to render thousands of rows at once.

Customize shadcn theme variables to match the palette above. Avoid introducing a second, conflicting design system.
Layout Patterns
- App shell: full-height dark workspace, with a narrow top header and a collapsible left navigation sidebar. Keep reporting as the primary navigation destination rather than reproducing every GAAP menu item.
- Sidebar: approximately 240–272px expanded on desktop; compact collapsed state with icons and tooltips. Separate it from content with a subtle border. On mobile, use a drawer.
- Header: approximately 52–60px high, logo/product name at left, page context and utilities at right, thin bottom divider.
- Report title: compact, left-aligned heading with a short cyan underline or active-tab border, matching the screenshot's Departmental Sales Report cue.
- Report filters: horizontal row or responsive grid of bordered selector panels. Core selectors: department/category, product multi-select, brand/nodes, start date, end date, and optional saved report settings. Show a concise selection summary within each panel.
- Filter behavior: department selection drives product choices; brand selection narrows node choices. Clearly show active filters and provide an explicit Generate Report action. Do not automatically run expensive API requests for every checkbox change.
- Reporting toolbar: place search, currency display controls, column visibility, refresh/re-generate, and Excel download above the results grid. Download is available only for a saved, successfully generated report.
- Results grid: wide, horizontally scrollable, with a sticky header, thin cell dividers, compact rows, clear sorting, and right-aligned financial amounts. Show node, department, product, quantity, and per-currency values without combining currencies into a single amount.
- Report views: summary and detailed product reports should share the same filter context; use tabs or a segmented switch to move between them.
- Currency presentation: separate USD, ZWG, and other API-provided currencies into clearly labeled columns, groups, or tabs. Never present mixed-currency totals without an explicit conversion basis.
- Dialogs/popovers: dark overlay surfaces, subtle border, limited shadow, accessible focus management. Multi-selects should support search, Select All, and clear selection.
- Empty/loading/error states: show helpful explanations within the report content area. Use skeleton rows during loading; do not show a blank grid that looks broken.
- Responsive design: optimize for desktop financial reporting; on narrower screens, stack filters, collapse sidebar, and allow controlled horizontal scrolling of the table. Preserve access to Generate Report and Download Excel.
- Accessibility: visible keyboard focus ring in accent blue, logical tab order, labeled controls, readable contrast, and non-color-only status indicators.
Icons
Use Lucide React consistently. Prefer outline/stroke-based icons, typically size={16} for inline controls and size={20} for prominent toolbar buttons. Use strokeWidth={1.75} or the established component default consistently. Typical icons: Menu, Search, CalendarDays, ChevronDown, Filter, RefreshCw, Download, FileSpreadsheet, Columns3, Bookmark, Building2, Package, and AlertCircle.

All icon-only buttons must have accessible labels and tooltips. Use the primary accent for active or selected icons; keep neutral icons muted. Avoid mixing multiple icon libraries.
Reporting-Specific UI Rules
1. No blended currency totals: label every amount with its currency or place it under an unambiguous currency header.
2. Unknown currency is explicit: display UNKNOWN/`Unclassified` with a warning, never silently treat it as USD.
3. Report provenance is visible: display the report's generated-at timestamp and, where applicable, the date range and selected nodes/products.
4. Saved snapshot behavior: reopening a generated report reads the saved MongoDB snapshot. Excel download exports that same saved snapshot; it must not silently refresh from GAAP Unity.
5. Freshness is explicit: distinguish “View saved report” from “Generate new report” or “Refresh report.”
6. Financial values are readable: align decimals, format quantities and amounts consistently, and avoid truncating important numeric cells.
7. No authentication UI in v1: do not show login/profile/account-management controls until authentication is introduced; secure backend credentials remain server-side.
8. Branding: use the application's own name and logo unless authorized GAAP/Simbisa assets are explicitly supplied for use.