export const TOKEN_ADDRESS: Record<number, Record<string, string>> = {
  84531: {
    USDC: "0x1B85deDe8178E18CdE599B4C9d913534553C3dBf",
  },
};

export const NATIVE_ASSET: Record<number, string> = {
  84531: "ETH",
};

export enum ORACLE {
  CHAINLINK = "CHAINLINK",
  SUPRA = "SUPRA",
  API3DAO = "API3DAO",
}

type Oracles = Record<number, Record<string, string>>;

export const CHAINLINK_ORACLES: Oracles = {
  84531: {
    ETH: "0xcD2A119bD1F7DF95d706DE6F2057fDD45A0503E2",
    USDC: "0xb85765935B4d9Ab6f841c9a00690Da5F34368bc0",
  },
};

export const SUPRA_ORACLES: Oracles = {
  84531: {
    ETH: "0x8ea968763f6E8398fAe711Fa37978E4E37244122:19",
    USDC: "0x8ea968763f6E8398fAe711Fa37978E4E37244122:89",
  },
};
export const API3DAO_ORACLES: Oracles = {
  84531: {
    ETH: "0x26690F9f17FdC26D419371315bc17950a0FC90eD",
    USDC: "0x8DF7d919Fe9e866259BB4D135922c5Bd96AF6A27",
  },
};

export const ORACLES: Record<ORACLE, Oracles> = {
  CHAINLINK: CHAINLINK_ORACLES,
  SUPRA: SUPRA_ORACLES,
  API3DAO: API3DAO_ORACLES,
};
