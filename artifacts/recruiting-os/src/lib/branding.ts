import { branding as defaultBranding } from "@workspace/branding";
import {
  useGetBrandingSettings,
  getGetBrandingSettingsQueryKey,
} from "@workspace/api-client-react";

/**
 * Returns the resolved global branding — runtime overrides from `/branding`
 * merged on top of the static template defaults shipped with the app.
 *
 * Always safe to call: while the network request is in flight, callers see
 * the static template defaults, so the UI never flashes empty strings.
 */
export function useBranding() {
  // Use the generated query key so cache invalidations from the settings
  // page (also keyed off `getGetBrandingSettingsQueryKey()`) flow through
  // here immediately — without a manual remount or refetch.
  const { data } = useGetBrandingSettings({
    query: { queryKey: getGetBrandingSettingsQueryKey(), staleTime: 60_000 },
  });
  return {
    productName: data?.productName ?? defaultBranding.productName,
    companyName: data?.companyName ?? defaultBranding.companyName,
    logoUrl: data?.logoUrl ?? defaultBranding.logoUrl,
    // Primary + accent flow through from the runtime override, with the static
    // template colors as the final fallback. Muted + divider aren't user-tunable.
    colors: {
      ...defaultBranding.colors,
      primary: data?.colorPrimary ?? defaultBranding.colors.primary,
      accent: data?.colorAccent ?? defaultBranding.colors.accent,
    },
  };
}
