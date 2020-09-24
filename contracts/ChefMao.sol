// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import '@openzeppelin/contracts/math/SafeMath.sol';
import '@uniswap/v2-periphery/contracts/libraries/UniswapV2OracleLibrary.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './IYuanYangPot.sol';

contract ChefMao {
	using SafeMath for uint256;

	modifier onlyGov() {
		require(msg.sender == gov, 'onlyGov: caller is not gov');
		_;
	}
	// an event emitted when deviationThreshold is changed
	event NewDeviationThreshold(uint256 oldDeviationThreshold, uint256 newDeviationThreshold);

	// an event emitted when deviationMovement is changed
	event NewDeviationMovement(uint256 oldDeviationMovement, uint256 newDeviationMovement);

	// Event emitted when pendingGov is changed
	event NewPendingGov(address oldPendingGov, address newPendingGov);

	// Event emitted when gov is changed
	event NewGov(address oldGov, address newGov);

	// Governance address
	address public gov;

	// Pending Governance address
	address public pendingGov;

	// Peg target
	uint256 public targetPrice;

	// POT Tokens created per block at inception.
	// POT's inflation will eventually be governed by targetStock2Flow.
	uint256 public farmHotpotBasePerBlock;

	// Halving period for Hotpot Base per block, in blocks.
	uint256 public halfLife = 88888;

	// targetTokenPerBlock = totalSupply / (targetStock2Flow * 2,400,000)
	// 2,400,000 is ~1-year's ETH block count as of Sep 2020
	// See @100trillionUSD's article below on Scarcity and S2F:
	// https://medium.com/@100trillionUSD/modeling-bitcoins-value-with-scarcity-91fa0fc03e25
	//
	// Ganularity of targetStock2Flow is intentionally restricted.
	uint256 public targetStock2Flow = 10; // ~10% p.a. target inflation;

	// If the current price is within this fractional distance from the target, no supply
	// update is performed. Fixed point number--same format as the price.
	// (ie) abs(price - targetPrice) / targetPrice < deviationThreshold, then no supply change.
	uint256 public deviationThreshold = 5e16; // 5%

	uint256 public deviationMovement = 5e16; // 5%

	// More than this much time must pass between rebase operations.
	uint256 public minRebaseTimeIntervalSec = 24 hours;

	// Block timestamp of last rebase operation
	uint256 public lastRebaseTimestamp;

	// The rebase window begins this many seconds into the minRebaseTimeInterval period.
	// For example if minRebaseTimeInterval is 24hrs, it represents the time of day in seconds.
	uint256 public rebaseWindowOffsetSec = 28800; // 8am/8pm UTC rebases

	// The length of the time window where a rebase operation is allowed to execute, in seconds.
	uint256 public rebaseWindowLengthSec = 3600; // 60 minutes

	// The number of rebase cycles since inception
	uint256 public epoch;

	// The number of halvings since inception
	uint256 public halvingCounter;

	// The number of consecutive upward threshold breaching when rebasing.
	uint256 public upwardCounter;

	// The number of consecutive downward threshold breaching when rebasing.
	uint256 public downwardCounter;

	uint256 public retargetThreshold = 2; // 2 days

	// rebasing is not active initially. It can be activated at T+12 hours from
	// deployment time

	// boolean showing rebase activation status
	bool public rebasingActive;

	// delays rebasing activation to facilitate liquidity
	uint256 public constant rebaseDelay = 12 hours;

	// Time of TWAP initialization
	uint256 public timeOfTwapInit;

	// pair for reserveToken <> POT
	address public uniswapPair;

	// last TWAP update time
	uint32 public blockTimestampLast;

	// last TWAP cumulative price;
	uint256 public priceCumulativeLast;

	// Whether or not this token is first in uniswap POT<>Reserve pair
	// address of USDT:
	// address of POT:
	bool public isToken0 = true;

	IYuanYangPot public masterPot;

	constructor(
		IYuanYangPot _masterPot,
		address _uniswapPair,
		address _gov,
		uint256 _targetPrice,
		bool _isToken0
	) public {
		masterPot = _masterPot;
		farmHotpotBasePerBlock = masterPot.hotpotBasePerBlock();
		uniswapPair = _uniswapPair;
		gov = _gov;
		targetPrice = _targetPrice;
		isToken0 = _isToken0;
	}

	// sets the pendingGov
	function setPendingGov(address _pendingGov) external onlyGov {
		address oldPendingGov = pendingGov;
		pendingGov = _pendingGov;
		emit NewPendingGov(oldPendingGov, _pendingGov);
	}

	// lets msg.sender accept governance
	function acceptGov() external {
		require(msg.sender == pendingGov, 'acceptGov: !pending');
		address oldGov = gov;
		gov = pendingGov;
		pendingGov = address(0);
		emit NewGov(oldGov, gov);
	}

	// Initializes TWAP start point, starts countdown to first rebase
	function initTwap() public onlyGov {
		require(timeOfTwapInit == 0, 'initTwap: already activated');
		(
			uint256 price0Cumulative,
			uint256 price1Cumulative,
			uint32 blockTimestamp
		) = UniswapV2OracleLibrary.currentCumulativePrices(uniswapPair);
		priceCumulativeLast = isToken0 ? price0Cumulative : price1Cumulative;
		require(priceCumulativeLast > 0, 'initTwap: no trades');
		blockTimestampLast = blockTimestamp;
		timeOfTwapInit = blockTimestamp;
	}

	// @notice Activates rebasing
	// @dev One way function, cannot be undone, callable by anyone
	function activateRebasing() public {
		require(timeOfTwapInit > 0, 'activateRebasing: twap wasnt intitiated, call init_twap()');
		// cannot enable prior to end of rebaseDelay
		require(getNow() >= timeOfTwapInit + rebaseDelay, 'activateRebasing: !end_delay');

		rebasingActive = true;
	}

	// If the latest block timestamp is within the rebase time window it, returns true.
	// Otherwise, returns false.
	function inRebaseWindow() public view returns (bool) {
		// rebasing is delayed until there is a liquid market
		require(rebasingActive, 'inRebaseWindow: rebasing not active');
		uint256 nowTimestamp = getNow();
		require(
			nowTimestamp.mod(minRebaseTimeIntervalSec) >= rebaseWindowOffsetSec,
			'inRebaseWindow: too early'
		);
		require(
			nowTimestamp.mod(minRebaseTimeIntervalSec) <
				(rebaseWindowOffsetSec.add(rebaseWindowLengthSec)),
			'inRebaseWindow: too late'
		);
		return true;
	}

	/**
	 * @notice Initiates a new rebase operation, provided the minimum time period has elapsed.
	 *
	 * @dev The supply adjustment equals (_totalSupply * DeviationFromTargetRate) / rebaseLag
	 *      Where DeviationFromTargetRate is (MarketOracleRate - targetPrice) / targetPrice
	 *      and targetPrice is 1e18
	 */
	function rebase() public {
		// no possibility of reentry as this function only invoke view functions or internal functions
		// or functions from master pot which also only invoke only invoke view functions or internal functions
		// EOA only
		// require(msg.sender == tx.origin);
		// ensure rebasing at correct time
		inRebaseWindow();

		uint256 nowTimestamp = getNow();
		// This comparison also ensures there is no reentrancy.
		require(
			lastRebaseTimestamp.add(minRebaseTimeIntervalSec) < nowTimestamp,
			'rebase: Rebase already triggered'
		);

		// Snap the rebase time to the start of this window.
		lastRebaseTimestamp = nowTimestamp.sub(nowTimestamp.mod(minRebaseTimeIntervalSec)).add(
			rebaseWindowOffsetSec
		);

		// no safe math required
		epoch++;

		// Get twap from uniswapv2.
		(uint256 priceCumulative, uint32 blockTimestamp, uint256 twap) = getCurrentTwap();
		priceCumulativeLast = priceCumulative;
		blockTimestampLast = blockTimestamp;

		bool inCircuitBreaker = false;
		(
			uint256 newHotpotBasePerBlock,
			uint256 newFarmHotpotBasePerBlock,
			uint256 newHalvingCounter
		) = getNewHotpotBasePerBlock(twap);
		farmHotpotBasePerBlock = newFarmHotpotBasePerBlock;
		halvingCounter = newHalvingCounter;
		uint256 newRedShare = getNewRedShare(twap);

		// Do a bunch of things if twap is outside of threshold.
		if (!withinDeviationThreshold(twap)) {
			uint256 absoluteDeviationMovement = targetPrice.mul(deviationMovement).div(1e18);

			// Calculates and sets the new target rate if twap is outside of threshold.
			if (twap > targetPrice) {
				// no safe math required
				upwardCounter++;
				if (downwardCounter > 0) {
					downwardCounter = 0;
				}
				// if twap continues to go up, retargetThreshold is only effective for the first upward retarget
				// and every following rebase would retarget upward until twap is within deviation threshold
				if (upwardCounter >= retargetThreshold) {
					targetPrice = targetPrice.add(absoluteDeviationMovement);
				}
			} else {
				inCircuitBreaker = true;
				// no safe math required
				downwardCounter++;
				if (upwardCounter > 0) {
					upwardCounter = 0;
				}
				// if twap continues to go down, retargetThreshold is only effective for the first downward retarget
				// and every following rebase would retarget downward until twap is within deviation threshold
				if (downwardCounter >= retargetThreshold) {
					targetPrice = targetPrice.sub(absoluteDeviationMovement);
				}
			}
		} else {
			upwardCounter = 0;
			downwardCounter = 0;
		}

		masterPot.massUpdatePools();
		masterPot.setHotpotBasePerBlock(newHotpotBasePerBlock);
		masterPot.setRedPotShare(newRedShare);
		masterPot.setCircuitBreaker(inCircuitBreaker);
	}

	/**
	 * @notice Calculates TWAP from uniswap
	 *
	 * @dev When liquidity is low, this can be manipulated by an end of block -> next block
	 *      attack. We delay the activation of rebases 12 hours after liquidity incentives
	 *      to reduce this attack vector. Additional there is very little supply
	 *      to be able to manipulate this during that time period of highest vuln.
	 */
	function getCurrentTwap()
		public
		virtual
		view
		returns (
			uint256 priceCumulative,
			uint32 blockTimestamp,
			uint256 twap
		)
	{
		(
			uint256 price0Cumulative,
			uint256 price1Cumulative,
			uint32 blockTimestampUniswap
		) = UniswapV2OracleLibrary.currentCumulativePrices(uniswapPair);
		priceCumulative = isToken0 ? price0Cumulative : price1Cumulative;
		blockTimestamp = blockTimestampUniswap;
		uint32 timeElapsed = blockTimestamp - blockTimestampLast; // overflow is desired

		// no period check as is done in isRebaseWindow

		// overflow is desired, casting never truncates
		// cumulative price is in (uq112x112 price * seconds) units so we simply wrap it after division by time elapsed
		FixedPoint.uq112x112 memory priceAverage = FixedPoint.uq112x112(
			uint224((priceCumulative - priceCumulativeLast) / timeElapsed)
		);
		// 1e30 for trading pair with 6-decimal tokens. Be ultra-cautious when changing this.
		twap = FixedPoint.decode144(FixedPoint.mul(priceAverage, 1e30));
	}

	// Computes new tokenPerBlock based on price.
	function getNewHotpotBasePerBlock(uint256 price)
		public
		view
		returns (
			uint256 newHotpotBasePerBlock,
			uint256 newFarmHotpotBasePerBlock,
			uint256 newHalvingCounter
		)
	{
		uint256 blockElapsed = getBlockNumber().sub(masterPot.startBlock());
		newHalvingCounter = blockElapsed.div(halfLife);
		newFarmHotpotBasePerBlock = farmHotpotBasePerBlock;

		// if new halvingCounter is larger than old one, perform halving.
		if (newHalvingCounter > halvingCounter) {
			newFarmHotpotBasePerBlock = newFarmHotpotBasePerBlock.div(2);
		}

		// computes newHotpotBasePerBlock based on targetStock2Flow.
		newHotpotBasePerBlock = masterPot.hotpotBaseTotalSupply().div(
			targetStock2Flow.mul(2400000)
		);

		// use the larger of newHotpotBasePerBlock and newFarmHotpotBasePerBlock.
		newHotpotBasePerBlock = newHotpotBasePerBlock > newFarmHotpotBasePerBlock
			? newHotpotBasePerBlock
			: newFarmHotpotBasePerBlock;

		if (price > targetPrice) {
			newHotpotBasePerBlock = newHotpotBasePerBlock.mul(price).div(targetPrice);
		} else {
			newHotpotBasePerBlock = newHotpotBasePerBlock.mul(targetPrice).div(price);
		}
	}

	// Computes new redShare based on price.
	function getNewRedShare(uint256 price) public view returns (uint256) {
		return uint256(1e24).div(price.mul(1e12).div(targetPrice).add(1e12));
	}

	// Check if the current price is within the deviation threshold for rebasing.
	function withinDeviationThreshold(uint256 price) public view returns (bool) {
		uint256 absoluteDeviationThreshold = targetPrice.mul(deviationThreshold).div(1e18);
		return
			(price >= targetPrice && price.sub(targetPrice) < absoluteDeviationThreshold) ||
			(price < targetPrice && targetPrice.sub(price) < absoluteDeviationThreshold);
	}

	/**
	 * @notice Sets the deviation threshold fraction. If the exchange rate given by the market
	 *         oracle is within this fractional distance from the targetPrice, then no supply
	 *         modifications are made.
	 * @param _deviationThreshold The new exchange rate threshold fraction.
	 */
	function setDeviationThreshold(uint256 _deviationThreshold) external onlyGov {
		require(_deviationThreshold > 0, 'deviationThreshold: too low');
		uint256 oldDeviationThreshold = deviationThreshold;
		deviationThreshold = _deviationThreshold;
		emit NewDeviationThreshold(oldDeviationThreshold, _deviationThreshold);
	}

	function setDeviationMovement(uint256 _deviationMovement) external onlyGov {
		require(_deviationMovement > 0, 'deviationMovement: too low');
		uint256 oldDeviationMovement = deviationMovement;
		deviationMovement = _deviationMovement;
		emit NewDeviationMovement(oldDeviationMovement, _deviationMovement);
	}

	// Sets the retarget threshold parameter, Gov only.
	function setRetargetThreshold(uint256 _retargetThreshold) external onlyGov {
		require(_retargetThreshold > 0, 'retargetThreshold: too low');
		retargetThreshold = _retargetThreshold;
	}

	// Overwrites the target stock-to-flow ratio, Gov only.
	function setTargetStock2Flow(uint256 _targetStock2Flow) external onlyGov {
		require(_targetStock2Flow > 0, 'targetStock2Flow: too low');
		targetStock2Flow = _targetStock2Flow;
	}

	/**
     * @notice Sets the parameters which control the timing and frequency of
     *         rebase operations.
     *         a) the minimum time period that must elapse between rebase cycles.
     *         b) the rebase window offset parameter.
     *         c) the rebase window length parameter.
     * @param _minRebaseTimeIntervalSec More than this much time must pass between rebase
     *        operations, in seconds.
     * @param _rebaseWindowOffsetSec The number of seconds from the beginning of
              the rebase interval, where the rebase window begins.
     * @param _rebaseWindowLengthSec The length of the rebase window in seconds.
     */
	function setRebaseTimingParameters(
		uint256 _minRebaseTimeIntervalSec,
		uint256 _rebaseWindowOffsetSec,
		uint256 _rebaseWindowLengthSec
	) external onlyGov {
		require(_minRebaseTimeIntervalSec > 0, 'minRebaseTimeIntervalSec: too low');
		require(
			_rebaseWindowOffsetSec < _minRebaseTimeIntervalSec,
			'rebaseWindowOffsetSec: too high'
		);

		minRebaseTimeIntervalSec = _minRebaseTimeIntervalSec;
		rebaseWindowOffsetSec = _rebaseWindowOffsetSec;
		rebaseWindowLengthSec = _rebaseWindowLengthSec;
	}

	// Passthrough function to add pool.
	function addPool(
		uint256 _allocPoint,
		IERC20 _lpToken,
		bool _isRed,
		bool _withUpdate
	) public onlyGov {
		masterPot.addPool(_allocPoint, _lpToken, _isRed, _withUpdate);
	}

	// Passthrough function to set pool.
	function setPool(
		uint256 _pid,
		uint256 _allocPoint,
		bool _withUpdate
	) public onlyGov {
		masterPot.setPool(_pid, _allocPoint, _withUpdate);
	}

	// Passthrough function to set tip rate.
	function setTipRate(uint256 _tipRate) public onlyGov {
		masterPot.setTipRate(_tipRate);
	}

	// Passthrough function to transfer pot ownership.
	function transferPotOwnership(address newOwner) public onlyGov {
		masterPot.transferPotOwnership(newOwner);
	}

	function getNow() public virtual view returns (uint256) {
		return now;
	}

	function getBlockNumber() public virtual view returns (uint256) {
		return block.number;
	}
}
