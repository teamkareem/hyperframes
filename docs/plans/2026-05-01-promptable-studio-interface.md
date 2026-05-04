# Promptable Studio Interface Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn Hyperframes Studio into a single promptable editing interface where a user can select time ranges, select canvas areas/objects, inspect/adjust typography/layout/timing precisely, and apply model-generated changes back to Hyperframes source files with validation.

**Architecture:** Extend the existing Hyperframes Studio rather than building a separate proprietary editor. The current app already has a preview iframe, timeline range selection, canvas element picking, a property inspector, source patching, CodeMirror source editing, and project file sync. The plan formalizes these into a unified selection model, richer inspector controls, a model edit endpoint, structured patch application, and validation/preview feedback.

**Tech Stack:** React, TypeScript, Zustand, Vite, CodeMirror, Hyperframes runtime iframe postMessage bridge, Hyperframes source patcher, Hyperframes CLI/studio API plugin, optional model provider endpoint behind a server-side edit API.

---

## 1. Product Spec

### 1.1 Product Name

**Promptable Studio** — an AI-assisted Hyperframes composition editor for precise video/canvas edits.

### 1.2 Core User Story

A creative operator opens a Hyperframes project, selects a time range on the timeline, selects one or more objects or a visible region on the canvas, types a change request, and gets a safe proposed edit applied to the underlying HTML/CSS/data attributes/GSAP source. The interface also supports manual precision controls for typography, kerning, text placement, object placement, and timing.

### 1.3 Target User

- Momentum creative operator assembling or refining campaign videos.
- Technical creative director reviewing scenes and requesting exact adjustments.
- AI agent/operator pair using Studio as the visual control surface for source patches.

### 1.4 Non-Goals for MVP

- Do not build a new editor shell outside Hyperframes Studio.
- Do not implement full Figma parity.
- Do not implement raster/video object segmentation in Phase 1.
- Do not allow unvalidated model edits to silently overwrite source.
- Do not require cloud deployment for the local development MVP.

### 1.5 Current Hyperframes Studio Foundations

Existing code already supports the following:

| Capability | Existing File | Current Behavior |
| --- | --- | --- |
| Timeline range selection | `packages/studio/src/player/components/Timeline.tsx` | Drag range, open popover |
| Prompt popover | `packages/studio/src/player/components/EditModal.tsx` | Copy prompt / copy agent prompt |
| Timeline prompt construction | `packages/studio/src/player/components/timelineEditing.ts` | Builds prompt from range + elements |
| Canvas element picker | `packages/studio/src/hooks/useElementPicker.ts` | Pick DOM element via iframe postMessage |
| Picked element model | `packages/studio/src/hooks/useElementPicker.ts` | id, selector, bbox, text, attrs, computed styles |
| Property inspector | `packages/studio/src/components/editor/PropertyPanel.tsx` | Basic layout, type, color, appearance, timing |
| Source patching | `packages/studio/src/utils/sourcePatcher.ts` | Patch inline styles, data attrs, text content |
| Timeline store | `packages/studio/src/player/store/playerStore.ts` | Elements, current time, selected timeline element |
| Preview iframe/player | `packages/studio/src/player/components/Player.tsx` | Loads `/api/projects/:id/preview` |
| NLE preview shell | `packages/studio/src/components/nle/NLEPreview.tsx` | Hosts `Player` |

---

## 2. Desired End-State UX

### 2.1 Single Interface Layout

```text
┌────────────────────────────────────────────────────────────┐
│ Top Bar: Project / Validate / Render / Model Edit Status    │
├──────────────┬───────────────────────────────┬─────────────┤
│ File/Assets  │ Canvas Preview                 │ Inspector   │
│              │ - object pick                  │ - Selection │
│              │ - region/lasso select          │ - Type      │
│              │ - selection boxes              │ - Layout    │
│              │ - before/after overlay         │ - Timing    │
│              │                               │ - Prompt    │
├──────────────┴───────────────────────────────┴─────────────┤
│ Timeline: tracks, clips, range selection, prompt marker      │
└────────────────────────────────────────────────────────────┘
```

### 2.2 Primary Flow: Prompted Range/Object Edit

1. User drags a time range on the timeline.
2. User enables Pick Mode and clicks one or more objects on the canvas.
3. Optional: user draws a rectangular region over the canvas.
4. Inspector shows selected objects, bounding boxes, timing, text, typography, and source files.
5. User types: “tighten kerning, move the headline 24px lower, keep it inside safe area, make the CTA appear 0.4s later.”
6. Studio builds an edit request containing:
   - project id
   - selected time range
   - selected element ids/selectors
   - selected region coordinates, if any
   - selected timeline elements
   - relevant source files
   - computed styles
   - current screenshot/crop, if enabled
   - user prompt
7. Server-side edit endpoint calls model and receives structured edit operations.
8. Studio previews a patch summary.
9. User applies patch.
10. Studio writes files, refreshes preview, runs `hyperframes validate` equivalent, and reports success/errors.

