// Re-export the shared validator from @workspace/email-validation so
// existing imports (sourcing, engine, etc.) keep working while the backfill
// script in `scripts/` can also reuse the same logic.
export {
  validateEmail,
  type EmailValidationResult,
  type EmailValidationStatus,
} from "@workspace/email-validation";
