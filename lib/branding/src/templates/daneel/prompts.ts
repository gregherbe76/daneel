/**
 * Daneel template prompts — the open-source baseline.
 *
 * Re-exports the HiringAI prompt pack as the default. The HiringAI prompts
 * implement the full 3-dimension rubric (autonomy, product mindset, impact)
 * with the JSON-schema/rubric baked in, which is also the engine's reference
 * scoring contract. Commercial templates can override here.
 */

export { prompts, type Prompts } from "../hiringai/prompts";
