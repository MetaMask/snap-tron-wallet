import type { FC } from 'react';

type TronLogoProps = {
  size?: number;
};

export const TronLogo: FC<TronLogoProps> = ({ size = 60 }) => {
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: '#ff6b35',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 'bold',
        fontSize: size * 0.3,
      }}
    >
      TRX
    </div>
  );
};
