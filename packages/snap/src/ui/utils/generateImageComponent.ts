import QUESTION_MARK_SVG from '../../../images/question-mark.svg';
import { getImageComponent } from '@metamask/snaps-sdk';

export function generateImageComponent(
    imageUrl?: string,
    width = 48,
    height = 48,
  ): string | Promise<string> {
    if (!imageUrl) {
      return QUESTION_MARK_SVG;
    }

    return getImageComponent(imageUrl, { width, height })
      .then((image) => image.value)
      .catch(() => QUESTION_MARK_SVG);
  };