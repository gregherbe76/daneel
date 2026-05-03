import { useGetJob, useGetJobApplications, ApplicationStage, useUpdateApplication, getGetJobApplicationsQueryKey } from "@workspace/api-client-react";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Edit, User, Mail, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const jobId = parseInt(params?.id || "0", 10);

  const { data: job, isLoading: isLoadingJob } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: [`/api/jobs/${jobId}`] },
  });

  const { data: applications, isLoading: isLoadingApps } = useGetJobApplications(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobApplicationsQueryKey(jobId) },
  });

  const updateApp = useUpdateApplication();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const stages = Object.values(ApplicationStage);

  const handleStageChange = (appId: number, newStage: typeof ApplicationStage[keyof typeof ApplicationStage]) => {
    updateApp.mutate(
      { id: appId, data: { stage: newStage } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetJobApplicationsQueryKey(jobId) });
          toast({ title: "Stage updated successfully" });
        },
      }
    );
  };

  if (isLoadingJob || isLoadingApps) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!job) {
    return <div className="p-8">Job not found</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-8 border-b border-border bg-card flex-shrink-0">
        <div className="max-w-7xl mx-auto flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">{job.title}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {job.location}
              </span>
              <Badge variant="secondary">{job.seniority}</Badge>
            </div>
            <div className="flex gap-2 flex-wrap">
              {job.mustHaveSkills?.map((skill) => (
                <Badge key={skill} variant="outline" className="bg-background">
                  {skill}
                </Badge>
              ))}
            </div>
          </div>
          <Link href={`/jobs/${job.id}/edit`}>
            <Button variant="outline">
              <Edit className="mr-2 h-4 w-4" />
              Edit Job
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-8">
        <div className="max-w-7xl mx-auto h-full min-w-max flex gap-4">
          {stages.map((stage) => {
            const appsInStage = applications?.filter((app) => app.stage === stage) || [];
            return (
              <div key={stage} className="flex-shrink-0 w-80 flex flex-col bg-muted/30 rounded-lg border border-border overflow-hidden">
                <div className="p-3 border-b border-border bg-muted/50 font-medium flex justify-between items-center">
                  <span>{stage}</span>
                  <Badge variant="secondary">{appsInStage.length}</Badge>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {appsInStage.map((app) => (
                    <div key={app.id} className="bg-card border border-border rounded-md p-4 shadow-sm hover:border-primary/50 transition-colors">
                      <Link href={`/candidates/${app.candidate.id}`}>
                        <div className="font-medium hover:text-primary transition-colors cursor-pointer mb-1">
                          {app.candidate.name}
                        </div>
                      </Link>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mb-4">
                        <Mail className="h-3 w-3" />
                        <span className="truncate">{app.candidate.email}</span>
                      </div>
                      
                      <div className="flex justify-between items-center mt-2 border-t border-border pt-3">
                        <Link href={`/candidates/${app.candidate.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2">
                            <User className="mr-1 h-3 w-3" />
                            Profile
                          </Button>
                        </Link>
                        
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-7 text-xs px-2">
                              Move <ArrowRight className="ml-1 h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {stages.filter(s => s !== stage).map((s) => (
                              <DropdownMenuItem key={s} onClick={() => handleStageChange(app.id, s)}>
                                Move to {s}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                  {appsInStage.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground italic border-2 border-dashed border-border rounded-md bg-card/50">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
