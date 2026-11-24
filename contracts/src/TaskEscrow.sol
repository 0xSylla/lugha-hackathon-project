// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice EIP-3009 (USDC-style) signed transfers. tUSD8 on Aevum implements this.
/// @dev Interface taken from qday-io/aevum-starter-kit (MIT, PQA Labs), contracts/src/Checkout.sol.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title TaskEscrow
/// @notice Holds a requester's budget for a data task and pays workers in tUSD8, one accepted answer at a time.
///
/// Who can do what:
/// - The requester funds the task and keeps control of it: they can pause it, withhold a payment during its
///   hold, top it up, and close it to take back whatever is not owed to anyone.
/// - The operator (the app's server) records accepted answers. It can only pay the task's fixed rates, never
///   more than the per-worker cap, never beyond the budget, and it can never send money to itself or the
///   requester: payments go to the worker named in the claim.
/// - Anyone can release a payment once its hold has passed, so workers never depend on the app to get paid
///   and never need gas: the app, a relayer or the worker can submit the release.
contract TaskEscrow {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Held,
        Paid,
        Withheld
    }

    struct Task {
        address requester;
        address operator;
        uint128 reward; // per accepted answer
        uint128 reviewReward; // per verified recording (0 = no review work)
        uint128 maxPerWorker; // cap on what one worker can earn from this task
        uint128 available; // budget not yet promised to anyone
        uint128 held; // promised to workers, waiting for the hold to end
        uint64 holdSecs;
        bool paused;
        bool closed;
    }

    /// @notice What the requester agrees to when funding a task.
    struct Terms {
        address operator;
        uint128 reward;
        uint128 reviewReward;
        uint128 maxPerWorker;
        uint64 holdSecs;
    }

    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct Claim {
        bytes32 taskId;
        address worker;
        uint128 amount;
        uint64 releaseAt;
        Status status;
    }

    uint64 public constant MAX_HOLD = 7 days;

    IERC20 public immutable token;

    mapping(bytes32 taskId => Task) private _tasks;
    mapping(bytes32 claimId => Claim) private _claims;
    /// @notice Held + paid amounts per worker per task, checked against `maxPerWorker`.
    mapping(bytes32 taskId => mapping(address worker => uint256)) public earned;
    /// @notice Latest dataset fingerprint (SHA-256 of the export) per task.
    mapping(bytes32 taskId => bytes32) public datasetHash;

    event TaskCreated(
        bytes32 indexed taskId,
        address indexed requester,
        address operator,
        uint256 reward,
        uint256 reviewReward,
        uint256 maxPerWorker,
        uint64 holdSecs,
        uint256 budget
    );
    event Funded(bytes32 indexed taskId, address indexed from, uint256 amount);
    event Accrued(bytes32 indexed claimId, bytes32 indexed taskId, address indexed worker, uint256 amount, uint64 releaseAt);
    event Withheld(bytes32 indexed claimId, bytes32 indexed taskId, address by);
    event Released(bytes32 indexed claimId, bytes32 indexed taskId, address indexed worker, uint256 amount);
    event Paused(bytes32 indexed taskId, bool paused);
    event Closed(bytes32 indexed taskId, uint256 refunded);
    event DatasetAnchored(bytes32 indexed taskId, bytes32 sha256, address by);

    error TaskExists();
    error NoTask();
    error NotRequester();
    error NotOperator();
    error NotAllowed();
    error BadTerms();
    error TaskInactive();
    error LengthMismatch();
    error AlreadyClaimed(bytes32 claimId);
    error BadAmount(uint256 amount);
    error OverWorkerCap(address worker);
    error OverBudget();
    error ZeroAddress();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ------------------------------------------------------------------ requester

    /// @notice Create a task and fund it from tokens approved to this contract.
    function createTask(bytes32 taskId, Terms calldata terms, uint128 budget) external {
        _create(taskId, msg.sender, terms, budget);
        token.safeTransferFrom(msg.sender, address(this), budget);
    }

    /// @notice Create a task with an EIP-3009 signature from `requester`, so the requester needs no gas.
    /// @dev The signed nonce must be `createNonce(taskId, requester, terms)`, which covers every term of the task.
    ///      A relayer that changes the operator, the rates, the cap or the hold gets a different nonce and the
    ///      transfer fails.
    function createTaskWithAuthorization(
        bytes32 taskId,
        address requester,
        Terms calldata terms,
        uint128 budget,
        Authorization calldata auth
    ) external {
        _create(taskId, requester, terms, budget);
        IERC3009(address(token)).receiveWithAuthorization(
            requester,
            address(this),
            budget,
            auth.validAfter,
            auth.validBefore,
            createNonce(taskId, requester, terms),
            auth.v,
            auth.r,
            auth.s
        );
    }

    /// @notice The EIP-3009 nonce a requester signs to create a task through this contract.
    function createNonce(bytes32 taskId, address requester, Terms calldata terms) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), taskId, requester, terms));
    }

    /// @notice Add budget to an open task. Anyone can top up; the money can only go to workers or back to the requester.
    function fund(bytes32 taskId, uint128 amount) external {
        Task storage t = _open(taskId);
        if (amount == 0) revert BadAmount(0);
        t.available += amount;
        emit Funded(taskId, msg.sender, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function setPaused(bytes32 taskId, bool paused) external {
        Task storage t = _task(taskId);
        if (msg.sender != t.requester) revert NotRequester();
        if (t.closed) revert TaskInactive();
        t.paused = paused;
        emit Paused(taskId, paused);
    }

    /// @notice Stop the task and refund the budget nobody has earned. Payments still on hold stay owed to their
    ///         workers: they are released (or withheld) as usual.
    function close(bytes32 taskId) external {
        Task storage t = _task(taskId);
        if (msg.sender != t.requester) revert NotRequester();
        if (t.closed) revert TaskInactive();
        t.closed = true;
        uint128 refund = t.available;
        t.available = 0;
        emit Closed(taskId, refund);
        if (refund > 0) token.safeTransfer(t.requester, refund);
    }

    // ------------------------------------------------------------------ operator

    /// @notice Record accepted answers. Each payment is held for the task's hold time before it can be released.
    /// @param itemRefs One reference per answer (e.g. keccak of the item id). With the worker it makes the claim id,
    ///        so the same answer can never be paid twice.
    /// @param amounts Each must equal the task's `reward` or `reviewReward`.
    function accrue(bytes32 taskId, bytes32[] calldata itemRefs, address[] calldata workers, uint128[] calldata amounts)
        external
        returns (bytes32[] memory claimIds)
    {
        Task storage t = _open(taskId);
        if (msg.sender != t.operator) revert NotOperator();
        if (t.paused) revert TaskInactive();
        uint256 n = itemRefs.length;
        if (workers.length != n || amounts.length != n) revert LengthMismatch();

        claimIds = new bytes32[](n);
        uint64 releaseAt = uint64(block.timestamp) + t.holdSecs;
        for (uint256 i; i < n; ++i) {
            claimIds[i] = _accrueOne(t, taskId, itemRefs[i], workers[i], amounts[i], releaseAt);
        }
    }

    function _accrueOne(Task storage t, bytes32 taskId, bytes32 itemRef, address w, uint128 amount, uint64 releaseAt)
        private
        returns (bytes32 id)
    {
        if (w == address(0)) revert ZeroAddress();
        if (w == t.requester || w == t.operator) revert NotAllowed();
        if (amount == 0 || (amount != t.reward && amount != t.reviewReward)) revert BadAmount(amount);
        if (amount > t.available) revert OverBudget();
        if (earned[taskId][w] + amount > t.maxPerWorker) revert OverWorkerCap(w);

        id = claimId(taskId, itemRef, w);
        if (_claims[id].status != Status.None) revert AlreadyClaimed(id);

        t.available -= amount;
        t.held += amount;
        earned[taskId][w] += amount;
        _claims[id] = Claim({taskId: taskId, worker: w, amount: amount, releaseAt: releaseAt, status: Status.Held});
        emit Accrued(id, taskId, w, amount, releaseAt);
    }

    // ------------------------------------------------------------------ requester or operator

    /// @notice Cancel payments that are still on hold (e.g. a failed quality check). The money returns to the budget.
    function withhold(bytes32[] calldata claimIds) external {
        for (uint256 i; i < claimIds.length; ++i) {
            Claim storage c = _claims[claimIds[i]];
            if (c.status != Status.Held) continue;
            Task storage t = _tasks[c.taskId];
            if (msg.sender != t.requester && msg.sender != t.operator) revert NotAllowed();
            if (block.timestamp >= c.releaseAt) continue; // the hold is over: the worker is owed this payment
            c.status = Status.Withheld;
            t.held -= c.amount;
            earned[c.taskId][c.worker] -= c.amount;
            // On a closed task the budget was already refunded, so a withheld payment goes back to the requester.
            if (t.closed) token.safeTransfer(t.requester, c.amount);
            else t.available += c.amount;
            emit Withheld(claimIds[i], c.taskId, msg.sender);
        }
    }

    /// @notice Record the SHA-256 of a dataset export, so anyone can check a download came from this task.
    function anchorDataset(bytes32 taskId, bytes32 sha256Hash) external {
        Task storage t = _task(taskId);
        if (msg.sender != t.requester && msg.sender != t.operator) revert NotAllowed();
        datasetHash[taskId] = sha256Hash;
        emit DatasetAnchored(taskId, sha256Hash, msg.sender);
    }

    // ------------------------------------------------------------------ anyone

    /// @notice Pay out every listed claim whose hold is over. Claims that are not due are skipped, so a batch
    ///         never fails because of one entry. Returns how many were paid.
    function release(bytes32[] calldata claimIds) external returns (uint256 paid) {
        for (uint256 i; i < claimIds.length; ++i) {
            Claim storage c = _claims[claimIds[i]];
            if (c.status != Status.Held || block.timestamp < c.releaseAt) continue;
            c.status = Status.Paid;
            _tasks[c.taskId].held -= c.amount;
            ++paid;
            emit Released(claimIds[i], c.taskId, c.worker, c.amount);
            token.safeTransfer(c.worker, c.amount);
        }
    }

    // ------------------------------------------------------------------ views

    function claimId(bytes32 taskId, bytes32 itemRef, address worker) public pure returns (bytes32) {
        return keccak256(abi.encode(taskId, itemRef, worker));
    }

    function taskOf(bytes32 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    function claimOf(bytes32 id) external view returns (Claim memory) {
        return _claims[id];
    }

    // ------------------------------------------------------------------ internal

    function _create(bytes32 taskId, address requester, Terms calldata k, uint128 budget) private {
        if (requester == address(0) || k.operator == address(0)) revert ZeroAddress();
        if (_tasks[taskId].requester != address(0)) revert TaskExists();
        if (
            k.reward == 0 || k.maxPerWorker < k.reward || k.maxPerWorker < k.reviewReward || k.holdSecs > MAX_HOLD
                || budget == 0
        ) revert BadTerms();
        _tasks[taskId] = Task({
            requester: requester,
            operator: k.operator,
            reward: k.reward,
            reviewReward: k.reviewReward,
            maxPerWorker: k.maxPerWorker,
            available: budget,
            held: 0,
            holdSecs: k.holdSecs,
            paused: false,
            closed: false
        });
        emit TaskCreated(taskId, requester, k.operator, k.reward, k.reviewReward, k.maxPerWorker, k.holdSecs, budget);
    }

    function _task(bytes32 taskId) private view returns (Task storage t) {
        t = _tasks[taskId];
        if (t.requester == address(0)) revert NoTask();
    }

    function _open(bytes32 taskId) private view returns (Task storage t) {
        t = _task(taskId);
        if (t.closed) revert TaskInactive();
    }
}
