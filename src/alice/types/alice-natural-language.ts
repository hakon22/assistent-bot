export interface AliceNamedEntityTokenRange {
  start: number;
  end: number;
}

export interface AliceNamedEntity {
  tokens: AliceNamedEntityTokenRange;
  type: string;
  value: unknown;
}

export interface AliceRequestNaturalLanguage {
  tokens?: string[];
  entities?: AliceNamedEntity[];
  intents?: { [intentName: string]: unknown; };
}
