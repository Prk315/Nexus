export * from "./types";
export * from "./utils";
export * from "./client";
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
export * from "./components/MailRulesDialog";
export {
  createMailLoader,
  MAIL_FETCH_LIMIT,
  type MailLoader,
  type MailLoaderOptions,
  type MailSnapshot,
} from "./mail/loader";
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
