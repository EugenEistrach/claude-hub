/**
 * Discord interaction and webhook types for TypeScript
 */

// Discord Interaction Types
export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5
}

// Discord Interaction Response Types
export enum InteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7
}

// Discord Application Command Types
export enum ApplicationCommandType {
  CHAT_INPUT = 1,
  USER = 2,
  MESSAGE = 3
}

// Discord Command Option Types
export enum ApplicationCommandOptionType {
  SUB_COMMAND = 1,
  SUB_COMMAND_GROUP = 2,
  STRING = 3,
  INTEGER = 4,
  BOOLEAN = 5,
  USER = 6,
  CHANNEL = 7,
  ROLE = 8,
  MENTIONABLE = 9,
  NUMBER = 10,
  ATTACHMENT = 11
}

// Discord User type
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  locale?: string;
  verified?: boolean;
  email?: string | null;
  flags?: number;
  premium_type?: number;
  public_flags?: number;
}

// Discord Guild Member type
export interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
  joined_at: string;
  premium_since?: string | null;
  deaf: boolean;
  mute: boolean;
  pending?: boolean;
  permissions?: string;
}

// Discord Channel type
export interface DiscordChannel {
  id: string;
  type: number;
  guild_id?: string;
  position?: number;
  permission_overwrites?: unknown[];
  name?: string;
  topic?: string | null;
  nsfw?: boolean;
  last_message_id?: string | null;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  recipients?: DiscordUser[];
  icon?: string | null;
  owner_id?: string;
  application_id?: string;
  parent_id?: string | null;
  last_pin_timestamp?: string | null;
}

// Discord Application Command Option
export interface ApplicationCommandInteractionDataOption {
  name: string;
  type: ApplicationCommandOptionType;
  value?: string | number | boolean;
  options?: ApplicationCommandInteractionDataOption[];
  focused?: boolean;
}

// Discord Application Command Data
export interface ApplicationCommandInteractionData {
  id: string;
  name: string;
  type: ApplicationCommandType;
  resolved?: {
    users?: Record<string, DiscordUser>;
    members?: Record<string, DiscordGuildMember>;
    roles?: Record<string, unknown>;
    channels?: Record<string, DiscordChannel>;
    messages?: Record<string, unknown>;
    attachments?: Record<string, unknown>;
  };
  options?: ApplicationCommandInteractionDataOption[];
  guild_id?: string;
  target_id?: string;
}

// Main Discord Interaction Payload
export interface DiscordInteractionPayload {
  id: string;
  application_id: string;
  type: InteractionType;
  data?: ApplicationCommandInteractionData;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordGuildMember;
  user?: DiscordUser;
  token: string;
  version: number;
  message?: unknown;
  locale?: string;
  guild_locale?: string;
}

// Discord Embed types
export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
  proxy_icon_url?: string;
}

export interface DiscordEmbedImage {
  url: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface DiscordEmbedThumbnail {
  url: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface DiscordEmbedVideo {
  url?: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}

export interface DiscordEmbedProvider {
  name?: string;
  url?: string;
}

export interface DiscordEmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
  proxy_icon_url?: string;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  type?: 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link';
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: DiscordEmbedFooter;
  image?: DiscordEmbedImage;
  thumbnail?: DiscordEmbedThumbnail;
  video?: DiscordEmbedVideo;
  provider?: DiscordEmbedProvider;
  author?: DiscordEmbedAuthor;
  fields?: DiscordEmbedField[];
}

// Discord Message Components
export interface DiscordActionRow {
  type: 1;
  components: unknown[];
}

// Discord Interaction Response
export interface DiscordInteractionResponse {
  type: InteractionResponseType;
  data?: DiscordInteractionResponseData;
}

export interface DiscordInteractionResponseData {
  tts?: boolean;
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: DiscordAllowedMentions;
  flags?: number;
  components?: DiscordActionRow[];
  attachments?: unknown[];
}

export interface DiscordAllowedMentions {
  parse?: Array<'roles' | 'users' | 'everyone'>;
  roles?: string[];
  users?: string[];
  replied_user?: boolean;
}

// Discord Webhook Message
export interface DiscordWebhookMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  tts?: boolean;
  embeds?: DiscordEmbed[];
  allowed_mentions?: DiscordAllowedMentions;
  components?: DiscordActionRow[];
  files?: unknown[];
  payload_json?: string;
  attachments?: unknown[];
  flags?: number;
}

// Discord API Responses
export interface DiscordAPIMessage {
  id: string;
  type: number;
  content: string;
  channel_id: string;
  author: DiscordUser;
  attachments: unknown[];
  embeds: DiscordEmbed[];
  mentions: DiscordUser[];
  mention_roles: string[];
  pinned: boolean;
  mention_everyone: boolean;
  tts: boolean;
  timestamp: string;
  edited_timestamp: string | null;
  flags: number;
  components: unknown[];
  referenced_message?: unknown;
}

// Discord Bot Configuration
export interface DiscordBotConfig {
  applicationId: string;
  publicKey: string;
  token?: string;
  authorizedUsers?: string[];
  authorizedRoles?: string[];
  authorizedGuilds?: string[];
}

// Request/Response types for Discord service
export interface CreateDiscordResponseRequest {
  interactionToken: string;
  content?: string;
  embeds?: DiscordEmbed[];
  ephemeral?: boolean;
  components?: DiscordActionRow[];
}

export interface EditDiscordResponseRequest {
  applicationId: string;
  interactionToken: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: DiscordActionRow[];
}

export interface CreateFollowupMessageRequest {
  applicationId: string;
  interactionToken: string;
  content?: string;
  embeds?: DiscordEmbed[];
  ephemeral?: boolean;
  components?: DiscordActionRow[];
}

// Repository context for Discord
export interface DiscordRepositoryContext {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch?: string;
}

// Discord command parsing result
export interface ParsedDiscordCommand {
  commandName: string;
  repository?: DiscordRepositoryContext;
  issueNumber?: number;
  branchName?: string;
  commandText: string;
  options: Record<string, string | number | boolean>;
}

// Validation types
export interface ValidatedDiscordInteraction {
  payload: DiscordInteractionPayload;
  isValid: boolean;
  error?: string;
}

// Discord message flags
export const DiscordMessageFlags = {
  EPHEMERAL: 1 << 6, // 64 - Only visible to user who invoked the interaction
  SUPPRESS_EMBEDS: 1 << 2, // 4 - Do not include embeds when serializing message
  LOADING: 1 << 7 // 128 - This message is an interaction response and the bot is "thinking"
} as const;

// Error response for Discord
export interface DiscordErrorResponse {
  error: string;
  message?: string;
  code?: number;
}

// Discord API Error Response
export interface DiscordAPIError {
  code: number;
  message: string;
  errors?: Record<string, unknown>;
}
