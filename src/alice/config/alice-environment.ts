export const parseAliceAllowedUserIds = (): string[] => {
  const rawValue = process.env.ALICE_ALLOWED_YANDEX_USER_IDS ?? '';

  return rawValue
    .split(',')
    .map(userId => userId.trim())
    .filter(Boolean);
};
