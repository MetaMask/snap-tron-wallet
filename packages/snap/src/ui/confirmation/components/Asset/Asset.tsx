import { Box, Image, Text as SnapText } from '@metamask/snaps-sdk/jsx';
import QUESTION_MARK_SVG from '../../../../../images/question-mark.svg';

type AssetProps = {
  symbol: string;
  amount: string;
  iconSvg: string;
  showAmount?: boolean;
};

/**
 * Asset component for displaying assets with optional icon and amount.
 * Pure component with no business logic - just visual display.
 */
export const Asset = ({ 
  symbol, 
  amount, 
  iconSvg,  
}: AssetProps) => {
  return (
    <Box direction="horizontal" alignment="center">
      <Box alignment="center" center>
        <Image borderRadius="full" src={iconSvg} />
      </Box>
      <SnapText>
        {`${amount} ${symbol}`}
      </SnapText>
    </Box>
  );
};