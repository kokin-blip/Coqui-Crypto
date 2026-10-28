## verdict

1. **Financial review precision — resolved.** The recaptured dark, narrow light, and high-contrast zoom consequence views show readable two-decimal USD values, bounded quantities, explicit `≈` rounding markers, and the labeled “Exact modeled amounts” disclosure. The amended component retains unmodified native strings with field labels in that disclosure, preserves `Unavailable`, and applies the same display-only formatting plus “Exact order amounts” to saved-order cost/exposure. The decimal helper uses decimal arithmetic rather than converting the financial values to JavaScript floating point.
2. **Validation recovery — resolved.** All three new validation captures visibly place the corrective USD instruction beneath the invalid negative reserve amount; dark and narrow views also show the explicit eligible-holding instruction and explained disabled modeling action. The amended component derives invalid fields from the existing schema, associates touched-field feedback through `aria-invalid`/`aria-describedby`, and describes the eligible set and required two-decimal inputs. Existing source, authority, and qualification explanations remain distinct.

## remaining

Clear. The six recaptures at the original paths and three additional validation captures are present and valid; no regression introduced by this fix batch was found. The reported 18 native checks and three display tests were not rerun by this reviewer, and no second detector pass was run. Ship covers the scored fixes, not the whole surface. Economic, owner, qualification, connected-account, and release gates remain pending; this verdict grants none of those approvals.

disposition: ship
