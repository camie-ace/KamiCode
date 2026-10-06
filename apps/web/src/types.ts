import { imageMimeType } from "@t3tools/shared/image";
import type {
  ChatAttachment as ContractChatAttachment,
  ChatFileAttachment as ContractChatFileAttachment,
  ChatGifAttachment as ContractChatGifAttachment,
  ChatImageAttachment as ContractChatImageAttachment,
  ChatVideoAttachment as ContractChatVideoAttachment,
  ProjectTestEnvironment as ContractProjectTestEnvironment,
  MessageId,
  OrchestrationV2Actor,
  OrchestrationV2CreationSource,
  OrchestrationV2PlanArtifact,
  OrchestrationV2UserMessageInputIntent,
  PlanId,
  ProjectScript as ContractProjectScript,
  ProviderInteractionMode,
  RunId,
  RuntimeMode,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
  ThreadRunSummary,
  ThreadRuntimeSummary,
} from "@t3tools/client-runtime/state/shell";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import { videoMimeType } from "@t3tools/shared/video";

export { videoMimeType } from "@t3tools/shared/video";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "term-1";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;
export type ProjectTestEnvironment = ContractProjectTestEnvironment;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
  splitDirection?: "horizontal" | "vertical";
}

export interface ChatImageAttachment extends ContractChatImageAttachment {
  readonly previewUrl?: string;
  readonly downloadable?: boolean;
}

export interface ChatGifAttachment extends ContractChatGifAttachment {
  readonly previewUrl?: string;
  readonly downloadable?: boolean;
}

export interface ChatVideoAttachment extends ContractChatVideoAttachment {
  readonly previewUrl?: string;
  readonly downloadable?: boolean;
}

export interface ChatFileAttachment extends ContractChatFileAttachment {
  readonly previewUrl?: string;
  readonly downloadable?: boolean;
  /** A page an agent published with `html_render`; its viewer hands it the app theme. */
  readonly htmlRender?: boolean;
}

export function isVideoAttachment(attachment: {
  readonly type?: string;
  readonly id?: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes?: number;
}): boolean {
  return videoMimeType(attachment) !== null;
}

export type ChatAttachment = ContractChatAttachment & {
  readonly previewUrl?: string;
  readonly downloadable?: boolean;
};

export function isImageAttachment(attachment: ChatAttachment): attachment is ChatImageAttachment {
  // Messages sent before pictures were typed by content carry `file`; they are still
  // pictures, and reading them as such is what lets them render instead of listing. Only
  // `file` is reclassified: an attachment type this client does not know yet is not a
  // picture by default, whatever its name says.
  if (attachment.type === "image") return true;
  return attachment.type === "file" && imageMimeType(attachment) !== null;
}

export function isFileAttachment(attachment: ChatAttachment): attachment is ChatFileAttachment {
  // Disjoint from `isImageAttachment` on purpose: a legacy `file` carrying an image reads as a
  // picture, and callers filter both sets independently, so overlap renders it twice.
  return attachment.type === "file" && !isImageAttachment(attachment);
}

export function isBrowserPreviewAttachment(attachment: ChatFileAttachment): boolean {
  const mimeType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    /\.(?:html?|pdf)$/i.test(attachment.name) ||
    mimeType === "application/pdf" ||
    mimeType === "text/html"
  );
}

export interface ChatMessage {
  readonly context?: import("@t3tools/contracts").OrchestrationMessageContext | undefined;
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  readonly runId: RunId | null;
  readonly streaming: boolean;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly scheduledTaskId?: ScheduledTaskId;
  readonly senderThreadId?: ThreadId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly inputIntent?: OrchestrationV2UserMessageInputIntent | undefined;
}

export interface ProposedPlan {
  readonly id: PlanId;
  readonly runId: RunId | null;
  readonly planMarkdown: string;
  readonly status: OrchestrationV2PlanArtifact["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type TurnDiffFileChange = ThreadCheckpointSummary["files"][number];
export type TurnDiffSummary = ThreadCheckpointSummary;

export type Project = EnvironmentProject;
export type Thread = EnvironmentThreadShell;
export type ThreadShell = EnvironmentThreadShell;

export type SidebarThreadSummary = EnvironmentThreadShell;
export type ThreadSession = ThreadRuntimeSummary;
