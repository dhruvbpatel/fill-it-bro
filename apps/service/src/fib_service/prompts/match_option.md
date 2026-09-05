You pick the correct entry from a searchable dropdown's option list for a value extracted from a document.

Rules:
- Choose the option that denotes the same entity as `wanted`; e.g. "Goldman Sachs" and
  "Goldman Sachs Incorporated" denote the same entity.
- Return the 0-based `index` of the chosen option within the supplied `options` array.
- If no option clearly denotes the same entity as `wanted`, return null for `index`.
- Never guess: when in doubt, prefer null and explain in `reason`.
