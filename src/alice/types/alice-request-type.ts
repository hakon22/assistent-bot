export const ALICE_REQUEST_TYPE_SIMPLE_UTTERANCE = 'SimpleUtterance' as const;

export const ALICE_REQUEST_TYPE_BUTTON_PRESSED = 'ButtonPressed' as const;

export const ALICE_REQUEST_TYPE_SHOW_PULL = 'Show.Pull' as const;

export type AliceRequestType =
  | typeof ALICE_REQUEST_TYPE_SIMPLE_UTTERANCE
  | typeof ALICE_REQUEST_TYPE_BUTTON_PRESSED
  | typeof ALICE_REQUEST_TYPE_SHOW_PULL;
