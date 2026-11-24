// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {Signing} from "./Signing.sol";

contract TaskEscrowTest is Test {
    TaskEscrow escrow;
    MockUSD8 usd;

    uint256 requesterPk = 0xA11CE;
    address requester;
    address operator = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address stranger = makeAddr("stranger");

    bytes32 constant TASK = keccak256("task-1");
    uint128 constant REWARD = 200_000; // 0.20 tUSD8
    uint128 constant REVIEW = 60_000; // 0.06 tUSD8
    uint128 constant CAP = 1_000_000; // 1 tUSD8 per worker
    uint64 constant HOLD = 60;
    uint128 constant BUDGET = 5_000_000; // 5 tUSD8

    function setUp() public {
        usd = new MockUSD8();
        escrow = new TaskEscrow(usd);
        requester = vm.addr(requesterPk);
        usd.mint(requester, 100_000_000);
        vm.prank(requester);
        usd.approve(address(escrow), type(uint256).max);
    }

    // ------------------------------------------------------------- helpers

    function _terms() internal view returns (TaskEscrow.Terms memory) {
        return TaskEscrow.Terms(operator, REWARD, REVIEW, CAP, HOLD);
    }

    function _create() internal {
        vm.prank(requester);
        escrow.createTask(TASK, TaskEscrow.Terms(operator, REWARD, REVIEW, CAP, HOLD), BUDGET);
    }

    function _one(bytes32 ref, address w, uint128 amount) internal returns (bytes32) {
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = ref;
        ws[0] = w;
        as_[0] = amount;
        vm.prank(operator);
        return escrow.accrue(TASK, refs, ws, as_)[0];
    }

    function _ids(bytes32 a) internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = a;
    }

    // ------------------------------------------------------------- happy path

    function test_fullFlow() public {
        _create();
        assertEq(usd.balanceOf(address(escrow)), BUDGET);

        bytes32 c1 = _one("item-1", alice, REWARD);
        bytes32 c2 = _one("rev-1", bob, REVIEW);
        TaskEscrow.Task memory t = escrow.taskOf(TASK);
        assertEq(t.available, BUDGET - REWARD - REVIEW);
        assertEq(t.held, REWARD + REVIEW);

        // not due yet: release skips, nothing moves
        bytes32[] memory both = new bytes32[](2);
        both[0] = c1;
        both[1] = c2;
        assertEq(escrow.release(both), 0);
        assertEq(usd.balanceOf(alice), 0);

        vm.warp(block.timestamp + HOLD);
        vm.prank(stranger); // anyone can release
        assertEq(escrow.release(both), 2);
        assertEq(usd.balanceOf(alice), REWARD);
        assertEq(usd.balanceOf(bob), REVIEW);
        assertEq(escrow.taskOf(TASK).held, 0);

        // releasing twice pays nothing more
        assertEq(escrow.release(both), 0);
        assertEq(usd.balanceOf(alice), REWARD);
    }

    function test_closeRefundsOnlyWhatNobodyEarned() public {
        _create();
        bytes32 c = _one("item-1", alice, REWARD);
        uint256 before = usd.balanceOf(requester);
        vm.prank(requester);
        escrow.close(TASK);
        assertEq(usd.balanceOf(requester) - before, BUDGET - REWARD);

        // the worker's held payment survives the close
        vm.warp(block.timestamp + HOLD);
        escrow.release(_ids(c));
        assertEq(usd.balanceOf(alice), REWARD);
        assertEq(usd.balanceOf(address(escrow)), 0);
    }

    function test_withholdDuringHoldReturnsToBudget() public {
        _create();
        bytes32 c = _one("item-1", alice, REWARD);
        vm.prank(requester);
        escrow.withhold(_ids(c));
        assertEq(uint8(escrow.claimOf(c).status), uint8(TaskEscrow.Status.Withheld));
        assertEq(escrow.taskOf(TASK).available, BUDGET);
        assertEq(escrow.earned(TASK, alice), 0);
        vm.warp(block.timestamp + HOLD);
        assertEq(escrow.release(_ids(c)), 0);
        assertEq(usd.balanceOf(alice), 0);
    }

    function test_withholdAfterCloseGoesBackToRequester() public {
        _create();
        bytes32 c = _one("item-1", alice, REWARD);
        vm.prank(requester);
        escrow.close(TASK);
        uint256 before = usd.balanceOf(requester);
        vm.prank(operator);
        escrow.withhold(_ids(c));
        assertEq(usd.balanceOf(requester) - before, REWARD);
        assertEq(usd.balanceOf(address(escrow)), 0);
    }

    function test_gaslessCreate() public {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = escrow.createNonce(TASK, requester, _terms());
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(
            vm,
            requesterPk,
            usd.DOMAIN_SEPARATOR(),
            Signing.Auth(requester, address(escrow), BUDGET, 0, validBefore, nonce)
        );
        vm.prank(stranger); // a relayer submits it
        escrow.createTaskWithAuthorization(TASK, requester, _terms(), BUDGET, TaskEscrow.Authorization(0, validBefore, v, r, s));
        assertEq(escrow.taskOf(TASK).requester, requester);
        assertEq(usd.balanceOf(address(escrow)), BUDGET);
    }

    // ------------------------------------------------------------- attacks

    function test_relayerCannotChangeSignedTerms() public {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = escrow.createNonce(TASK, requester, _terms());
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(
            vm,
            requesterPk,
            usd.DOMAIN_SEPARATOR(),
            Signing.Auth(requester, address(escrow), BUDGET, 0, validBefore, nonce)
        );
        // the relayer names itself operator and raises the reward
        vm.prank(stranger);
        vm.expectRevert();
        escrow.createTaskWithAuthorization(TASK, requester, TaskEscrow.Terms(stranger, CAP, REVIEW, CAP, HOLD), BUDGET, TaskEscrow.Authorization(0, validBefore, v, r, s));
    }

    function test_onlyOperatorAccrues() public {
        _create();
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = "x";
        ws[0] = stranger;
        as_[0] = REWARD;
        vm.prank(stranger);
        vm.expectRevert(TaskEscrow.NotOperator.selector);
        escrow.accrue(TASK, refs, ws, as_);
        vm.prank(requester);
        vm.expectRevert(TaskEscrow.NotOperator.selector);
        escrow.accrue(TASK, refs, ws, as_);
    }

    function test_operatorCannotPayItselfOrRequester() public {
        _create();
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = "x";
        as_[0] = REWARD;
        ws[0] = operator;
        vm.startPrank(operator);
        vm.expectRevert(TaskEscrow.NotAllowed.selector);
        escrow.accrue(TASK, refs, ws, as_);
        ws[0] = requester;
        vm.expectRevert(TaskEscrow.NotAllowed.selector);
        escrow.accrue(TASK, refs, ws, as_);
        vm.stopPrank();
    }

    function test_onlyTheTwoRates() public {
        _create();
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = "x";
        ws[0] = alice;
        as_[0] = REWARD + 1;
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.BadAmount.selector, uint256(REWARD + 1)));
        escrow.accrue(TASK, refs, ws, as_);
    }

    function test_sameAnswerNeverPaidTwice() public {
        _create();
        bytes32 c = _one("item-1", alice, REWARD);
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = "item-1";
        ws[0] = alice;
        as_[0] = REWARD;
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.AlreadyClaimed.selector, c));
        escrow.accrue(TASK, refs, ws, as_);
        // even after it was withheld
        vm.prank(requester);
        escrow.withhold(_ids(c));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.AlreadyClaimed.selector, c));
        escrow.accrue(TASK, refs, ws, as_);
    }

    function test_workerCap() public {
        _create();
        for (uint256 i; i < CAP / REWARD; ++i) _one(bytes32(i), alice, REWARD);
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = "one-more";
        ws[0] = alice;
        as_[0] = REWARD;
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(TaskEscrow.OverWorkerCap.selector, alice));
        escrow.accrue(TASK, refs, ws, as_);
    }

    function test_budgetCannotBeOverspent() public {
        vm.prank(requester);
        escrow.createTask(TASK, TaskEscrow.Terms(operator, REWARD, REVIEW, CAP, HOLD), REWARD); // budget for one answer
        _one("a", alice, REWARD);
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = "b";
        ws[0] = bob;
        as_[0] = REWARD;
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.OverBudget.selector);
        escrow.accrue(TASK, refs, ws, as_);
    }

    function test_pausedOrClosedTaskTakesNoWork() public {
        _create();
        vm.prank(requester);
        escrow.setPaused(TASK, true);
        bytes32[] memory refs = new bytes32[](1);
        address[] memory ws = new address[](1);
        uint128[] memory as_ = new uint128[](1);
        refs[0] = "x";
        ws[0] = alice;
        as_[0] = REWARD;
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.TaskInactive.selector);
        escrow.accrue(TASK, refs, ws, as_);

        vm.startPrank(requester);
        escrow.setPaused(TASK, false);
        escrow.close(TASK);
        vm.stopPrank();
        vm.prank(operator);
        vm.expectRevert(TaskEscrow.TaskInactive.selector);
        escrow.accrue(TASK, refs, ws, as_);
    }

    function test_noWithholdOnceDue() public {
        _create();
        bytes32 c = _one("item-1", alice, REWARD);
        vm.warp(block.timestamp + HOLD);
        vm.prank(requester);
        escrow.withhold(_ids(c)); // skipped: the worker is owed it now
        escrow.release(_ids(c));
        assertEq(usd.balanceOf(alice), REWARD);
    }

    function test_strangersCannotWithholdOrControl() public {
        _create();
        bytes32 c = _one("item-1", alice, REWARD);
        vm.startPrank(stranger);
        vm.expectRevert(TaskEscrow.NotAllowed.selector);
        escrow.withhold(_ids(c));
        vm.expectRevert(TaskEscrow.NotRequester.selector);
        escrow.close(TASK);
        vm.expectRevert(TaskEscrow.NotRequester.selector);
        escrow.setPaused(TASK, true);
        vm.expectRevert(TaskEscrow.NotAllowed.selector);
        escrow.anchorDataset(TASK, keccak256("fake"));
        vm.stopPrank();
    }

    function test_badTermsRejected() public {
        vm.startPrank(requester);
        vm.expectRevert(TaskEscrow.BadTerms.selector);
        escrow.createTask(TASK, TaskEscrow.Terms(operator, 0, REVIEW, CAP, HOLD), BUDGET);
        vm.expectRevert(TaskEscrow.BadTerms.selector);
        escrow.createTask(TASK, TaskEscrow.Terms(operator, REWARD, REVIEW, REWARD - 1, HOLD), BUDGET);
        vm.expectRevert(TaskEscrow.BadTerms.selector);
        escrow.createTask(TASK, TaskEscrow.Terms(operator, REWARD, REVIEW, CAP, 8 days), BUDGET);
        escrow.createTask(TASK, TaskEscrow.Terms(operator, REWARD, REVIEW, CAP, HOLD), BUDGET);
        vm.expectRevert(TaskEscrow.TaskExists.selector);
        escrow.createTask(TASK, TaskEscrow.Terms(operator, REWARD, REVIEW, CAP, HOLD), BUDGET);
        vm.stopPrank();
    }

    function test_anchorDataset() public {
        _create();
        bytes32 h = sha256("dataset"); // computed first: the sha256 precompile call would use up the prank
        vm.prank(operator);
        escrow.anchorDataset(TASK, h);
        assertEq(escrow.datasetHash(TASK), h);
    }

    /// The escrow always holds exactly what it owes: unearned budget + payments on hold, across tasks.
    function testFuzz_solvent(uint8 nAnswers, uint8 nWithheld, bool closeIt) public {
        _create();
        uint256 n = bound(nAnswers, 0, 20);
        bytes32[] memory ids = new bytes32[](n);
        for (uint256 i; i < n; ++i) ids[i] = _one(bytes32(i), address(uint160(0x1000 + i)), REWARD);
        uint256 w = bound(nWithheld, 0, n);
        bytes32[] memory some = new bytes32[](w);
        for (uint256 i; i < w; ++i) some[i] = ids[i];
        vm.prank(requester);
        escrow.withhold(some);
        if (closeIt) {
            vm.prank(requester);
            escrow.close(TASK);
        }
        TaskEscrow.Task memory t = escrow.taskOf(TASK);
        assertEq(usd.balanceOf(address(escrow)), uint256(t.available) + t.held);
        vm.warp(block.timestamp + HOLD);
        escrow.release(ids);
        t = escrow.taskOf(TASK);
        assertEq(usd.balanceOf(address(escrow)), uint256(t.available) + t.held);
        assertEq(t.held, 0);
    }
}