### 2.3 Primary Flow: Manual Precision Edit

1. User picks a text/object element on canvas.
2. Inspector exposes exact controls:
   - text content
   - x/y/w/h
   - transform translate/scale/rotate
   - font family/size/weight/style
   - letter spacing/line height/font kerning
   - color/background/shadow
   - data-start/data-duration/data-track-index
3. Editing a field updates the iframe live.
4. Changes persist to source via patcher.
5. Studio validates and shows changed file(s).

### 2.4 Selection Model Requirements

The interface must support these selection scopes:

```ts
type StudioSelection = {
  timeRange: { start: number; end: number } | null;
  timelineElementKeys: string[];
  canvasElements: PickedElement[];
  canvasRegions: CanvasRegion[];
  activeSourceFiles: string[];
};

type CanvasRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: "preview-css-px" | "composition-px";
  screenshotDataUrl?: string;
};
```

### 2.5 Prompt Context Requirements

Every model edit prompt must include:

- User instruction.
- Time range, if selected.
- Timeline elements intersecting range.
- Picked canvas elements.
- Region coordinates and screenshot/crop, when available.
- Source file snippets or full source for relevant files.
- Computed styles for selected elements.
- Hyperframes editing constraints:
  - preserve deterministic rendering
  - preserve unrelated elements/timing
  - use `data-start`, `data-duration`, `data-track-index` when possible
  - update GSAP timelines when timing is authored in JS
  - keep clips visible with `class="clip"`

---

## 3. Feature Breakdown

### 3.1 Unified Selection Store

Create a dedicated Zustand store for selection shared by timeline, canvas picker, region overlay, inspector, and prompt panel.

**New file:** `packages/studio/src/store/studioSelectionStore.ts`

Responsibilities:

- Track selected time range.
- Track selected timeline element keys.
- Track selected canvas elements.
- Track selected canvas regions.
- Track active prompt text.
- Support clear/replace/add/remove selection actions.

Acceptance criteria:

- Timeline range selection writes to this store.
- Canvas pick writes to this store.
- Inspector reads from this store.
- Existing `usePlayerStore.selectedElementId` remains supported during migration.

### 3.2 Canvas Selection Overlay

Add an overlay above/around the preview iframe that supports:

- single element pick visualization
- bounding box display
- rectangular region selection
- optional multi-select with Shift
- keyboard nudges for selected elements

**Likely files:**

- Create: `packages/studio/src/components/canvas/CanvasSelectionOverlay.tsx`
- Create: `packages/studio/src/components/canvas/canvasSelection.ts`
- Modify: `packages/studio/src/components/nle/NLEPreview.tsx`
- Modify: `packages/studio/src/App.tsx`

Acceptance criteria:

- User can drag a rectangle over the preview area.
- Region coordinates are normalized relative to preview/composition bounds.
- Region appears in inspector.
- Existing iframe interactions still work when overlay is not in selection mode.

### 3.3 Multi-Element Picker

Extend `useElementPicker` from single picked element to multi-selection.

**Modify:** `packages/studio/src/hooks/useElementPicker.ts`

Current `PickedElement` already includes:

- `id`
- `selector`
- `boundingBox`
- `textContent`
- `dataAttributes`
- `computedStyles`

Required additions:

- stable key field: `selectionKey`
- `sourceFile?: string`
- `selectorIndex?: number`
- `computedTypography?: TypographyCapture`
- support append selection with Shift

Acceptance criteria:

- Single click selects one element.
- Shift-click appends/removes selection.
- Inspector can display multiple selected elements.
- Existing single-selection property panel still works for one selected object.

### 3.4 Typography Capture

Add richer computed style capture for precise text adjustment.

**Modify:** `packages/studio/src/hooks/useElementPicker.ts`

Add computed properties:

- `line-height`
- `letter-spacing`
- `text-align`
- `font-style`
- `font-stretch`
- `font-kerning`
- `font-feature-settings`
- `font-variation-settings`
- `text-transform`
- `white-space`
- `word-spacing`
- `text-wrap`
- `text-shadow`

Create helper:

**New file:** `packages/studio/src/utils/typographyCapture.ts`

```ts
export interface TypographyCapture {
  fontFamily: string;
  resolvedFontFamily?: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  wordSpacing: string;
  fontKerning: string;
  fontFeatureSettings: string;
  fontVariationSettings: string;
  textAlign: string;
  textTransform: string;
  textShadow: string;
  textBounds: DOMRectReadOnly;
  loadedFonts: string[];
}
```

Acceptance criteria:

- Inspector shows all captured typography fields for text elements.
- Prompt context includes typography capture.
- Letter spacing and line height can be edited and persisted.

### 3.5 Enhanced Property Inspector

Upgrade `PropertyPanel` into grouped controls:

- Selection Summary
- Text Content
- Typography
- Layout
- Transform
- Appearance
- Timing
- Source
- Prompt

**Modify:** `packages/studio/src/components/editor/PropertyPanel.tsx`

