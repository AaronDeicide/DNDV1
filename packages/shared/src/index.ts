/**
 * 共享“房间事件协议”与类型。
 * - 事件名尽量稳定：未来接 QQ/Discord/Telegram 只需要做 adapter 翻译这些事件。
 * - 这里同时导出 runtime 常量（EVENTS）与 TS 类型，供 server/desktop 复用。
 */

export const EVENTS = {
  // client -> server
  CLIENT_HELLO: "client.hello",
  ROOM_JOIN: "room.join",
  ROOM_CHAT_SEND: "room.chat.send",
  ROOM_DM_REQUEST: "room.dm.request",

  // server -> client
  SERVER_WELCOME: "server.welcome",
  ROOM_JOINED: "room.joined",
  ROOM_CHAT_MESSAGE: "room.chat.message",
  ROOM_DM_DELTA: "room.dm.delta",
  ROOM_DM_DONE: "room.dm.done",
  ROOM_ERROR: "room.error"
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export type UserPublic = {
  id: string;
  name: string;
};

export type RoomInfo = {
  id: string;
  name: string;
  inviteCode?: string;
};

export type MessageKind = "CHAT" | "SYSTEM" | "DM";

export type ChatMessage = {
  id: string;
  roomId: string;
  kind: MessageKind;
  user: UserPublic;
  text: string;
  createdAt: number;
};

// Socket.IO event maps（用于类型约束）
export type ClientToServerEvents = {
  [EVENTS.CLIENT_HELLO]: (payload: { token: string }, ack?: (res: { ok: true; user: UserPublic } | { ok: false; error: string }) => void) => void;
  [EVENTS.ROOM_JOIN]: (payload: { roomId: string }, ack?: (res: { ok: true; room: RoomInfo } | { ok: false; error: string }) => void) => void;
  [EVENTS.ROOM_CHAT_SEND]: (payload: { roomId: string; text: string }, ack?: (res: { ok: true } | { ok: false; error: string }) => void) => void;
  [EVENTS.ROOM_DM_REQUEST]: (
    payload: { roomId: string; text: string },
    ack?: (res: { ok: true; messageId: string } | { ok: false; error: string }) => void
  ) => void;
};

export type ServerToClientEvents = {
  [EVENTS.SERVER_WELCOME]: (payload: { user: UserPublic }) => void;
  [EVENTS.ROOM_JOINED]: (payload: { room: RoomInfo }) => void;
  [EVENTS.ROOM_CHAT_MESSAGE]: (payload: { message: ChatMessage }) => void;
  [EVENTS.ROOM_DM_DELTA]: (payload: { roomId: string; messageId: string; delta: string }) => void;
  [EVENTS.ROOM_DM_DONE]: (payload: { roomId: string; requestId: string; message: ChatMessage }) => void;
  [EVENTS.ROOM_ERROR]: (payload: { error: string }) => void;
};
