# Multiview Accuracy And Skill Truth Implementation Plan

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Make Nomi's multiview workflow preserve the source scene, request each exact camera independently when accuracy is selected, and expose honest evidence for every built-in creative Skill.

**Architecture:** Keep `CapabilityRecipe` as the shared manual/Agent contract. Add an adaptive Grid9 execution policy with a nine-request accuracy mode and a one-request draft mode, then evaluate requested camera and background policy through explicit visual-review fields instead of inferring success from labels. Treat structurally compatible generic models as experimental unless the archetype explicitly declares the recipe as native.

**Tech Stack:** React, TypeScript, Vitest, Electron, the existing generation controller, image pixel inspection, and multimodal text-model review.

---

### Task 1: Freeze The Grid9 Execution Contract

**Files:**
- Modify: `src/config/capabilityRecipes/index.ts`
- Modify: `src/config/capabilityRecipes/capabilityRecipes.test.ts`
- Modify: `src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx`

1. Add failing tests for independent and contact-sheet request counts.
2. Add `viewGenerationMode` and `backgroundPolicy` controls.
3. Make independent mode the default for new runs.
4. Use one paid task only when the user explicitly selects contact-sheet draft mode.
5. Verify the spend dialog and persisted plan report the same task count.

### Task 2: Preserve Scene And Request One Exact Camera

**Files:**
- Modify: `src/workbench/generationCanvas/runner/capabilityRecipePrompt.ts`
- Modify: `src/workbench/generationCanvas/runner/capabilityRecipePrompt.test.ts`

1. Add a failing prompt test for one-frame Grid9 tasks.
2. Compile a single requested azimuth/elevation into each independent task.
3. For `preserve_scene`, forbid white, transparent, studio, or turntable replacement backgrounds.
4. Keep the old 3x3 contact-sheet prompt only for explicit draft mode and legacy one-task plans.
5. Raise the top-view elevation from the incorrect 30 degrees to 75 degrees.

### Task 3: Detect Background Replacement Locally

**Files:**
- Modify: `src/workbench/generationCanvas/runner/capabilityRecipePostprocess.ts`
- Create: `src/workbench/generationCanvas/quality/multiviewBackgroundQuality.ts`
- Create: `src/workbench/generationCanvas/quality/multiviewBackgroundQuality.test.ts`
- Modify: `src/workbench/generationCanvas/runner/capabilityRecipeQuality.ts`
- Modify: `src/workbench/generationCanvas/quality/customViewQuality.ts`

1. Add failing tests for a dark scene replaced by a white border/background.
2. Record border white ratio and border color in image inspection.
3. Add a conservative background-preservation proxy.
4. Fail obvious white-background replacement and warn on large unexplained border drift.
5. State that this proxy cannot prove unseen 3D scene geometry.

### Task 4: Verify Actual Camera And Background Semantically

**Files:**
- Modify: `src/workbench/generationCanvas/quality/multiviewSubjectQuality.ts`
- Modify: `src/workbench/generationCanvas/quality/multiviewSubjectVisionReview.ts`
- Modify: `src/workbench/generationCanvas/quality/multiviewSubjectVisionReview.test.ts`
- Modify: `src/workbench/generationCanvas/quality/multiviewSubjectVisionReviewService.ts`

1. Add failing structured-output tests for `cameraMatches` and `backgroundCompliant`.
2. Ask the vision model to judge the requested camera, not merely image diversity.
3. Ask it to judge the selected background policy.
4. Fail closed when either conclusion is missing.
5. Merge all four semantic checks without replacing local checks.

### Task 5: Expose Honest Skill Capability Levels

**Files:**
- Modify: `src/config/capabilityRecipes/index.ts`
- Modify: `src/workbench/generationCanvas/components/CapabilityRecipeInspector.tsx`
- Create: `docs/audit/2026-07-18-creative-skill-truth-matrix.md`

1. Change structural fallback from `compatible` to `experimental`.
2. Keep `native` only for explicit archetype declarations.
3. Show a compact warning when a selected model is running a prompt-guided experimental recipe.
4. Audit every built-in creative Skill from UI card through controller, transport, postprocess, and quality evidence.
5. Classify each as native, prompt-guided experimental, deterministic local, or blocked.

### Task 6: Verify And Reopen The Source App

**Files:**
- Modify: `docs/audit/2026-07-16-ai-capability-slice-creative-recipes.md`

1. Run focused red-green tests.
2. Run TypeScript and renderer builds.
3. Reopen the current source Nomi build.
4. Use the Gate 8 project for UI verification without modifying daily projects.
5. Keep real provider generation behind the existing spend confirmation.
