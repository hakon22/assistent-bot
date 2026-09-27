import type { AliceProtocolVersion } from '@/alice/types/alice-protocol-version';
import type { AliceSkillSessionState } from '@/alice/types/alice-session-state';

export interface AliceResponseButton {
  title: string;
  payload?: { [propertyName: string]: string | number | boolean | null; };
  url?: string;
  hide?: boolean;
}

export interface AliceResponsePayload {
  text: string;
  tts?: string;
  end_session: boolean;
  buttons?: AliceResponseButton[];
}

export interface AliceResponseBody {
  response: AliceResponsePayload;
  session_state?: AliceSkillSessionState;
  version: AliceProtocolVersion;
}

export interface AliceTextResponseParameters {
  text: string;
  endSession: boolean;
  sessionState?: AliceSkillSessionState;
  buttons?: AliceResponseButton[];
}
