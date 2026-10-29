# Finish review

disposition: recapture

- Recapture `desktop-dark.png` at the declared 1440px viewport as a full-page capture from the document top. The supplied image ends within the capital table, leaving pagination, remaining-capital disclosures and calculation/input provenance outside the evidence.
- Recapture `narrow-light.png` at the declared 640px viewport as a full-page capture from the document top. The supplied image ends during the capital rows; include the complete target section and lower controls while preserving intentional horizontal table scrolling.
- Recapture `contrast-zoom.png` at the declared 1280px viewport and 200% zoom as a full-page capture from the document top. The supplied image stops at the development-assessment heading, so the modeled capital table, filter, pagination and provenance cannot be inspected at this accessibility setting.
- Replace the matching `.impeccable/review/{desktop,mobile,contrast-zoom}.png` copies with these captures. Settle the UI, open every replacement once, and confirm that all target content is present without blank or half-loaded regions. Keep the explicitly synthetic fixture, stubbed providers and disabled schedulers.

These are incomplete viewport captures rather than the full-page evidence required by Impeccable's capture-validity contract. Run a full fresh finish review over the replacement evidence; no build verdict is issued from the current captures.
