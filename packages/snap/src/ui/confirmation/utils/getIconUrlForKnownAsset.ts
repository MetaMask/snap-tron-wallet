import { TokenMetadata } from "../../../constants";
import QUESTION_MARK_SVG from '../../../../images/question-mark.svg';


/**
 * Resolves iconUrl for a given asset type.
 * This should only be called with the asset types that are in TokenMetadata constants.
 */
export const getIconUrlForKnownAsset = (assetType: string): string | undefined => {
  if (assetType in TokenMetadata) {
    return TokenMetadata[assetType as keyof typeof TokenMetadata].iconUrl;
  }
  return undefined;
};