New controls:

- `letter-spacing`
- `line-height`
- `word-spacing`
- `font-kerning`
- `font-feature-settings`
- `font-variation-settings`
- `text-align`
- `text-shadow`
- `transform: translateX/translateY/scale/rotate`
- `data-start`
- `data-duration`
- `data-track-index`

Acceptance criteria:

- Existing controls still work.
- New controls persist through `sourcePatcher`.
- For multiple selected elements, shared controls can apply to all selected elements.
- Timing edits update both source and timeline store.

### 3.6 Source Patcher Expansion

The current source patcher handles inline styles, data attrs, and text for id-based targets. Expand it to support selector/index targets more safely.

**Modify:** `packages/studio/src/utils/sourcePatcher.ts`

Add operations:

```ts
type PatchOperation =
  | { type: "inline-style"; property: string; value: string }
  | { type: "attribute"; property: string; value: string }
  | { type: "text-content"; property: "textContent"; value: string }
  | { type: "replace-range"; start: number; end: number; value: string }
  | { type: "batch"; operations: PatchOperation[] };
```

Acceptance criteria:

- Can patch id target.
- Can patch selector target.
- Can patch selector + occurrence index.
- Can apply batched operations atomically per file.
- Unit tests cover style, typography, data attrs, text, and selector-index cases.

### 3.7 Prompt Edit Panel

Replace the current copy-only prompt popover with an Apply/Preview model edit flow.

**Modify:** `packages/studio/src/player/components/EditModal.tsx`

New UI states:

- Compose
- Sending
- Proposed Patch
- Applying
- Validating
- Success
- Error

Actions:

- Copy Prompt
- Preview Patch
- Apply Patch
- Revert Last Patch

Acceptance criteria:

- Existing Copy Prompt behavior remains.
- Preview Patch calls a local API endpoint.
- Proposed operations are displayed before apply.
- Apply writes files through existing project sync path.

### 3.8 Model Edit API

Add a server-side API for model edits. This should be provider-agnostic so local/hosted model routing can change later.

**Likely file location:** under the Studio Vite/API plugin currently serving project endpoints. Confirm exact API plugin file before implementation.

Endpoint:

```http
POST /api/projects/:projectId/agent/edit
```

Request:

```ts
interface AgentEditRequest {
  projectId: string;
  prompt: string;
  selection: StudioSelection;
  files: Record<string, string>;
  computedStyles: Record<string, Record<string, string>>;
  screenshots?: Array<{
    regionId: string;
    dataUrl: string;
  }>;
  mode: "preview" | "apply";
}
```

Response:

```ts
interface AgentEditResponse {
  summary: string;
  warnings: string[];
  operations: Array<{
    filePath: string;
    type: "inline-style" | "attribute" | "text-content" | "replace-range";
    target?: PatchTarget;
    property?: string;
    value?: string;
    start?: number;
    end?: number;
  }>;
  unifiedDiff?: string;
  validation?: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
}
```

Acceptance criteria:

- Endpoint can run in mock mode without a model key.
- Endpoint validates request shape.
- Endpoint returns structured operations, not freeform code only.
- Endpoint never writes files directly in preview mode.

### 3.9 Prompt Builder

Make prompt context deterministic and testable.

**Modify:** `packages/studio/src/player/components/timelineEditing.ts`

**Or create:** `packages/studio/src/utils/agentPromptBuilder.ts`

Include:

- selected range
- selected timeline elements
- selected canvas elements
- selected region details
- relevant files
- computed style snapshot
- Hyperframes constraints
- exact JSON response schema

Acceptance criteria:

- Unit tests snapshot prompt output for common selections.
- Prompt includes typography and layout fields.
- Prompt includes source file paths.
- Prompt forbids unrelated changes.

### 3.10 Validation and Safety Loop

After any model patch:

1. Apply patch to in-memory files.
2. Run source-level tests/validation where possible.
3. Refresh preview.
4. Surface validation errors.
5. Allow revert.

Acceptance criteria:

- Failed validation does not silently replace known-good state.
- User can inspect changed files/diff before apply.
- Validation errors include file path and message.

---

## 4. Implementation Plan

### Phase 0 — Discovery and Guardrails

#### Task 0.1: Confirm Studio API plugin file layout

**Objective:** Identify where `/api/projects/:id/...` routes are implemented.

**Files:**
- Inspect: `packages/studio/src/**/*`
- Inspect: `packages/cli/src/commands/preview.ts`
- Inspect: Vite config/plugin files under `packages/studio`

**Steps:**
1. Search for `/api/projects` route handlers.
2. Document exact server file(s) in this plan if different from expected.
3. Add no code.

**Verification:**

```bash
cd /Users/klaus/projects/hyperframes
search_files equivalent: /api/projects under packages/studio packages/cli
```

#### Task 0.2: Create feature branch

**Objective:** Keep work isolated.

**Command:**

```bash
git checkout -b feat/promptable-studio-interface
```

**Verification:**

