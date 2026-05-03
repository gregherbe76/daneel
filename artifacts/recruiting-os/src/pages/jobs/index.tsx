import { useListJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Loader2, Briefcase } from "lucide-react";

export default function JobsPage() {
  const { data: jobs, isLoading } = useListJobs();

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground mt-1">Manage open positions and pipelines.</p>
        </div>
        <Link href="/jobs/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Job
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : jobs?.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Briefcase className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No jobs yet</h3>
          <p className="text-muted-foreground mb-4">Create your first job to start hiring.</p>
          <Link href="/jobs/new">
            <Button variant="outline">Create Job</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {jobs?.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <Card className="p-6 hover:border-primary/50 transition-colors cursor-pointer group">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-semibold group-hover:text-primary transition-colors">
                      {job.title}
                    </h3>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {job.location}
                      </span>
                      <Badge variant="secondary">{job.seniority}</Badge>
                    </div>
                  </div>
                </div>
                {job.mustHaveSkills && job.mustHaveSkills.length > 0 && (
                  <div className="mt-4 flex gap-2 flex-wrap">
                    {job.mustHaveSkills.map((skill) => (
                      <Badge key={skill} variant="outline" className="bg-background">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
