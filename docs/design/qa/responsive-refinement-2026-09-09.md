# Responsive refinement verification — 2026-09-09

This pass verifies the container-responsive shell, Markets composition, task-based Settings, recovery states, typography, and accessibility safeguards introduced by the six-part responsive refinement release train.

## Deterministic capture set

The production renderer capture set is stored in [`../screenshots/review-2026-09-09-responsive/`](../screenshots/review-2026-09-09-responsive/). It includes:

- the 960 × 640 minimum window;
- 1280 × 800 and 1440 × 900 standard layouts;
- a 1728 × 1117 wide workspace with the evidence inspector docked;
- true 200% captures, where the renderer reports half the CSS viewport dimensions;
- dark, light, high-contrast, compact-density, reduced-motion, Simple, and Advanced states;
- every major route, plus representative empty, disconnected, connected, attention, and evidence-detail states.

Every capture runs the same production dispatcher and migrated throwaway profile. The harness now rejects document-level horizontal overflow, visible clipped text, horizontally off-canvas focusable controls, and unnamed icon-only controls before writing an image.

## Results

- The full configured capture set completed without an integrity failure.
- At 200% scaling, the shell reports `compact`, uses the icon rail, keeps profile, authority, freshness, safety, system status, and command access on one row, and preserves a single vertical page scroll.
- At standard widths, the labeled 164px sidebar remains present and the status rail stays on one row.
- At wide width, opening the inspector reduces the route container and leaves the primary Research comparison area readable.
- Markets switches facts and supporting controls according to the route container rather than the outer window. The chart remains the dominant region.
- Settings uses vertical task categories at standard widths and a labeled category selector at compact widths.
- Empty and unavailable portfolio surfaces expose one recovery destination without substituting zero values.

## Accessibility verification

Automated coverage verifies the inspector focus trap, Escape dismissal, focus restoration, Settings roving-tab keys, DOM reading order, named icon controls, reduced-motion overrides, and focus visibility. The development renderer mounted successfully after the production build and Vite startup.

A dedicated screen-reader session was not completed in this pass. VoiceOver announcement quality for the chart canvas and complex research visualizations remains a release limitation requiring human assistive-technology review; the existing textual summaries and table/read-model alternatives remain available.