```bash
git status --short --branch
```

Expected branch: `feat/promptable-studio-interface`.

---

### Phase 1 — Manual Inspector + Selection Foundation

#### Task 1.1: Create Studio selection store

**Objective:** Add a dedicated shared selection state.

**Files:**
- Create: `packages/studio/src/store/studioSelectionStore.ts`
- Create: `packages/studio/src/store/studioSelectionStore.test.ts`

**Implementation Notes:**

Add store with:

- `timeRange`
- `timelineElementKeys`
- `canvasElements`
- `canvasRegions`
- `prompt`
- `setTimeRange`
- `clearTimeRange`
- `setTimelineElementKeys`
- `addCanvasElement`
- `removeCanvasElement`
- `setCanvasElements`
- `addCanvasRegion`
- `clearSelection`

**Verification:**

```bash
bun test packages/studio/src/store/studioSelectionStore.test.ts
```

#### Task 1.2: Wire timeline range selection into selection store

**Objective:** Persist range selection beyond the local Timeline component.

**Files:**
- Modify: `packages/studio/src/player/components/Timeline.tsx`
- Modify tests if needed: `packages/studio/src/player/components/Timeline.test.ts`

**Implementation Notes:**

- When `rangeSelection` becomes meaningful, call `useStudioSelectionStore.getState().setTimeRange(...)`.
- When range clears, clear store range.
- Keep current popover behavior intact.

**Verification:**

```bash
bun test packages/studio/src/player/components/Timeline.test.ts
```

#### Task 1.3: Expand computed typography capture

**Objective:** Capture typography details needed for font/kerning/text adjustment.

**Files:**
- Create: `packages/studio/src/utils/typographyCapture.ts`
- Create: `packages/studio/src/utils/typographyCapture.test.ts`
- Modify: `packages/studio/src/hooks/useElementPicker.ts`

**Implementation Notes:**

- Extract computed style reading into reusable utility.
- Include document font list from `document.fonts` when available.
- Keep fallback behavior if FontFaceSet is unavailable.

**Verification:**

```bash
bun test packages/studio/src/utils/typographyCapture.test.ts
bun test packages/studio/src/hooks/useElementPicker.test.ts  # if present; otherwise add targeted test if hook is already testable
```

#### Task 1.4: Add typography controls to PropertyPanel

**Objective:** Expose manual controls for typography precision.

**Files:**
- Modify: `packages/studio/src/components/editor/PropertyPanel.tsx`

**Controls to add:**

- Line height → `line-height`
- Letter spacing → `letter-spacing`
- Word spacing → `word-spacing`
- Kerning → `font-kerning`
- Feature settings → `font-feature-settings`
- Variation settings → `font-variation-settings`
- Text align → `text-align`
- Text shadow → `text-shadow`

**Verification:**

```bash
bunx oxlint packages/studio/src/components/editor/PropertyPanel.tsx
bunx oxfmt --check packages/studio/src/components/editor/PropertyPanel.tsx
```

#### Task 1.5: Add layout/transform precision controls

**Objective:** Make object placement precise from Inspector.

**Files:**
- Modify: `packages/studio/src/components/editor/PropertyPanel.tsx`

**Controls:**

- `transform`
- optional decomposed fields for translate/scale/rotate if helper parser is added
- margins/padding if useful
- `position`
- `right`/`bottom` alongside `left`/`top`

**Verification:**

```bash
bunx oxlint packages/studio/src/components/editor/PropertyPanel.tsx
```

#### Task 1.6: Add timing controls to Inspector

**Objective:** Allow selected object timing edits from one panel.

**Files:**
- Modify: `packages/studio/src/components/editor/PropertyPanel.tsx`
- Modify: `packages/studio/src/hooks/useElementPicker.ts` if needed

**Controls:**

- Start → `data-start`
- Duration → `data-duration`
- Track → `data-track-index`

**Verification:**

- Pick a clip element.
- Change start/duration.
- Confirm source file updates.
- Confirm timeline updates after refresh.

---

### Phase 2 — Canvas Region Selection

#### Task 2.1: Create canvas region utility

**Objective:** Normalize drag coordinates and region geometry.

**Files:**
- Create: `packages/studio/src/components/canvas/canvasSelection.ts`
- Create: `packages/studio/src/components/canvas/canvasSelection.test.ts`

**Functions:**

- `normalizeRegionDrag(start, end, bounds)`
- `intersectsBoundingBox(region, box)`
- `toCompositionCoordinates(region, previewRect, compositionSize)`

**Verification:**

```bash
bun test packages/studio/src/components/canvas/canvasSelection.test.ts
```

#### Task 2.2: Build CanvasSelectionOverlay

**Objective:** Add visual overlay for region selection and selected object boxes.

**Files:**
- Create: `packages/studio/src/components/canvas/CanvasSelectionOverlay.tsx`
- Create: `packages/studio/src/components/canvas/CanvasSelectionOverlay.test.tsx` if current test setup supports React component tests

**Behavior:**

