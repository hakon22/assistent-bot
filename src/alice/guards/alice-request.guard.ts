import { ALICE_PROTOCOL_VERSION } from '@/alice/types/alice-protocol-version';
import {
  ALICE_REQUEST_TYPE_BUTTON_PRESSED,
  ALICE_REQUEST_TYPE_SHOW_PULL,
  ALICE_REQUEST_TYPE_SIMPLE_UTTERANCE,
} from '@/alice/types/alice-request-type';
import { isAliceObject } from '@/alice/guards/alice-object.guard';
import type { AliceIncomingBody, AliceRequest, AliceSimpleUtteranceRequest } from '@/alice/types/alice-request-body';

const isSessionValid = (session: { [key: string]: unknown; }): boolean => {
  if (typeof session.session_id !== 'string' || typeof session.skill_id !== 'string') {
    return false;
  }

  if (typeof session.message_id !== 'number' || typeof session.new !== 'boolean') {
    return false;
  }

  if (session.user === undefined) {
    return true;
  }

  if (!isAliceObject(session.user) || typeof session.user.user_id !== 'string') {
    return false;
  }

  return true;
};

const isRequestValid = (request: { [key: string]: unknown; }): boolean => {
  if (request.type === ALICE_REQUEST_TYPE_SIMPLE_UTTERANCE) {
    return typeof request.command === 'string' && typeof request.original_utterance === 'string';
  }

  if (request.type === ALICE_REQUEST_TYPE_BUTTON_PRESSED || request.type === ALICE_REQUEST_TYPE_SHOW_PULL) {
    return true;
  }

  return false;
};

export const isAliceIncomingBody = (value: unknown): value is AliceIncomingBody => {
  if (!isAliceObject(value)) {
    return false;
  }

  if (!isAliceObject(value.meta) || !isAliceObject(value.session) || !isAliceObject(value.request)) {
    return false;
  }

  if (value.version !== ALICE_PROTOCOL_VERSION) {
    return false;
  }

  return isSessionValid(value.session) && isRequestValid(value.request);
};

export const isSimpleUtteranceRequest = (request: AliceRequest): request is AliceSimpleUtteranceRequest =>
  request.type === ALICE_REQUEST_TYPE_SIMPLE_UTTERANCE;
