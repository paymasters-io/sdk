import { BigNumber, Signer, providers, utils, constants, VoidSigner, ethers, Contract, ContractFactory } from "ethers";
import { UserOperationStruct } from "@account-abstraction/contracts";
import { NotPromise } from "@account-abstraction/utils";
import { NATIVE_ASSET, ORACLE, ORACLES, TOKEN_ADDRESS } from "../constants";
import { TransactionRequest } from "@ethersproject/abstract-provider";
import ABI__BYTECODE from "./erc20_paymaster.json";

export type SupportedERC20 = "USDC";

export enum Blockchains {
  BASE = 8453,
}

export class ERC20ApprovalError extends Error {}

export interface PaymasterBuildOptions {
  entrypoint?: string;
  nativeAsset?: string;
  nativeAssetOracle?: string;
  tokenAddress?: string;
  tokenOracle?: string;
  owner?: string;
  deployer?: Signer;
}

async function validatePaymasterOptions(
  provider: providers.Provider,
  erc20: SupportedERC20,
  oracle: ORACLE,
  options?: PaymasterBuildOptions
): Promise<Required<Omit<PaymasterBuildOptions, "deployer">>> {
  const parsedOptions = options ?? {};
  const entrypoint = parsedOptions.entrypoint ?? "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

  if (parsedOptions.owner === undefined) {
    throw new Error("Owner must be provided");
  }

  if (parsedOptions.deployer === undefined) {
    throw new Error("Deployer must be provided");
  }

  const chainId = (await provider.getNetwork()).chainId;
  const nativeAsset = options?.nativeAsset ?? NATIVE_ASSET[chainId];
  if (!nativeAsset) {
    throw new Error(`Native asset not found - chainId ${chainId} not supported`);
  }

  const nativeAssetOracle = options?.nativeAssetOracle ?? ORACLES[oracle][chainId][nativeAsset];
  if (!nativeAssetOracle) {
    throw new Error(`Native asset oracle not found - chainId ${chainId} not supported`);
  }
  await provider.getCode(nativeAssetOracle).then((code) => {
    if (code === "0x") {
      throw new Error(`Oracle for ${nativeAsset} on chainId ${chainId} is not deployed`);
    }
  });

  const tokenAddress = options?.tokenAddress ?? TOKEN_ADDRESS[chainId][erc20];
  if (!tokenAddress) {
    throw new Error(`Token ${erc20} not supported on chainId ${chainId}`);
  }
  await provider.getCode(tokenAddress).then((code) => {
    if (code === "0x") {
      throw new Error(`Token ${erc20} on ${chainId} is not deployed`);
    }
  });

  const tokenOracle = options?.tokenOracle ?? ORACLES[oracle][chainId][erc20];
  if (!tokenOracle) {
    throw new Error(`Oracle for ${erc20} not found, not supported on chainId ${chainId}`);
  }
  await provider.getCode(tokenOracle).then((code) => {
    if (code === "0x") {
      throw new Error(`Oracle for ${erc20} on ${chainId} is not deployed`);
    }
  });

  return {
    entrypoint,
    nativeAsset,
    nativeAssetOracle,
    tokenAddress,
    tokenOracle,
    owner: parsedOptions.owner,
  };
}

export function getPaymasterConstructor(
  options: Required<Omit<Omit<PaymasterBuildOptions, "nativeAsset">, "deployer">>
): string {
  const constructorArgs = [
    options.tokenAddress,
    options.entrypoint,
    options.tokenOracle,
    options.nativeAssetOracle,
    options.owner,
  ];
  const paymasterConstructor = new utils.Interface(ABI__BYTECODE.abi).encodeDeploy(constructorArgs);
  return utils.hexlify(utils.concat([ABI__BYTECODE.bytecode, paymasterConstructor]));
}

/**
 *
 * @param provider provider to use
 * @param erc20 ERC20 token to use
 * @param options (optional) options to use to calculate the deterministic address
 * @returns the ERC20Paymaster object
 */