- Disabled by default.
- Region mode captures pointer down/move/up.
- Displays active drag rectangle.
- Adds region to selection store on pointer up.
- Displays picked element boxes from selection store.

**Verification:**

```bash
bunx oxlint packages/studio/src/components/canvas/CanvasSelectionOverlay.tsx
```

#### Task 2.3: Wire overlay into NLEPreview/App

**Objective:** Show overlay in the main canvas preview.

**Files:**
- Modify: `packages/studio/src/components/nle/NLEPreview.tsx`
- Modify: `packages/studio/src/App.tsx`

**Verification:**

- Start Studio.
- Enable region selection.
- Draw a region.
- Region appears in Inspector/Prompt context.

---

### Phase 3 — Prompt Context and Model Preview

#### Task 3.1: Create agent prompt builder

**Objective:** Produce deterministic prompt context and JSON schema instructions.

**Files:**
- Create: `packages/studio/src/utils/agentPromptBuilder.ts`
- Create: `packages/studio/src/utils/agentPromptBuilder.test.ts`
- Modify: `packages/studio/src/player/components/timelineEditing.ts` to delegate existing prompt construction if appropriate

**Verification:**

```bash
bun test packages/studio/src/utils/agentPromptBuilder.test.ts
```

#### Task 3.2: Define edit operation schema

**Objective:** Share request/response types between UI and API.

**Files:**
- Create: `packages/studio/src/types/agentEdit.ts`

**Types:**

- `AgentEditRequest`
- `AgentEditResponse`
- `AgentEditOperation`
- `AgentEditValidationResult`

**Verification:**

```bash
bunx oxlint packages/studio/src/types/agentEdit.ts
```

#### Task 3.3: Add model edit client

**Objective:** Call local API from Studio UI.

**Files:**
- Create: `packages/studio/src/api/agentEditClient.ts`
- Create: `packages/studio/src/api/agentEditClient.test.ts`

**Functions:**

- `previewAgentEdit(request)`
- `applyAgentEdit(request)`

**Verification:**

```bash
bun test packages/studio/src/api/agentEditClient.test.ts
```

#### Task 3.4: Upgrade EditPopover to Preview/Apply flow

**Objective:** Replace copy-only UX with live model edit flow while preserving copy buttons.

**Files:**
- Modify: `packages/studio/src/player/components/EditModal.tsx`

**UI:**

- Prompt textarea
- Scope summary
- Copy Prompt
- Copy Agent Prompt
- Preview Patch
- Patch summary/diff panel
- Apply Patch
- Error panel

**Verification:**

```bash
bunx oxlint packages/studio/src/player/components/EditModal.tsx
bunx oxfmt --check packages/studio/src/player/components/EditModal.tsx
```

---

### Phase 4 — Server Edit Endpoint and Patch Application

#### Task 4.1: Locate and extend Studio API server plugin

**Objective:** Add `/api/projects/:projectId/agent/edit` route.

**Files:**
- Modify the API plugin file discovered in Task 0.1.
- Create server utility if needed: `packages/studio/src/server/agentEdit.ts` or equivalent package-convention path.

**Behavior:**

- Validate request.
- Mock model response if no provider is configured.
- Return structured operations and diff.
- Do not write files in preview mode.

**Verification:**

```bash
curl -s -X POST http://localhost:<port>/api/projects/demo/agent/edit \
  -H 'content-type: application/json' \
  -d '{"projectId":"demo","prompt":"test","selection":{},"files":{},"computedStyles":{},"mode":"preview"}'
```

Expected: structured JSON response, not a 500.

#### Task 4.2: Expand source patcher for batched operations

**Objective:** Apply model operations safely.

**Files:**
- Modify: `packages/studio/src/utils/sourcePatcher.ts`
- Modify: `packages/studio/src/utils/sourcePatcher.test.ts`

**Verification:**

```bash
bun test packages/studio/src/utils/sourcePatcher.test.ts
```

#### Task 4.3: Add patch preview diff

**Objective:** Show user what will change.

**Files:**
- Create: `packages/studio/src/utils/diffPreview.ts`
- Create: `packages/studio/src/utils/diffPreview.test.ts`
- Modify: `packages/studio/src/player/components/EditModal.tsx`

**Verification:**

```bash
bun test packages/studio/src/utils/diffPreview.test.ts
```

#### Task 4.4: Apply patch through project file sync

**Objective:** Use existing file sync/write path rather than introducing a second persistence mechanism.

**Files:**
- Modify: `packages/studio/src/player/components/EditModal.tsx`
- Modify: `packages/studio/src/App.tsx` if file sync callbacks are owned there

**Acceptance criteria:**

- Apply updates `workspaceFiles`/project files.
- Preview refreshes.
- Errors are shown.
- Last patch can be reverted.

---

### Phase 5 — Validation, QA, and Polish

#### Task 5.1: Add post-patch validation hook

**Objective:** Validate after model patches.

**Files:**
- Modify API plugin or client validation path.

