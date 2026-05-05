import { useEffect, useMemo, useState } from "react";
import {
  useGetNotificationSettings,
  useUpdateNotificationSettings,
  useSendTestNotification,
  getGetNotificationSettingsQueryKey,
} from "@workspace/api-client-react";
import type { TestNotificationChannelResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Bell,
  RotateCcw,
  AlertTriangle,
  Send,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { SettingsTabs } from "@/components/settings-tabs";

type Mode = "instant" | "digest";

interface RecipientDraft {
  email: string;
  mode: Mode;
}

function parseRecipientLines(raw: string): string[] {
  return raw
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Merge a free-form textarea (one address per line/comma) with a per-email
 * `modeMap` so the UI can let recruiters edit the address list as text while
 * still attaching a delivery mode to each entry. Addresses missing from the
 * map default to `"instant"`.
 */
function buildRecipients(raw: string, modeMap: Record<string, Mode>): RecipientDraft[] {
  return parseRecipientLines(raw).map((email) => ({
    email,
    mode: modeMap[email] === "digest" ? "digest" : "instant",
  }));
}

export default function NotificationsSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useGetNotificationSettings();
  const updateMutation = useUpdateNotificationSettings();
  const testMutation = useSendTestNotification();

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState("");
  const [recipientModes, setRecipientModes] = useState<Record<string, Mode>>({});
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [digestCadenceHours, setDigestCadenceHours] = useState(24);
  const [dirty, setDirty] = useState(false);
  const [testResults, setTestResults] = useState<
    TestNotificationChannelResult[] | null
  >(null);

  useEffect(() => {
    if (settingsQuery.data && !dirty) {
      const recipients = settingsQuery.data.emailRecipients;
      setEmailEnabled(settingsQuery.data.emailEnabled);
      setEmailRecipients(recipients.map((r) => r.email).join(", "));
      const modes: Record<string, Mode> = {};
      for (const r of recipients) modes[r.email] = r.mode;
      setRecipientModes(modes);
      setSlackEnabled(settingsQuery.data.slackEnabled);
      setSlackWebhookUrl(settingsQuery.data.slackWebhookUrl ?? "");
      setDigestCadenceHours(settingsQuery.data.digestCadenceHours);
    }
  }, [settingsQuery.data, dirty]);

  const markDirty = () => setDirty(true);

  // Re-derive the structured list every render so the per-recipient mode
  // pickers stay in sync with whatever the user is typing in the textarea.
  const draftRecipients = useMemo(
    () => buildRecipients(emailRecipients, recipientModes),
    [emailRecipients, recipientModes],
  );

  const setMode = (email: string, mode: Mode) => {
    setRecipientModes((prev) => ({ ...prev, [email]: mode }));
    markDirty();
  };

  const handleSave = async () => {
    const recipients = draftRecipients;
    if (emailEnabled && recipients.length === 0) {
      toast({
        title: "Add at least one recipient",
        description: "Email notifications need at least one recipient address.",
        variant: "destructive",
      });
      return;
    }
    if (slackEnabled && !slackWebhookUrl.trim()) {
      toast({
        title: "Slack webhook required",
        description: "Add a Slack webhook URL or turn Slack notifications off.",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(digestCadenceHours) || digestCadenceHours < 1) {
      toast({
        title: "Digest cadence must be at least 1 hour",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        data: {
          emailEnabled,
          emailRecipients: recipients,
          slackEnabled,
          slackWebhookUrl: slackWebhookUrl.trim() || null,
          digestCadenceHours,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetNotificationSettingsQueryKey(),
      });
      setDirty(false);
      toast({
        title: "Notification settings saved",
        description: "New regressions will be delivered using these channels.",
      });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleSendTest = async () => {
    if (dirty) {
      toast({
        title: "Save changes first",
        description:
          "Save your channel settings before sending a test — the test uses the saved configuration.",
        variant: "destructive",
      });
      return;
    }
    setTestResults(null);
    try {
      const res = await testMutation.mutateAsync();
      setTestResults(res.results);
      const attempted = res.results.filter((r) => r.attempted);
      const failed = res.results.filter((r) => r.attempted && !r.ok);
      if (attempted.length === 0) {
        toast({
          title: "Nothing to test",
          description:
            "No channels are enabled. Turn on Email or Slack and save before testing.",
          variant: "destructive",
        });
      } else if (failed.length === 0) {
        toast({
          title: "Test notification sent",
          description: `Delivered on ${attempted
            .map((r) => r.channel)
            .join(", ")}.`,
        });
      } else {
        toast({
          title: "Some channels failed",
          description: `Failed: ${failed.map((r) => r.channel).join(", ")}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    if (!settingsQuery.data) return;
    const recipients = settingsQuery.data.emailRecipients;
    setEmailEnabled(settingsQuery.data.emailEnabled);
    setEmailRecipients(recipients.map((r) => r.email).join(", "));
    const modes: Record<string, Mode> = {};
    for (const r of recipients) modes[r.email] = r.mode;
    setRecipientModes(modes);
    setSlackEnabled(settingsQuery.data.slackEnabled);
    setSlackWebhookUrl(settingsQuery.data.slackWebhookUrl ?? "");
    setDigestCadenceHours(settingsQuery.data.digestCadenceHours);
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
  const digestLastSentAt = settingsQuery.data?.digestLastSentAt
    ? new Date(settingsQuery.data.digestLastSentAt).toLocaleString()
    : "Never";
  const emailDeliveryConfigured =
    settingsQuery.data?.emailDeliveryConfigured ?? false;

  return (
    <>
      <SettingsTabs />
      <div className="p-8 max-w-3xl">
        <div className="mb-8 flex items-start gap-3">
          <div className="h-10 w-10 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Email Regression Notifications
            </h1>
            <p className="text-muted-foreground mt-1">
              Get pinged the moment a previously verified candidate email goes
              bad, instead of waiting until you next open the inbox.
              Notifications follow the same 24-hour dedupe window as the inbox.
            </p>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-card p-6 space-y-6">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Email</Label>
                <p className="text-sm text-muted-foreground">
                  Send a plain-text email when a regression is recorded.
                </p>
              </div>
              <Switch
                checked={emailEnabled}
                onCheckedChange={(v) => {
                  setEmailEnabled(v);
                  markDirty();
                }}
                data-testid="switch-email-enabled"
              />
            </div>
            {emailEnabled && !emailDeliveryConfigured ? (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Email delivery isn't configured on the server (no
                  SENDGRID_API_KEY). Notifications will be skipped until an
                  admin sets it up.
                </span>
              </div>
            ) : null}
            <div className="mt-4 grid gap-2">
              <Label htmlFor="email-recipients">Recipients</Label>
              <Textarea
                id="email-recipients"
                placeholder="alice@example.com, bob@example.com"
                value={emailRecipients}
                onChange={(e) => {
                  setEmailRecipients(e.target.value);
                  markDirty();
                }}
                rows={3}
                data-testid="input-email-recipients"
              />
              <p className="text-xs text-muted-foreground">
                Comma-, space-, or newline-separated email addresses.
              </p>
            </div>

            {draftRecipients.length > 0 ? (
              <div className="mt-4 grid gap-2">
                <Label className="text-sm font-semibold">
                  Per-recipient delivery
                </Label>
                <p className="text-xs text-muted-foreground">
                  Choose <strong>Instant</strong> for one email per regression,
                  or <strong>Digest</strong> to roll them up into a single
                  periodic summary.
                </p>
                <div className="rounded-md border border-border divide-y divide-border">
                  {draftRecipients.map((r) => (
                    <div
                      key={r.email}
                      className="flex items-center justify-between gap-3 p-3"
                      data-testid={`recipient-row-${r.email}`}
                    >
                      <span className="text-sm font-mono truncate">
                        {r.email}
                      </span>
                      <Select
                        value={r.mode}
                        onValueChange={(v) => setMode(r.email, v as Mode)}
                      >
                        <SelectTrigger
                          className="w-32"
                          data-testid={`mode-select-${r.email}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="instant">Instant</SelectItem>
                          <SelectItem value="digest">Digest</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="grid gap-2">
                <Label htmlFor="digest-cadence">Digest cadence (hours)</Label>
                <Input
                  id="digest-cadence"
                  type="number"
                  min={1}
                  value={digestCadenceHours}
                  onChange={(e) => {
                    setDigestCadenceHours(Number(e.target.value));
                    markDirty();
                  }}
                  data-testid="input-digest-cadence"
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  How often digest-mode recipients receive a roll-up email.
                  Defaults to every 24 hours.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Last digest sent: {digestLastSentAt}
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Slack</Label>
                <p className="text-sm text-muted-foreground">
                  Post a message to a Slack channel via incoming webhook.
                </p>
              </div>
              <Switch
                checked={slackEnabled}
                onCheckedChange={(v) => {
                  setSlackEnabled(v);
                  markDirty();
                }}
                data-testid="switch-slack-enabled"
              />
            </div>
            <div className="mt-4 grid gap-2">
              <Label htmlFor="slack-webhook">Webhook URL</Label>
              <Input
                id="slack-webhook"
                type="url"
                placeholder="https://hooks.slack.com/services/…"
                value={slackWebhookUrl}
                onChange={(e) => {
                  setSlackWebhookUrl(e.target.value);
                  markDirty();
                }}
                data-testid="input-slack-webhook"
              />
              <p className="text-xs text-muted-foreground">
                Create one in Slack under Apps → Incoming Webhooks.
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3 border-t border-border">
            <Button
              onClick={handleSave}
              disabled={!dirty || updateMutation.isPending}
              data-testid="button-save-notifications"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={!dirty || updateMutation.isPending}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <Button
              variant="secondary"
              onClick={handleSendTest}
              disabled={
                dirty ||
                testMutation.isPending ||
                (!emailEnabled && !slackEnabled)
              }
              className="gap-2"
              data-testid="button-send-test-notification"
            >
              {testMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending test…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send test
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground ml-auto">
              Last updated: {updatedAt}
            </p>
          </div>

          {testResults ? (
            <div
              className="border-t border-border pt-4 space-y-2"
              data-testid="test-notification-results"
            >
              <p className="text-sm font-semibold text-foreground">
                Test results
              </p>
              {testResults.map((r) => {
                const Icon = r.ok
                  ? CheckCircle2
                  : r.attempted
                    ? XCircle
                    : MinusCircle;
                const tone = r.ok
                  ? "text-green-700 bg-green-50 border-green-200"
                  : r.attempted
                    ? "text-red-700 bg-red-50 border-red-200"
                    : "text-muted-foreground bg-muted/40 border-border";
                const label = r.channel === "slack" ? "Slack" : "Email";
                const detail = r.ok
                  ? "Delivered."
                  : r.attempted
                    ? `Failed: ${r.error ?? "Unknown error"}`
                    : (r.skippedReason ?? "Skipped.");
                return (
                  <div
                    key={r.channel}
                    className={`flex items-start gap-2 rounded-md border p-3 text-sm ${tone}`}
                    data-testid={`test-result-${r.channel}`}
                  >
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">{label}:</span> {detail}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
