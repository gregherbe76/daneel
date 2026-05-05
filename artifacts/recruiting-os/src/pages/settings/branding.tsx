import { useEffect, useRef, useState } from "react";
import {
  useGetBrandingSettings,
  useUpdateBrandingSettings,
  useRequestUploadUrl,
  getGetBrandingSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { branding as defaultBranding } from "@workspace/branding";
import { Loader2, Image as ImageIcon, Upload, Trash2 } from "lucide-react";

const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

/** Build the URL to render an object-storage path in an <img> tag. */
function logoSrc(logoUrl: string): string {
  return logoUrl.startsWith("/objects/") ? `/api/storage${logoUrl}` : logoUrl;
}

/**
 * Reusable color picker row: a native <input type="color"> swatch tied to
 * a side-by-side hex text input so users can either pick visually or paste a
 * known brand hex. Empty string means "fall back to the template default".
 */
function ColorField({
  id,
  label,
  testId,
  helper,
  value,
  onChange,
  fallback,
  onClear,
}: {
  id: string;
  label: string;
  testId: string;
  helper: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string;
  onClear: () => void;
}) {
  // Native <input type="color"> requires a 7-char "#rrggbb" value at all
  // times — fall back to the template default while the text input is empty
  // or partially typed, so the swatch never goes blank.
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const isInvalid = value !== "" && !HEX.test(value);
  const swatchValue = HEX.test(value) ? value : fallback;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
          data-testid={`${testId}-swatch`}
          value={swatchValue}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded border border-border bg-background p-1"
        />
        <Input
          id={id}
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          aria-invalid={isInvalid}
          className="font-mono uppercase"
          maxLength={7}
        />
      </div>
      {isInvalid && (
        <p
          data-testid={`${testId}-error`}
          className="text-xs text-destructive"
        >
          Enter a valid hex color like #7C5CFF.
        </p>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{helper}</span>
        {value && (
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={onClear}
          >
            Clear (use default)
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Live preview panel that renders sample UI surfaces (CTA button, sidebar
 * active chip, report cover swatch) using whatever colors the user has typed
 * — without touching the global CSS variables, so the rest of the app keeps
 * its currently-saved theme until the user clicks Save.
 */
function ColorPreview({
  primary,
  accent,
  productName,
  fallbackPrimary,
  fallbackAccent,
}: {
  primary: string;
  accent: string;
  productName: string;
  /**
   * The hex to render when `primary` is empty OR an invalid hex string —
   * typically the most recent saved color. This way typing a half-formed
   * or invalid value does NOT yank the preview back to the template
   * default and does not let the bad string bleed into the rendered swatch.
   */
  fallbackPrimary: string;
  fallbackAccent: string;
}) {
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const primaryHex = HEX.test(primary) ? primary : fallbackPrimary;
  const accentHex = HEX.test(accent) ? accent : fallbackAccent;
  return (
    <div
      className="rounded-md border border-border bg-muted/30 p-4 space-y-3"
      data-testid="color-preview"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Preview</h2>
        <span className="text-xs text-muted-foreground">
          Updates live — click Save to apply across the app.
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Primary CTA */}
        <div className="flex flex-col items-start gap-2 rounded border border-border bg-background p-3">
          <span className="text-xs text-muted-foreground">Primary CTA</span>
          <button
            type="button"
            disabled
            data-testid="preview-primary-button"
            style={{ backgroundColor: primaryHex, color: "#ffffff" }}
            className="rounded px-3 py-1.5 text-sm font-medium shadow-sm"
          >
            Create job
          </button>
        </div>

        {/* Sidebar accent chip */}
        <div className="flex flex-col items-start gap-2 rounded border border-border bg-background p-3">
          <span className="text-xs text-muted-foreground">Sidebar item</span>
          <div
            data-testid="preview-accent-chip"
            style={{ backgroundColor: accentHex, color: "#ffffff" }}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
          >
            Pipeline
          </div>
        </div>

        {/* Report cover swatch */}
        <div className="flex flex-col items-start gap-2 rounded border border-border bg-background p-3">
          <span className="text-xs text-muted-foreground">Report cover</span>
          <div
            data-testid="preview-report-cover"
            className="w-full rounded border border-border overflow-hidden"
          >
            <div
              style={{ backgroundColor: primaryHex }}
              className="h-6 w-full"
            />
            <div className="px-2 py-1.5">
              <div className="text-xs font-semibold truncate">{productName}</div>
              <div
                style={{ backgroundColor: accentHex }}
                className="mt-1 h-1 w-10 rounded"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BrandingSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetBrandingSettings();
  const update = useUpdateBrandingSettings();
  const requestUploadUrl = useRequestUploadUrl();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [productName, setProductName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [colorPrimary, setColorPrimary] = useState("");
  const [colorAccent, setColorAccent] = useState("");

  // Hydrate the form once the saved values arrive — without clobbering
  // anything the user has already typed.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!hydrated && data) {
      setProductName(data.productName ?? "");
      setCompanyName(data.companyName ?? "");
      setLogoUrl(data.logoUrl ?? "");
      // Resolved colors always come back populated (template defaults fill
      // in for nulls). To preserve "null means template default" semantics in
      // the DB, leave the input blank when the resolved value matches the
      // template default — that way an unrelated save (e.g. just productName)
      // doesn't accidentally persist the current default hex into the row.
      setColorPrimary(
        data.colorPrimary && data.colorPrimary.toLowerCase() !== defaultBranding.colors.primary.toLowerCase()
          ? data.colorPrimary
          : "",
      );
      setColorAccent(
        data.colorAccent && data.colorAccent.toLowerCase() !== defaultBranding.colors.accent.toLowerCase()
          ? data.colorAccent
          : "",
      );
      setHydrated(true);
    }
  }, [data, hydrated]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        data: {
          productName,
          companyName,
          logoUrl,
          colorPrimary,
          colorAccent,
        },
      });
      qc.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey() });
      toast({
        title: "Branding saved",
        description: "Future reports and pages will use the new branding.",
      });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  function onResetField(setter: (v: string) => void) {
    setter("");
  }

  async function onRemoveLogo() {
    // Persist a cleared logo immediately. The server deletes the previous
    // object from storage when it sees logoUrl change to null.
    try {
      await update.mutateAsync({ data: { logoUrl: "" } });
      setLogoUrl("");
      qc.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey() });
      toast({
        title: "Logo removed",
        description: "Reports and the app will fall back to the default logo.",
      });
    } catch (err) {
      toast({
        title: "Failed to remove logo",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function onLogoFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-picked after an error.
    e.target.value = "";
    if (!file) return;

    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      toast({
        title: "Unsupported file type",
        description: "Logo must be a PNG, JPG, or SVG image.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({
        title: "File too large",
        description: "Logo must be 5 MB or smaller.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }
      setLogoUrl(objectPath);
      // Persist immediately so the upload is the save — users don't have to
      // remember to also click "Save branding" for the logo to take effect.
      await update.mutateAsync({ data: { logoUrl: objectPath } });
      qc.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey() });
      toast({
        title: "Logo uploaded",
        description: "Your new logo is live on reports and the app.",
      });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Branding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize the product name, company name, and logo used across the
          app and in every hiring report. Leave a field blank to fall back to
          the built-in default.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading current branding…
        </div>
      ) : (
        <form onSubmit={onSave} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="productName">Product name</Label>
            <Input
              id="productName"
              data-testid="input-product-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder={defaultBranding.productName}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Shown in the sidebar, landing page, and report headers.
              </span>
              {productName && (
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => onResetField(setProductName)}
                >
                  Clear (use default)
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="companyName">Company name</Label>
            <Input
              id="companyName"
              data-testid="input-company-name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={defaultBranding.companyName}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Used for the &quot;Prepared for&quot; line on hiring reports.
              </span>
              {companyName && (
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => onResetField(setCompanyName)}
                >
                  Clear (use default)
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logoUrl">Logo</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_LOGO_TYPES.join(",")}
                className="hidden"
                data-testid="input-logo-file"
                onChange={onLogoFileSelected}
              />
              <Button
                type="button"
                variant="outline"
                data-testid="button-upload-logo"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {isUploading ? "Uploading…" : "Upload logo"}
              </Button>
              <span className="text-xs text-muted-foreground">
                PNG, JPG, or SVG. Max 5&nbsp;MB.
              </span>
            </div>
            <div className="space-y-1 pt-2">
              <Label htmlFor="logoUrl" className="text-xs text-muted-foreground">
                Or paste a logo URL
              </Label>
              <Input
                id="logoUrl"
                data-testid="input-logo-url"
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Embedded on the cover of generated PDF reports.
              </span>
              {logoUrl && (
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => onResetField(setLogoUrl)}
                >
                  Clear
                </button>
              )}
            </div>
            {logoUrl && (
              <div
                className="mt-2 flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3"
                data-testid="logo-preview"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded bg-background border border-border overflow-hidden">
                  {/* Native <img> intentionally — broken URL just falls back to the icon. */}
                  <img
                    src={logoSrc(logoUrl)}
                    alt="Logo preview"
                    className="max-h-full max-w-full object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                      const fallback = e.currentTarget.nextElementSibling;
                      if (fallback) (fallback as HTMLElement).style.display = "flex";
                    }}
                  />
                  <div
                    className="hidden h-full w-full items-center justify-center text-muted-foreground"
                  >
                    <ImageIcon className="h-5 w-5" />
                  </div>
                </div>
                <p className="flex-1 text-xs text-muted-foreground">
                  Preview — this is what your PDF report cover will load.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="button-remove-logo"
                  disabled={update.isPending || isUploading}
                  onClick={onRemoveLogo}
                  className="gap-1.5"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove logo
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <ColorField
                id="colorPrimary"
                label="Primary color"
                testId="input-color-primary"
                helper="Used for primary CTAs, focus rings, and report headings."
                value={colorPrimary}
                onChange={setColorPrimary}
                fallback={defaultBranding.colors.primary}
                onClear={() => setColorPrimary("")}
              />
              <ColorField
                id="colorAccent"
                label="Accent color"
                testId="input-color-accent"
                helper="Used for the sidebar active item and secondary highlights."
                value={colorAccent}
                onChange={setColorAccent}
                fallback={defaultBranding.colors.accent}
                onClear={() => setColorAccent("")}
              />
            </div>
            <ColorPreview
              primary={colorPrimary}
              accent={colorAccent}
              productName={productName || defaultBranding.productName}
              fallbackPrimary={
                data?.colorPrimary || defaultBranding.colors.primary
              }
              fallbackAccent={
                data?.colorAccent || defaultBranding.colors.accent
              }
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              data-testid="button-save-branding"
              disabled={update.isPending}
              className="gap-1.5"
            >
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save branding
            </Button>
            {data?.updatedAt && (
              <span className="text-xs text-muted-foreground">
                Last updated {new Date(data.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