**Validation levels:**

1. Source patch schema validation.
2. Hyperframes lint/validate if available.
3. Preview reload and runtime error capture.

**Verification:**

```bash
bun run test
npx hyperframes lint
npx hyperframes validate
```

#### Task 5.2: Add visual status and revert affordances

**Objective:** Make model edits feel safe.

**Files:**
- Modify: `packages/studio/src/player/components/EditModal.tsx`
- Modify: inspector/status components as needed

**UI requirements:**

- “Patch preview ready”
- “Applied”
- “Validation failed”
- “Revert last edit”

#### Task 5.3: End-to-end manual QA on CoinWatch project

**Objective:** Validate against the current real use case.

**Project:** `/Users/klaus/projects/video-pipeline-tests/coinwatch-pipeline-test`

**Commands:**

```bash
cd /Users/klaus/projects/video-pipeline-tests/coinwatch-pipeline-test
npx hyperframes preview --port 3018
```

**Scenarios:**

- Select a timeline range and copy prompt.
- Select headline text and adjust letter spacing.
- Move a text object using x/y controls.
- Adjust duration of a selected clip.
- Draw region selection.
- Preview model edit in mock mode.
- Apply mock patch and validate source changed.

---

## 5. Model Integration Design

### 5.1 Model Edit Modes

| Mode | Description | Risk |
| --- | --- | --- |
| Copy Prompt | Current behavior; copies prompt to clipboard | Low |
| Preview Patch | Model returns operations/diff but does not apply | Medium |
| Apply Patch | User confirms and Studio writes patch | Medium-high |
| Auto Apply | Future only; apply trusted patches automatically | High |

MVP should ship Copy Prompt + Preview Patch + Apply Patch. Do not ship Auto Apply initially.

### 5.2 Structured Output Contract

The model must return JSON matching `AgentEditResponse`. Freeform code can be included in `summary`, but file changes must be structured operations or unified diff. The UI should reject invalid JSON and show the raw model response in an error panel for debugging.

### 5.3 Provider Routing

Do not hard-code a provider in UI. Server should expose one provider-agnostic function:

```ts
async function generateAgentEdit(request: AgentEditRequest): Promise<AgentEditResponse>
```

Provider configuration can later route to:

- local model
- OpenAI/Anthropic-compatible API
- Hermes-side agent process
- Momentum internal service

---

## 6. Safety and Quality Gates

### 6.1 Patch Safety Rules

- Never patch files outside the project root.
- Never patch binary assets through text patcher.
- Never apply model output without schema validation.
- Never silently overwrite source after validation failure.
- Keep a pre-apply snapshot for revert.
- Prefer minimal operations over full file replacement.

### 6.2 Hyperframes Constraints

- Preserve deterministic rendering.
- Avoid runtime network fetches in compositions.
- Preserve `class="clip"` for visible timed elements.
- Maintain valid `data-start`, `data-duration`, `data-track-index` values.
- If GSAP controls timing, update GSAP source rather than only data attrs.
- Preserve unaffected time ranges and elements.

### 6.3 Tests Required Before Merge

```bash
cd /Users/klaus/projects/hyperframes
bun run test
bun run build
bunx oxlint packages/studio/src
bunx oxfmt --check packages/studio/src
```

For edited composition projects:

```bash
npx hyperframes lint
npx hyperframes validate
```

---

## 7. Milestones

### Milestone A — Manual Designer Controls

Deliverable:

- Shared selection store.
- Timeline range persisted in store.
- Rich typography capture.
- Inspector controls for kerning/letter spacing/line height/layout/timing.

Estimated complexity: low-medium.

### Milestone B — Region Selection and Unified Scope

Deliverable:

- Canvas region overlay.
- Multi-element pick.
- Inspector shows selected range + selected elements + selected regions.

Estimated complexity: medium.

### Milestone C — Prompt-to-Patch Preview

Deliverable:

- Prompt builder.
- Edit operation schema.
- API client.
- Mock server endpoint.
- Patch preview UI.

Estimated complexity: medium-high.

### Milestone D — Apply, Validate, Revert

Deliverable:

- Server model integration.
- Safe source patch application.
- Diff preview.
- Post-apply validation.
- Revert last edit.

Estimated complexity: high.

### Milestone E — Vision-Aware Canvas Editing

Deliverable:

- Screenshot/crop capture.
- Region crop sent to model.
- DOM element/region hybrid prompt context.
- Optional segmentation/object detection integration.

Estimated complexity: high, defer until A-D work reliably.

---

## 7.1 May 4 Architecture Addendum — Timecoded + Canvas-Specific Verbal Editing

### Current-State Verdict

Hyperframes Studio already has the hard parts needed for Promptable Studio, but the state is split across local component stores:

