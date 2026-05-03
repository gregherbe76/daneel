import { useEffect, useState } from "react";
import {
  useGetBrandingSettings,
  useUpdateBrandingSettings,
  getGetBrandingSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { branding as defaultBranding } from "@workspace/branding";
import { Loader2, Image as ImageIcon } from "lucide-react";

export default function BrandingSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetBrandingSettings();
  const update = useUpdateBrandingSettings();

  const [productName, setProductName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  // Hydrate the form once the saved values arrive — without clobbering
  // anything the user has already typed.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!hydrated && data) {
      setProductName(data.productName ?? "");
      setCompanyName(data.companyName ?? "");
      setLogoUrl(data.logoUrl ?? "");
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
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              data-testid="input-logo-url"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Embedded on the cover of generated PDF reports. PNG or JPG.
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
                    src={logoUrl}
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
                <p className="text-xs text-muted-foreground">
                  Preview — this is what your PDF report cover will load.
                </p>
              </div>
            )}
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
