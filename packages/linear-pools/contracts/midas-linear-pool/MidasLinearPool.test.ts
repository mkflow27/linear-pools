import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import LinearPool from '@balancer-labs/v2-helpers/src/models/pools/linear/LinearPool';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { FundManagement, SingleSwap } from '@balancer-labs/balancer-js/src';

describe('MidasLinearPool', function () {
  let poolFactory: Contract;
  let lp: SignerWithAddress, owner: SignerWithAddress;
  let vault: Vault;
  let funds: FundManagement;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);

  before('setup', async () => {
    [, lp, owner] = await ethers.getSigners();

    funds = {
      sender: lp.address,
      fromInternalBalance: false,
      toInternalBalance: false,
      recipient: lp.address,
    };
  });

  sharedBeforeEach('deploy vault & pool factory', async () => {
    vault = await Vault.create();
    const queries = await deploy('v2-standalone-utils/BalancerQueries', { args: [vault.address] });
    poolFactory = await deploy('MidasLinearPoolFactory', {
      args: [vault.address, vault.getFeesProvider().address, queries.address, '1.0', '1.0'],
    });
  });

  async function deployPool(mainTokenAddress: string, wrappedTokenAddress: string) {
    const tx = await poolFactory.create(
      'Linear pool',
      'BPT',
      mainTokenAddress,
      wrappedTokenAddress,
      fp(1_000_000),
      POOL_SWAP_FEE_PERCENTAGE,
      owner.address
    );

    const receipt = await tx.wait();
    const event = expectEvent.inReceipt(receipt, 'PoolCreated');

    return LinearPool.deployedAt(event.args.pool);
  }

  describe('usdc vault with 6 decimals tests', () => {
    let usdc: Token;
    let cUSDC: Token;
    let usdcCtoken: Contract;
    let bbcUSDC: LinearPool;

    sharedBeforeEach('setup tokens, cToken and linear pool', async () => {
      usdc = await Token.create({ symbol: 'USDC', name: 'USDC', decimals: 6 });
      usdcCtoken = await deploy('MockCToken', {
        args: ['cUSDC', 'cUSDC', 6, usdc.address, fp(1)],
      });
      cUSDC = await Token.deployedAt(usdcCtoken.address);

      bbcUSDC = await deployPool(usdc.address, cUSDC.address);
      const initialJoinAmount = bn(100000000000);
      await usdc.mint(lp, initialJoinAmount);
      await usdc.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbcUSDC.poolId,
        kind: 0,
        assetIn: usdc.address,
        assetOut: bbcUSDC.address,
        amount: BigNumber.from(100_000e6),
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return wrapped token rate scaled to 18 decimals for a 6 decimal token', async () => {
      await usdcCtoken.setExchangeRate(fp(1.5));
      expect(await bbcUSDC.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 0.800_000 cUSDC to 1 USDC when the exchangeRate is 1.25e18', async () => {
      await usdcCtoken.setExchangeRate(fp(1.25));
      // we try to rebalance it with some wrapped tokens
      const cUsdcAmount = bn(8e5);
      await cUSDC.mint(lp, cUsdcAmount);
      await cUSDC.approve(vault.address, cUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbcUSDC.poolId,
        kind: 0,
        assetIn: cUSDC.address,
        assetOut: usdc.address,
        amount: cUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);
      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);

      expect(amountReturned).to.be.eq(bn(1e6));
    });

    it('should swap 800 cUSDC to 1,000 USDC when the ppfs is 1.25e18', async () => {
      await usdcCtoken.setExchangeRate(fp(1.25));
      // we try to rebalance it with some wrapped tokens
      const cUsdcAmount = bn(8e8);
      await cUSDC.mint(lp, cUsdcAmount);
      await cUSDC.approve(vault.address, cUsdcAmount, { from: lp });

      const rebalanceSwapData: SingleSwap = {
        poolId: bbcUSDC.poolId,
        kind: 0,
        assetIn: cUSDC.address,
        assetOut: usdc.address,
        amount: cUsdcAmount,
        userData: '0x',
      };

      const balanceBefore = await usdc.balanceOf(lp.address);

      await vault.instance.connect(lp).swap(rebalanceSwapData, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await usdc.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(1e9);
    });
  });

  describe('DAI with 18 decimals tests', () => {
    let dai: Token;
    let cDAI: Token;
    let daiCToken: Contract;
    let bbcDAI: LinearPool;

    sharedBeforeEach('setup tokens, cToken and linear pool', async () => {
      dai = await Token.create({ symbol: 'DAI', name: 'DAI', decimals: 18 });
      daiCToken = await deploy('MockCToken', {
        args: ['cDAI', 'cDAI', 18, dai.address, fp(1)],
      });
      cDAI = await Token.deployedAt(daiCToken.address);

      bbcDAI = await deployPool(dai.address, cDAI.address);
      const initialJoinAmount = fp(100);
      await dai.mint(lp, initialJoinAmount);
      await dai.approve(vault.address, initialJoinAmount, { from: lp });

      const joinData: SingleSwap = {
        poolId: bbcDAI.poolId,
        kind: 0,
        assetIn: dai.address,
        assetOut: bbcDAI.address,
        amount: initialJoinAmount,
        userData: '0x',
      };

      const transaction = await vault.instance.connect(lp).swap(joinData, funds, BigNumber.from(0), MAX_UINT256);
      await transaction.wait();
    });

    it('should return unscaled wrapped token rate for an 18 decimal token', async () => {
      await daiCToken.setExchangeRate(fp(1.5));
      expect(await bbcDAI.getWrappedTokenRate()).to.be.eq(fp(1.5));
    });

    it('should swap 1 cDAI to 2 DAI when the pricePerFullShare is 2e18', async () => {
      await daiCToken.setExchangeRate(fp(2));

      const cDAIAmount = fp(1);
      await cDAI.mint(lp, cDAIAmount);
      await cDAI.approve(vault.address, cDAIAmount, { from: lp });

      const data: SingleSwap = {
        poolId: bbcDAI.poolId,
        kind: 0,
        assetIn: cDAI.address,
        assetOut: dai.address,
        amount: cDAIAmount,
        userData: '0x',
      };

      const balanceBefore = await dai.balanceOf(lp.address);
      await vault.instance.connect(lp).swap(data, funds, BigNumber.from(0), MAX_UINT256);
      const balanceAfter = await dai.balanceOf(lp.address);
      const amountReturned = balanceAfter.sub(balanceBefore);
      expect(amountReturned).to.be.eq(fp(2));
    });
  });
});