| Requirement | Current status | Evidence | Gap |
| --- | --- | --- | --- |
| Verbal/timecoded notes | Partial | `EditPopover` + `buildTimelineAgentPrompt` build copyable prompts from timeline ranges. | Copy-only; no structured note object, preview/apply API, or persisted review thread. |
| Timeline range selection | Present | `Timeline.tsx` Shift+drag stores local `rangeSelection` and opens `EditPopover`. | Range is not shared with preview/inspector/model context. |
| Timeline clip selection | Present | `usePlayerStore.selectedElementId`; `TimelineClip` click toggles selection. | No shared selection model linking clip ↔ picked canvas element. |
| Preview/canvas selection | Present | `useElementPicker` receives `element-picked` from iframe and captures selector, bbox, text, data attrs, computed styles. | Single element only; no region selection or multi-select; selection not reconciled with timeline. |
| Manual typography/layout/timing edits | Partial | `PropertyPanel` supports font size/weight/family, x/y/w/h, color, opacity, transform, data-start/duration/track. | Missing kerning/letter-spacing/line-height/word-spacing/font-feature controls and robust selector-index patching. |
| Drag in/out timeline handles | Present for patchable clips | `Timeline.tsx` uses `resolveTimelineResize`, `onResizeElement`, `handleTimelineElementResize`; `TimelineClip` exposes start/end handles. | Needs live association updates and clearer blocked-edit path for GSAP-authored clips. |
| Drag clip move | Present for patchable clips | `resolveTimelineMove`, `onMoveElement`, `handleTimelineElementMove`. | Store sync is optimistic but not unified with canvas selection. |
| Momentum review signals | Present outside Hyperframes | Shade comments include text + timecode + coordinates; OTIO diff extracts trim/reorder/add/remove learnings; learning events include `client.feedback.received`, `model.output.revised`, `shade_review`. | No adapter maps these external comments/edits into Hyperframes Studio selection/edit operations yet. |

### Core Architecture Decision

Use a **Unified Editorial Selection + Note Context** layer inside Hyperframes Studio. Do not add a parallel editor in MomentumOS. Momentum should provide review inputs and learning events; Hyperframes should own frame-accurate UI selection, source patching, validation, and preview refresh.

```ts
interface StudioSelectionContext {
  timeRange: { start: number; end: number; fps?: number; source?: "timeline" | "shade" | "prompt" } | null;
  timelineElementKeys: string[];
  canvasElements: PickedElement[];
  canvasRegions: CanvasRegion[];
  activeSourceFiles: string[];
  activeNote?: EditorialNote;
}

interface EditorialNote {
  id: string;
  text: string;
  source: "manual" | "voice_transcript" | "shade_comment" | "agent";
  timeRange?: { start: number; end?: number; timecode?: string };
  canvasRegion?: CanvasRegion;
  targetSelectors?: Array<{ selector: string; selectorIndex?: number; domId?: string }>;
  requestedOperation?: "typography" | "layout" | "timing" | "copy" | "animation" | "unknown";
}
```

### Live Association Model

1. **Timeline → preview**
   - Clicking a timeline clip updates `StudioSelectionContext.timelineElementKeys` and `usePlayerStore.selectedElementId`.
   - Use the clip target (`domId`, `selector`, `selectorIndex`, `sourceFile`) to ask the preview iframe to highlight the matching DOM element.
   - If no DOM target exists, show a blocked/agent prompt because GSAP/source logic needs authored timing changes.

2. **Preview → timeline**
   - Picking a canvas element writes `canvasElements` and target metadata.
   - Match the picked element against `TimelineElement` by `domId`, then selector/index, then `data-start`/`data-duration` overlap.
   - Set `timelineElementKeys` and scroll/focus the timeline clip.

3. **Region → candidate clips**
   - Region selection captures preview coordinates.
   - Match region against currently visible picked/known bounding boxes.
   - If no DOM match exists, keep it as visual context for the agent edit request rather than pretending it is source-patchable.

### Natural-Language Edit Pipeline

1. User says/types a note: “from 0:03-0:05, tighten kerning on the headline and extend intro animation by 1s.”
2. Client parses lightweight scope hints locally:
   - time expressions → `timeRange`
   - operation hints → `requestedOperation`
   - selected canvas/timeline context → targets
3. Client sends a structured `AgentEditRequest` to `/api/projects/:projectId/agent/edit` in preview mode.
4. Server/model returns structured operations only:
   - style: `letter-spacing`, `font-kerning`, `line-height`, `transform`, `left/top`
   - timing: `data-start`, `data-duration`, `media-start`/`playback-start`, or GSAP source patch request
   - text: targeted text-content update
5. UI shows diff + affected files + validation warnings.
6. Apply path writes through existing `/api/projects/:id/files/:path` project sync and refreshes preview.

### MomentumOS Adapter Points

Momentum should not fork Studio UX. It should provide external editorial context through adapters:

- **Shade review adapter**: map `ShadeCommentEventData.comment.text`, `.timecode`, and `.coordinates` into `EditorialNote`.
- **OTIO/HLRL learning adapter**: map `EditDelta` actions (`trimmed`, `reordered`, `added`, `removed`, `replaced`) into prompt context and post-edit learning events.
- **Learning event adapter**: emit `client.feedback.received` / `model.output.revised` with artifact refs to Hyperframes project/file/range after edits are accepted.
- **Brand preference context**: pass typography/visual preferences as non-authoritative guidance in `AgentEditRequest.model_context`; never let it override selected scope.

