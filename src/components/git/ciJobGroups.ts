// Job grouping for the CI/CD pipeline graph, after GitLab's: parallel jobs
// ("deploy 1/3", "deploy 2/3") and matrix jobs ("build: [linux, amd64]") share
// a group named by the job name without that suffix. The pattern mirrors
// GitLab's CommitStatus#group_name (app/models/commit_status.rb) —
// doğrulanmadı against every GitLab version.
const GROUP_SUFFIX = /([\s:]+((\[.*\])|(\d+[\s:/\\]+\d+)))+\s*$/;

export function jobGroupName(name: string): string {
  return (name ?? '').replace(GROUP_SUFFIX, '').trim() || name;
}

export interface JobGroup<J> {
  name: string;
  jobs: J[];
}

/** Groups a stage's jobs by jobGroupName, in order of first appearance. */
export function groupJobs<J extends { name: string }>(jobs: J[]): JobGroup<J>[] {
  const out: JobGroup<J>[] = [];
  const byName = new Map<string, JobGroup<J>>();
  for (const j of jobs) {
    const key = jobGroupName(j.name);
    let g = byName.get(key);
    if (!g) {
      g = { name: key, jobs: [] };
      byName.set(key, g);
      out.push(g);
    }
    g.jobs.push(j);
  }
  return out;
}
