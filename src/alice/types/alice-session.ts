export interface AliceSessionUser {
  user_id: string;
  access_token?: string;
}

export interface AliceApplication {
  application_id: string;
}

export interface AliceSession {
  message_id: number;
  session_id: string;
  skill_id: string;
  user_id?: string;
  user?: AliceSessionUser;
  application?: AliceApplication;
  new: boolean;
}
