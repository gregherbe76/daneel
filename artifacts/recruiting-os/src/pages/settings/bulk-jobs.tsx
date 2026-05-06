import { useEffect, useState } from "react";
import {
  useGetBulkJobsSettings,
  useUpdateBulkJobsSettings,
  getGetBulkJobsSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, RotateCcw } from "lucide-react";
import { SettingsTabs } from "@/components/settings-tabs";

export default function BulkJobsSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useGetBulkJobsSettings();
  const updateMutation = useUpdateBulkJobsSettings();

  const [retentionDays, setRetentionDays] = useState("7");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && !dirty) {
      setRetentionDays(String(settingsQuery.data.retentionDays));
    }
  }, [settingsQuery.data, dirty]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast({
        title: "Invalid retention",
        description: "Retention must be between 1 and 365 days.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateMutation.mutateAsync({ data: { retentionDays: days } });
      await queryClient.invalidateQueries({
        queryKey: getGetBulkJobsSettingsQueryKey(),
      });
      setDirty(false);
      toast({
        title: "Settings saved",
        description:
          "The retention sweep will use the new window on its next tick (within the hour).",
      });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    if (!settingsQuery.data) return;
    setRetentionDays(String(settingsQuery.data.retentionDays));
    setDirty(false);
  };

  if (settingsQuery.isLoading) {
    return (
      <>
        <SettingsTabs />
        <div className="p-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading settings…
        </div>
      </>
    );
  }

  if (settingsQuery.error) {
    return (
      <>
        <SettingsTabs />
        <div className="p-8 text-destructive">
          Failed to load settings: {String(settingsQuery.error)}
        </div>
      </>
    );
  }

  const updatedAt = settingsQuery.data?.updatedAt
    ? new Date(settingsQuery.data.updatedAt).toLocaleString()
    : "—";

  return (
    <>
      <SettingsTabs />
      <div className="p-8 max-w-3xl">
        <div className="mb-8 flex items-start gap-3">
          <div className="h-10 w-10 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Trash2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Bulk-job retention
            </h1>
            <p className="text-muted-foreground mt-1">
              Completed, failed, and canceled bulk-action jobs (delete, recheck
              email, move stage, export CSV) are kept for this many days before
              the background sweep removes them. Lower values free up space on
              busy deployments; higher values keep history around for audits.
              Changes take effect on the next sweep (runs hourly).
            </p>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-card p-6 space-y-6">
          <div className="grid gap-2">
            <Label htmlFor="retention-days">Retention window (days)</Label>
            <Input
              id="retention-days"
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => {
                setRetentionDays(e.target.value);
                markDirty();
              }}
              className="max-w-xs"
              data-testid="input-bulk-jobs-retention-days"
            />
            <p className="text-xs text-muted-foreground">
              Terminal bulk-job rows older than this are deleted on the next
              hourly sweep. Must be between 1 and 365.
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              Last updated: {updatedAt}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={!dirty || updateMutation.isPending}
                data-testid="button-bulk-jobs-reset"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={!dirty || updateMutation.isPending}
                data-testid="button-bulk-jobs-save"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
