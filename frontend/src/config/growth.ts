/**
 * "Help Us Grow" configuration — the single place to edit every public URL,
 * project blurb and share message used by the support modal.
 *
 * This file is deliberately framework-free and app-agnostic so it can be copied
 * into a sibling app and adjusted by editing `THIS_PROJECT` only.
 *
 * Rules for editing:
 *  - Only ever put *confirmed public* URLs here. Never a dashboard URL, a tenant
 *    URL, or anything carrying a token or session — these values are handed to
 *    social networks, mail clients and the clipboard.
 *  - Do not describe a project as free or open source unless that is confirmed
 *    for that project. Each entry carries its own wording.
 *  - Leave a field undefined rather than guessing; the UI omits what is missing.
 */

export interface GrowthProject {
  /** Stable key, used for React keys and share tracking. */
  id: string;
  /** Display name. */
  name: string;
  /** Canonical public website. Must be publicly reachable. */
  url: string;
  /** One short, accurate sentence. Omit if not confirmed. */
  description?: string;
  /** Public source repository, if the project has a confirmed public one. */
  repoUrl?: string;
  /** Optional extra public link (social, docs...). */
  secondary?: { label: string; url: string };
}

/** The project this copy of the app ships inside. */
export const THIS_PROJECT: GrowthProject = {
  id: 'st0r',
  name: 'St0r',
  // Canonical public product page. Verified reachable 2026-10-03.
  // NOT the dashboard the user is currently looking at.
  url: 'https://agit8or.net/projects/stor.html',
  description:
    'a modern management interface for UrBackup — endpoint status, schedules and retention, file recovery, and offsite replication',
  repoUrl: 'https://github.com/agit8or1/St0r',
};

/** Other projects and services from the same team. */
export const OTHER_PROJECTS: GrowthProject[] = [
  {
    id: 'mspreboot',
    name: 'MSP Reboot',
    url: 'https://mspreboot.com',
    description:
      'practical MSP consulting on pricing, operations, margins and service delivery, from a former 24-year MSP owner',
    secondary: { label: 'Follow MSP Reboot on Facebook', url: 'https://facebook.com/mspreboot' },
  },
  {
    id: 'mspzero',
    name: 'MSPZero',
    url: 'https://mspzero.com',
    description:
      'free, open-source tools for MSP documentation, firewalls, infrastructure, backups and remote support',
  },
];

/** The business behind the project, surfaced in the "Support our business" section. */
export const BUSINESS = OTHER_PROJECTS[0];

/** GitHub presence. `sponsorUrl` may be undefined — the section is then omitted. */
export const GITHUB = {
  orgUrl: 'https://github.com/agit8or1',
  /** Existing verified sponsorship destination. Set to undefined to hide the section. */
  sponsorUrl: 'https://github.com/sponsors/agit8or1' as string | undefined,
};

/** Ready-to-post message about this project. */
export function projectShareMessage(project: GrowthProject = THIS_PROJECT): string {
  const desc = project.description ? `: ${project.description}` : '';
  return `Check out ${project.name}${desc}. If it looks useful, give it a try and pass it along! ${project.url}`;
}

/** Ready-to-post message about the wider set of projects. */
export const NETWORK_SHARE_MESSAGE =
  'Know an MSP or business owner looking for useful tools and IT services? ' +
  'Check out https://mspreboot.com and https://mspzero.com, and pass them along to someone who could use them.';

/** Short message used when sharing a single other project. */
export function projectShortShare(project: GrowthProject): string {
  const desc = project.description ? ` — ${project.description}` : '';
  return `Thought of you: ${project.name}${desc}. ${project.url}`;
}
