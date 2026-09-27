import type { AliceProtocolVersion } from '@/alice/types/alice-protocol-version';
import type {
  ALICE_REQUEST_TYPE_BUTTON_PRESSED,
  ALICE_REQUEST_TYPE_SHOW_PULL,
  ALICE_REQUEST_TYPE_SIMPLE_UTTERANCE,
} from '@/alice/types/alice-request-type';
import type { AliceRequestNaturalLanguage } from '@/alice/types/alice-natural-language';
import type { AliceSession } from '@/alice/types/alice-session';

export interface AliceMetaInterfaces {
  screen?: object;
  account_linking?: object;
  audio_player?: object;
}

export interface AliceMeta {
  locale: string;
  timezone: string;
  client_id: string;
  interfaces: AliceMetaInterfaces;
}

export interface AliceSimpleUtteranceMarkup {
  dangerous_context?: boolean;
}

export interface AliceSimpleUtteranceRequest {
  type: typeof ALICE_REQUEST_TYPE_SIMPLE_UTTERANCE;
  command: string;
  original_utterance: string;
  markup?: AliceSimpleUtteranceMarkup;
  payload?: unknown;
  nlu?: AliceRequestNaturalLanguage;
}

export interface AliceButtonPressedRequest {
  type: typeof ALICE_REQUEST_TYPE_BUTTON_PRESSED;
  payload?: unknown;
}

export interface AliceShowPullRequest {
  type: typeof ALICE_REQUEST_TYPE_SHOW_PULL;
}

export type AliceRequest =
  | AliceSimpleUtteranceRequest
  | AliceButtonPressedRequest
  | AliceShowPullRequest;

export interface AliceIncomingState {
  session?: unknown;
  user?: unknown;
  application?: unknown;
}

export interface AliceIncomingBody {
  meta: AliceMeta;
  request: AliceRequest;
  session: AliceSession;
  state?: AliceIncomingState;
  version: AliceProtocolVersion;
}