export async function getERC20Paymaster(
  provider: providers.Provider,
  erc20: SupportedERC20,
  oracle: ORACLE,
  options?: Omit<Omit<PaymasterBuildOptions, "nativeAsset">, "deployer">
): Promise<ERC20Paymaster> {
  let parsedOptions: Required<Omit<Omit<PaymasterBuildOptions, "nativeAsset">, "deployer">>;

  if (options === undefined) {
    const chainId = (await provider.getNetwork()).chainId;

    parsedOptions = {
      entrypoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      nativeAssetOracle: ORACLES[oracle][chainId][NATIVE_ASSET[chainId]],
      tokenAddress: TOKEN_ADDRESS[chainId][erc20],
      tokenOracle: ORACLES[oracle][chainId][erc20],
      owner: "", // paymasters.io address
    };
  } else {
    parsedOptions = await validatePaymasterOptions(provider, erc20, oracle, options);
  }

  const address = await calculateERC20PaymasterAddress(parsedOptions);
  if ((await provider.getCode(address)).length <= 2) {
    throw new Error(`ERC20Paymaster not deployed at ${address}`);
  }
  return new ERC20Paymaster(provider, address);
}

export async function calculateERC20PaymasterAddress(
  options: Required<Omit<Omit<PaymasterBuildOptions, "nativeAsset">, "deployer">>
): Promise<string> {
  const address = utils.getCreate2Address(
    "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    utils.keccak256(getPaymasterConstructor(options))
  );

  return address;
}

export class ERC20Paymaster {
  public contract: Contract;

  constructor(provider: providers.Provider, paymasterAddress: string) {
    const voidSigner = new VoidSigner(constants.AddressZero, provider);
    this.contract = new ContractFactory(ABI__BYTECODE.abi, ABI__BYTECODE.bytecode, voidSigner).attach(paymasterAddress);
  }

  /**
   * @dev Verifies that the user has approved enough tokens for the UserOperation
   * @param userOp the user operation to use to verify the token approval
   */
  async verifyTokenApproval(userOp: NotPromise<UserOperationStruct>): Promise<void> {
    const token = await this.contract.token();
    const tokenAmountRequired = await this.calculateTokenAmount(userOp);
    const tokenContract = new ethers.Contract(
      token,
      ["function allowance(address,address) view returns (uint256)"],
      this.contract.signer
    );
    const allowance = await tokenContract.allowance(userOp.sender, this.contract.address);
    if (allowance.lt(tokenAmountRequired)) {
      throw new ERC20ApprovalError(`ERC20Paymaster: token allowance not enough: ${allowance} < ${tokenAmountRequired}`);
    }
  }

  /**
   * @dev Calculates the token amount required for the UserOperation, setting a reasonable max price for the token
   *
   * @param userOp the user operation to calculate the token amount for (with gas limits already set)
   * @returns the recommend token price to set during paymaster execution
   */
  async calculateTokenAmount(userOp: NotPromise<UserOperationStruct>): Promise<BigNumber> {
    const priceMarkup = await this.contract.priceMarkup();
    const cachedPrice = await this.contract.previousPrice();
    if (cachedPrice.eq(0)) {
      throw new Error("ERC20Paymaster: no previous price set");
    }

    const requiredPreFund = BigNumber.from(userOp.preVerificationGas)
      .add(BigNumber.from(userOp.verificationGasLimit).mul(3)) // 3 is for buffer when using paymaster
      .add(BigNumber.from(userOp.callGasLimit))
      .mul(BigNumber.from(userOp.maxFeePerGas));

    const tokenAmount = requiredPreFund
      .add(BigNumber.from(userOp.maxFeePerGas).mul(40000)) // 40000 is the REFUND_POSTOP_COST constant
      .mul(priceMarkup)
      .mul(cachedPrice)
      .div(BigNumber.from(10).pow(18))
      .div(1e6); // 1e6 is the priceDenominator constant

    return tokenAmount;
  }

  /**
   * @dev Generates the paymaster and data for the UserOperation, setting a reasonable max price for the token
   *
   * @param userOp the UserOperation to generate the paymasterAndData for (with gas limits already set)
   * @returns the paymasterAndData to be filled in
   */
  async generatePaymasterAndData(userOp: NotPromise<UserOperationStruct>): Promise<string> {
    const tokenAmount = await this.calculateTokenAmount(userOp);
    const paymasterAndData = utils.hexlify(
      utils.concat([this.contract.address, utils.hexZeroPad(utils.hexlify(tokenAmount), 32)])
    );
    return paymasterAndData;
  }
}
