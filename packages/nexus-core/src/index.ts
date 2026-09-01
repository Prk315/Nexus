export * from "./types";
export * from "./utils";
export * from "./client";
export * from "./apps";
export * from "./auth/NexusAuth";
export * from "./components/AppGridButton";
export * from "./components/NexusHeader";
export * from "./components/SettingsDialog";
export * from "./components/ClockDropdown";
export * from "./components/MailPanel";
// Narrow on purpose. `mail/priority` also exports plainText / plainLine /
// sortMail, which read like general-purpose utilities from the barrel but carry
// mail-specific defaults; they stay internal to the mail module.
export {
  MAIL_TABLE,
  MAIL_COLUMNS,
  OPEN_STATUSES,
  HANDLED_STATUSES,
  type MailAxis,
  type MailCategory,
  type MailMessage,
  type MailRule,
  type MailRuleMatchField,
  type MailRuleActionField,
  type MailRuleStatus,
  type MailStatus,
} from "./mail/types";
export { createMailRulesApi, type MailRulesApi } from "./mail/rulesApi";
export { createMailApi, type MailApi } from "./mail/api";
export * from "./components/MailRulesDialog";
export {
  createMailLoader,
  MAIL_FETCH_LIMIT,
  type MailLoader,
  type MailLoaderOptions,
  type MailSnapshot,
} from "./mail/loader";
export * from "./components/JobsPanel";
// Narrow, like the mail block above: `jobs/score` also exports band floors,
// comparators and the marker list, which are the panel's internals rather than
// package API. Apps need the API factory, the row types and the two limits they
// might want to reason about.
export {
  createJobsApi,
  REVIEW_LIMIT,
  MATCH_LIMIT,
  SENT_LIMIT,
  PROFILE_LIMIT,
  ATTEMPT_LIMIT,
  type JobsApi,
  type JobsAttention,
  type JobsSnapshot,
  type JobProfilePatch,
} from "./jobs/api";
export {
  JOB_APPLICATIONS_TABLE,
  JOB_ATTEMPTS_TABLE,
  JOB_MATCHES_TABLE,
  JOB_MODULES_TABLE,
  JOB_POSTINGS_TABLE,
  JOB_PROFILES_TABLE,
  RESPONSE_STATUS,
  REVIEW_STATUS,
  SENT_STATUSES,
  type JobAppModule,
  type JobApplication,
  type JobApplicationItem,
  type JobApplicationStatus,
  type JobGateVerdict,
  type JobMatch,
  type JobMatchItem,
  type JobPosting,
  type JobProfile,
  type JobProfileFull,
  type JobSubmissionAttempt,
} from "./jobs/types";
export * from "./components/LifeBar";
export * from "./components/AgentBar";
export * from "./components/CalendarSidebar";
export * from "./components/WorkflowViewer";
export * from "./components/Chart2D";
export * from "./components/Chart3D";
export * from "./components/AppGraph3D";
export * from "./settings";
export * from "./hooks/useConnectedApps";
export * from "./hooks/useAppearance";
export * from "./hooks/useNexusRegistration";
export * from "./hooks/useAgentBar";
export * from "./hooks/useCalendarSidebar";
