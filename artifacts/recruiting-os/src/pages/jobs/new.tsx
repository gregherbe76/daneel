import { useCreateJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Seniority } from "@workspace/api-client-react";
import { X, Plus, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScoringWeightsEditor, sumWeights } from "@/components/scoring-weights-editor";
import { DEFAULT_SCORING_WEIGHTS } from "@/components/score-breakdown";

const weightsSchema = z.object({
  autonomy: z.number().int().min(0).max(100),
  productMindset: z.number().int().min(0).max(100),
  impact: z.number().int().min(0).max(100),
});

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  location: z.string().min(1, "Location is required"),
  seniority: z.enum([
    Seniority.Intern,
    Seniority.Junior,
    Seniority.Mid,
    Seniority.Senior,
    Seniority.Lead,
    Seniority.Principal,
    Seniority.Director,
    Seniority.VP,
  ]),
  mustHaveSkills: z.array(z.string()).min(1, "At least one skill is required"),
  scoringWeights: weightsSchema.refine((w) => sumWeights(w) === 100, {
    message: "Scoring weights must add up to 100%",
  }),
  technicalEvaluationEnabled: z.boolean().optional(),
});

export default function CreateJobPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createJob = useCreateJob();
  const [skillInput, setSkillInput] = useState("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      location: "",
      seniority: Seniority.Mid,
      mustHaveSkills: [],
      scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
      technicalEvaluationEnabled: false,
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createJob.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
          toast({ title: "Job created successfully" });
          setLocation(`/jobs/${data.id}`);
        },
        onError: () => {
          toast({ title: "Failed to create job", variant: "destructive" });
        },
      }
    );
  };

  const addSkill = () => {
    if (skillInput.trim()) {
      const currentSkills = form.getValues("mustHaveSkills");
      if (!currentSkills.includes(skillInput.trim())) {
        form.setValue("mustHaveSkills", [...currentSkills, skillInput.trim()]);
      }
      setSkillInput("");
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Create Job</h1>
        <p className="text-muted-foreground mt-1">Add a new role to your hiring pipeline.</p>
      </div>

      <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6 pt-6">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Senior Frontend Engineer" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. San Francisco, CA (Remote)" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="seniority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Seniority</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select seniority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.values(Seniority).map((level) => (
                            <SelectItem key={level} value={level}>
                              {level}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="mustHaveSkills"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Must Have Skills</FormLabel>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {field.value.map((skill, index) => (
                        <Badge key={index} variant="secondary" className="flex items-center gap-1">
                          {skill}
                          <button
                            type="button"
                            onClick={() => {
                              const newSkills = [...field.value];
                              newSkills.splice(index, 1);
                              form.setValue("mustHaveSkills", newSkills);
                            }}
                            className="ml-1 hover:text-destructive focus:outline-none"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={skillInput}
                        onChange={(e) => setSkillInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addSkill();
                          }
                        }}
                        placeholder="e.g. React"
                      />
                      <Button type="button" onClick={addSkill} variant="secondary">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Job description..." className="h-32" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-6">
                <FormField
                  control={form.control}
                  name="technicalEvaluationEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-4 mb-6">
                      <div className="space-y-1">
                        <FormLabel className="text-base">Technical evaluation</FormLabel>
                        <p className="text-xs text-muted-foreground">
                          Run an extra technical scoring step (depth, ownership, consistency, taste, impact)
                          on every candidate using a connected technical evaluation provider — e.g. CodeMatch.
                          Each candidate must have a public GitHub username on file.
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          data-testid="job-technical-evaluation-switch"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="border-t pt-6">
                <FormField
                  control={form.control}
                  name="scoringWeights"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <ScoringWeightsEditor value={field.value} onChange={field.onChange} />
                      {fieldState.error && (
                        <p className="text-xs text-destructive mt-2">{fieldState.error.message}</p>
                      )}
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t pt-6">
              <Button type="button" variant="outline" onClick={() => setLocation("/jobs")}>
                Cancel
              </Button>
              <Button type="submit" disabled={createJob.isPending}>
                {createJob.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Job
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
