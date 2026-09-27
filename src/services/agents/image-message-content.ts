export type OrderedImageMessageContentPart =
  | { type: 'text'; text: string; }
  | { type: 'image_url'; image_url: { url: string; }; };

const formatAttachedImageCount = (imageCount: number): string => {
  const lastTwoDigits = imageCount % 100;
  const lastDigit = imageCount % 10;

  if (lastDigit === 1 && lastTwoDigits !== 11) {
    return `${imageCount} изображение`;
  }

  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${imageCount} изображения`;
  }

  return `${imageCount} изображений`;
};

export const buildOrderedImageMessageContent = ({
  messageText,
  imageUrls,
  fileText,
}: {
  messageText: string;
  imageUrls: string[];
  fileText?: string;
}): OrderedImageMessageContentPart[] => {
  const textParts = [messageText];

  if (fileText?.trim()) {
    textParts.push(`[Файл]:\n${fileText.substring(0, 3000)}`);
  }

  textParts.push(
    `Прикреплено ${formatAttachedImageCount(imageUrls.length)}; нумерация ниже соответствует порядку в альбоме.`,
  );

  const content: OrderedImageMessageContentPart[] = [
    { type: 'text', text: textParts.join('\n\n') },
  ];

  for (const [index, imageUrl] of imageUrls.entries()) {
    content.push({ type: 'text', text: `Фото ${index + 1}:` });
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  return content;
};