### Implementation Deltas to Existing Plan

Add these explicit tasks to the execution checklist:

1. Create `studioSelectionStore` before expanding `EditPopover`.
2. Wire timeline local `rangeSelection` to the store; preserve current popover UX.
3. Extend `useElementPicker` to include `selectionKey`, `sourceFile`, `selectorIndex`, and richer typography capture.
4. Add `CanvasSelectionOverlay` for rectangular regions in `NLEPreview`.
5. Add bidirectional match helpers:
   - `matchTimelineElementToPickedElement`
   - `matchPickedElementToTimelineElement`
   - `matchCanvasRegionToElements`
6. Extend `PropertyPanel` controls for kerning/letter-spacing/line-height and timing.
7. Promote copy-only prompt popover to preview/apply model edit flow.
8. Add Momentum adapter docs/types only after core Hyperframes UX lands; do not couple Hyperframes Studio to MomentumOS services.

### Review Gates for Fork Updates and Implementation

Every implementation slice must use this gate before PR/update:

1. **Sync gate**: `git fetch --all --prune`; verify `teamkareem/hyperframes` fork branch is current with upstream/fork target before coding.
2. **Scope gate**: isolate Hyperframes framework changes in `teamkareem/hyperframes`; only reconcile into MomentumOS after fork PR is reviewed.
3. **Quality gate**: run targeted tests first, then `bun run build`, `bun run lint`, `bun run format:check`, and relevant `bun test` slices.
4. **Review gate**: run a fresh code review pass for security, source-patcher safety, schema validation, and UX regressions before push/PR.
5. **Momentum impact gate**: inspect MomentumOS adapters/consumers and document whether any follow-up integration is needed.
6. **PR evidence gate**: PR body/comment must include branch, direct repo URL, issue URL, test results, and known failures if any.

---

## 8. Risks and Decisions

### Risk: DOM selection vs raster object selection

DOM elements are easy to select and patch. Objects inside videos/images are not directly editable without segmentation or source asset editing.

**Decision:** Phase 1-4 target DOM/Hyperframes elements. Phase 5 adds vision-aware region context.

### Risk: CSS property edits may not affect animated elements

GSAP or JS timelines may override inline styles.

**Decision:** Prompt context must include animation/timeline constraints. Inspector can still patch style, but model edits must update GSAP when necessary.

### Risk: Source patcher can corrupt HTML

Regex patching has limits.

**Decision:** Expand tests and prefer id/selector-specific minimal patches. Consider AST/HTML parser later if regex patcher becomes fragile.

### Risk: Model hallucinated edits

Model may return invalid selectors or unrelated changes.

**Decision:** Require structured operation schema, target validation, diff preview, and user confirmation.

### Risk: Font capture is approximate

Browser exposes computed family but not always the actual resolved font face.

**Decision:** Capture computed styles and `document.fonts`; defer exact glyph-level font matching until needed.

---

## 9. First Implementation Slice Recommendation

Build Milestone A first. It creates immediate value without introducing model uncertainty:

1. Shared selection store.
2. Better typography capture.
3. Kerning/letter-spacing/line-height controls.
4. Precise x/y/w/h/transform controls.
5. Timing controls in the same inspector.

Then Milestone C can plug model prompting into a more reliable selection/patch foundation.

---

## 10. Open Questions

1. Should model execution happen inside Hyperframes Studio server, or should Studio call Hermes as a local agent endpoint?
2. Should prompted edits be allowed to modify multiple files at once in MVP?
3. Should model-generated patches require manual confirmation every time?
4. Do we need a visual before/after diff for video frames, or is source diff enough for MVP?
5. Should region selection initially be rectangular only, or include lasso/freeform paths?

Recommended defaults:

- Start with local Studio API server + provider abstraction.
- Allow multi-file preview but require confirmation.
- Manual confirmation for all model patches in MVP.
- Source diff first; visual before/after later.
- Rectangular region first; lasso later.

---

## 11. Execution Checklist

- [ ] Create feature branch.
- [ ] Implement selection store.
- [ ] Wire timeline range selection.
- [ ] Add typography capture utility.
- [ ] Expand property inspector typography controls.
- [ ] Expand layout/timing controls.
- [ ] Add canvas region utilities.
- [ ] Add canvas selection overlay.
- [ ] Add prompt builder.
- [ ] Add edit request/response types.
- [ ] Add API client.
- [ ] Add mock edit endpoint.
- [ ] Upgrade prompt popover to preview/apply.
- [ ] Expand source patcher.
- [ ] Add diff preview.
- [ ] Add validation/revert loop.
- [ ] QA against CoinWatch project.
- [ ] Create PR with plan link and close tracking issue.
