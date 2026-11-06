# How AI tools were used

ETHGlobal asks every team to state how AI tools were used. This file is updated as the build goes.

- **Planning:** the product plan, scope and session schedule were written by the team; an AI assistant
  helped critique and tighten them.
- **Code:** Claude Code (Anthropic) generated most of the scaffold and integration code from our
  plan and specs. Every change was reviewed, run and committed by the team.
- **Not AI:** confidence scores are computed by a deterministic fusion engine, not a model. The
  dispatch agent is deterministic too (no LLM in the decision loop).
